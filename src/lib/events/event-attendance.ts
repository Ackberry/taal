import "server-only";

import type { CollectionReference, DocumentReference, Transaction } from "firebase-admin/firestore";
import { isActiveEventGuest, type EventParticipant } from "./event-participant";

type AttendanceEntry = { ref: DocumentReference; participant: EventParticipant };

export async function readEventAttendance(transaction: Transaction, participants: CollectionReference) {
  const snapshot = await transaction.get(participants.where("rsvpStatus", "in", ["confirmed", "waitlisted"]));
  const confirmed: AttendanceEntry[] = [];
  const waitlisted: AttendanceEntry[] = [];

  for (const doc of snapshot.docs) {
    const participant = doc.data() as EventParticipant;
    if (!isActiveEventGuest(participant)) continue;

    const entries = participant.rsvpStatus === "confirmed" ? confirmed : waitlisted;
    entries.push({ ref: doc.ref, participant });
  }

  waitlisted.sort((first, second) => (
    (first.participant.waitlistPosition ?? Number.MAX_SAFE_INTEGER) -
    (second.participant.waitlistPosition ?? Number.MAX_SAFE_INTEGER)
  ));
  return { confirmed, waitlisted };
}

export function promoteWaitlistedGuests(transaction: Transaction, waitlisted: AttendanceEntry[], openSpots: number) {
  const promoted = waitlisted.slice(0, Math.max(0, openSpots));
  for (const { ref } of promoted) {
    transaction.update(ref, { rsvpStatus: "confirmed", waitlistPosition: null });
  }
  return promoted.length;
}
