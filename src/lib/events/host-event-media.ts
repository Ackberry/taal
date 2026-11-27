import "server-only";

import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "@/lib/firebase/admin";
import { EventImageStorage } from "@/lib/firebase/event-image-storage";
import { prepareEventImage } from "./event-image";
import { eventPhotoDocumentId, isEventImageId, type EventImageKind, type EventImageRecord, type EventImageSummary } from "./event-media-record";
import { isEventId, type EventRecord } from "./event-record";

type MediaUpload = { kind: EventImageKind; image: Buffer; alt: string };

export class HostEventMedia {
  private readonly db;

  constructor(private readonly app = getFirebaseAdminApp()) {
    this.db = getFirestore(app);
  }

  async upload(eventId: string, uid: string, readUpload: () => Promise<MediaUpload>): Promise<EventImageSummary | null> {
    if (!isEventId(eventId)) return null;

    const eventRef = this.db.collection("events").doc(eventId);
    const event = (await eventRef.get()).data() as EventRecord | undefined;
    if (event?.ownerUid !== uid) return null;

    const { kind, image, alt } = await readUpload();
    const prepared = await prepareEventImage(image);
    const storage = new EventImageStorage(this.app);
    const { id, objectPath } = await storage.save(eventId, prepared);
    const mediaRef = eventRef.collection("media").doc(kind === "photo" ? eventPhotoDocumentId : id);
    const auditRef = eventRef.collection("auditEntries").doc();
    const summary = { id, kind, alt };

    const saved = await this.db.runTransaction(async (transaction) => {
      const current = (await transaction.get(eventRef)).data() as EventRecord | undefined;
      if (current?.ownerUid !== uid) return null;

      const previous = (await transaction.get(mediaRef)).data() as EventImageRecord | undefined;
      transaction.set(mediaRef, { ...summary, objectPath, createdAt: FieldValue.serverTimestamp() });
      transaction.create(auditRef, {
        action: "event_details_updated",
        actorUid: uid,
        changedFields: [kind === "photo" ? "photo" : "referenceImages"],
        createdAt: FieldValue.serverTimestamp(),
      });
      return { previous };
    });

    // On an unknown commit outcome, retain the private object in case the record was saved.
    await this.removeDetachedObject(saved ? saved.previous?.objectPath : objectPath);
    return saved ? summary : null;
  }

  async removeReference(eventId: string, uid: string, imageId: string): Promise<boolean> {
    if (!isEventId(eventId) || !isEventImageId(imageId)) return false;

    const eventRef = this.db.collection("events").doc(eventId);
    const imageRef = eventRef.collection("media").doc(imageId);
    const auditRef = eventRef.collection("auditEntries").doc();
    const removed = await this.db.runTransaction(async (transaction) => {
      const [eventSnapshot, imageSnapshot] = await transaction.getAll(eventRef, imageRef);
      const event = eventSnapshot.data() as EventRecord | undefined;
      const image = imageSnapshot.data() as EventImageRecord | undefined;
      if (event?.ownerUid !== uid || image?.kind !== "reference") return null;

      transaction.delete(imageRef);
      transaction.create(auditRef, {
        action: "event_details_updated",
        actorUid: uid,
        changedFields: ["referenceImages"],
        createdAt: FieldValue.serverTimestamp(),
      });
      return image;
    });

    await this.removeDetachedObject(removed?.objectPath);
    return Boolean(removed);
  }

  private async removeDetachedObject(objectPath: string | undefined) {
    if (!objectPath) return;
    try {
      await new EventImageStorage(this.app).remove(objectPath);
    } catch {
      console.error("Taal could not delete a detached event image.");
    }
  }
}
