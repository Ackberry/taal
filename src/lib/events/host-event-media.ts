import "server-only";

import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "@/lib/firebase/admin";
import { EventImageStorage } from "@/lib/firebase/event-image-storage";
import { runFirestoreWriteTransaction } from "@/lib/firebase/firestore-transaction";
import { prepareEventImage } from "./event-image";
import { eventImageLimit, eventPhotoDocumentId, isEventImageId, type EventImageKind, type EventImageRecord, type EventImageSummary } from "./event-media-record";
import { isEventId, type EventRecord } from "./event-record";

type MediaUpload = { kind: EventImageKind; image: Buffer; alt: string };

export class EventImageLimitError extends Error {
  constructor() {
    super(`An event can have up to ${eventImageLimit} images. Remove a reference image before adding another.`);
  }
}

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
    if (kind === "reference" && (event.mediaCount ?? 0) >= eventImageLimit) throw new EventImageLimitError();
    const prepared = await prepareEventImage(image);
    const storage = new EventImageStorage(this.app);
    const { id, objectPath } = await storage.save(eventId, prepared);
    const media = eventRef.collection("media");
    const mediaRef = media.doc(kind === "photo" ? eventPhotoDocumentId : id);
    const auditRef = eventRef.collection("auditEntries").doc();
    const summary = { id, kind, alt };

    const saved = await runFirestoreWriteTransaction(this.db, async (transaction) => {
      const [eventSnapshot, mediaSnapshot] = await transaction.getAll(eventRef, mediaRef);
      const current = eventSnapshot.data() as EventRecord | undefined;
      if (current?.ownerUid !== uid) return null;

      const previous = mediaSnapshot.data() as EventImageRecord | undefined;
      if (!previous) {
        const count = current.mediaCount ?? (await transaction.get(media)).size;
        if (count >= eventImageLimit) return { status: "full" } as const;
        // Count-changing uploads and removals write the same event document.
        transaction.update(eventRef, { mediaCount: count + 1 });
      }
      transaction.set(mediaRef, { ...summary, objectPath, createdAt: FieldValue.serverTimestamp() });
      transaction.create(auditRef, {
        action: "event_details_updated",
        actorUid: uid,
        changedFields: [kind === "photo" ? "photo" : "referenceImages"],
        createdAt: FieldValue.serverTimestamp(),
      });
      return { status: "saved", previous } as const;
    });

    // On an unknown commit outcome, retain the private object in case the record was saved.
    await this.removeDetachedObject(saved?.status === "saved" ? saved.previous?.objectPath : objectPath);
    if (saved?.status === "full") throw new EventImageLimitError();
    return saved ? summary : null;
  }

  async removeReference(eventId: string, uid: string, imageId: string): Promise<boolean> {
    if (!isEventId(eventId) || !isEventImageId(imageId)) return false;

    const eventRef = this.db.collection("events").doc(eventId);
    const media = eventRef.collection("media");
    const imageRef = media.doc(imageId);
    const auditRef = eventRef.collection("auditEntries").doc();
    const removed = await runFirestoreWriteTransaction(this.db, async (transaction) => {
      const [eventSnapshot, imageSnapshot] = await transaction.getAll(eventRef, imageRef);
      const event = eventSnapshot.data() as EventRecord | undefined;
      const image = imageSnapshot.data() as EventImageRecord | undefined;
      if (event?.ownerUid !== uid || image?.kind !== "reference") return null;

      const count = event.mediaCount ?? (await transaction.get(media)).size;
      transaction.update(eventRef, { mediaCount: count - 1 });
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
