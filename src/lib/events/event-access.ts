import "server-only";

import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "@/lib/firebase/admin";
import { eventAccountKey, isActiveEventGuest, type EventParticipant } from "./event-participant";
import type { PrivateEventDetails } from "./event-details-input";
import { isEventId, selectPrivateEventDetails, type EventRecord } from "./event-record";

type EventDetails = { startAt: string | null } & PrivateEventDetails;

type EventView = { name: string } & (
  | { role: "host"; details: EventDetails }
  | { role: "guest"; rsvpStatus: "confirmed"; details: EventDetails }
  | { role: "guest"; rsvpStatus: "none" | "waitlisted" }
);

function eventDetails(event: EventRecord): EventDetails {
  return { startAt: event.startAt?.toDate().toISOString() ?? null, ...selectPrivateEventDetails(event) };
}

export async function readEventView(eventId: string, uid: string): Promise<EventView | null> {
  if (!isEventId(eventId)) return null;

  const db = getFirestore(getFirebaseAdminApp());
  const eventRef = db.collection("events").doc(eventId);
  const participantRef = eventRef.collection("participants").doc(eventAccountKey(uid));
  const [eventSnapshot, participantSnapshot] = await db.getAll(eventRef, participantRef);

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
