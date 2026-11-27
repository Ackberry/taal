import "server-only";

import { getFirestore, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "@/lib/firebase/admin";
import { EventImageStorage } from "@/lib/firebase/event-image-storage";
import { eventImageSummary, eventPhotoDocumentId, isEventImageId, type EventImageRecord, type EventImageSummary } from "./event-media-record";
import { eventAccountKey, isActiveEventGuest, type EventParticipant } from "./event-participant";
import type { PrivateEventDetails } from "./event-details-input";
import { isEventId, selectPrivateEventDetails, type EventRecord } from "./event-record";

type EventDetails = { startAt: string | null; referenceImages?: EventImageSummary[] } & PrivateEventDetails;

type EventView = { name: string; photo?: EventImageSummary } & (
  | { role: "host"; details: EventDetails }
  | { role: "guest"; rsvpStatus: "confirmed"; details: EventDetails }
  | { role: "guest"; rsvpStatus: "none" | "waitlisted" }
);

function eventDetails(event: EventRecord): EventDetails {
  return { startAt: event.startAt?.toDate().toISOString() ?? null, ...selectPrivateEventDetails(event) };
}

async function readVisibleEvent(transaction: Transaction, eventRef: DocumentReference, uid: string): Promise<EventView | null> {
  const participantRef = eventRef.collection("participants").doc(eventAccountKey(uid));
  const [eventSnapshot, participantSnapshot] = await transaction.getAll(eventRef, participantRef);

  const event = eventSnapshot.data() as EventRecord | undefined;
  if (!event) return null;
  if (event.ownerUid === uid) return { name: event.name, role: "host", details: eventDetails(event) };

  const guest = participantSnapshot.data() as EventParticipant | undefined;
  if (!isActiveEventGuest(guest)) return null;

  const base = { name: event.name, role: "guest" } as const;
  switch (guest.rsvpStatus) {
    case "confirmed":
      return { ...base, rsvpStatus: "confirmed", details: eventDetails(event) };
    case "none":
    case "waitlisted":
      return { ...base, rsvpStatus: guest.rsvpStatus };
    default:
      return null;
  }
}

export async function readEventView(eventId: string, uid: string): Promise<EventView | null> {
  if (!isEventId(eventId)) return null;

  const db = getFirestore(getFirebaseAdminApp());
  const eventRef = db.collection("events").doc(eventId);
  const media = eventRef.collection("media");
  return db.runTransaction(async (transaction) => {
    const event = await readVisibleEvent(transaction, eventRef, uid);
    if (!event) return null;

    if ("details" in event) {
      const images = (await transaction.get(media)).docs.map((doc) => doc.data() as EventImageRecord);
      const photo = images.find((image) => image.kind === "photo");
      if (photo) event.photo = eventImageSummary(photo);

      const references = images.filter((image) => image.kind === "reference");
      references.sort((first, second) => first.createdAt.toMillis() - second.createdAt.toMillis());
      if (references.length) event.details.referenceImages = references.map(eventImageSummary);
    } else {
      const photo = (await transaction.get(media.doc(eventPhotoDocumentId))).data() as EventImageRecord | undefined;
      if (photo) event.photo = eventImageSummary(photo);
    }
    return event;
  }, { readOnly: true });
}

export async function readEventImage(eventId: string, imageId: string, uid: string): Promise<Buffer | null> {
  if (!isEventId(eventId) || !isEventImageId(imageId)) return null;

  const app = getFirebaseAdminApp();
  const db = getFirestore(app);
  const eventRef = db.collection("events").doc(eventId);
  const media = eventRef.collection("media");
  const record = await db.runTransaction(async (transaction) => {
    const event = await readVisibleEvent(transaction, eventRef, uid);
    if (!event) return null;

    const photo = (await transaction.get(media.doc(eventPhotoDocumentId))).data() as EventImageRecord | undefined;
    if (photo?.id === imageId) return photo;
    if (!("details" in event)) return null;

    const reference = (await transaction.get(media.doc(imageId))).data() as EventImageRecord | undefined;
    return reference?.kind === "reference" && reference.id === imageId ? reference : null;
  }, { readOnly: true });
  if (!record) return null;

  try {
    return await new EventImageStorage(app).download(record.objectPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 404) return null;
    throw error;
  }
}
