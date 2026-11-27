import "server-only";

import type { CollectionReference, DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { isActiveEventGuest, type EventParticipant } from "./event-participant";

type AttendanceEntry = { ref: DocumentReference; participant: EventParticipant };

export async function runAttendanceTransaction<T>(db: Firestore, update: (transaction: Transaction) => Promise<T>) {
  try {
    return await db.runTransaction(update);
  } catch (error) {
    const invalidArgument = 3;
    if (!process.env.FIRESTORE_EMULATOR_HOST || !(error instanceof Error) || !("code" in error) ||
      error.code !== invalidArgument || !error.message.endsWith("Transaction is invalid or closed.")) {
      throw error;
    }
    // After a lock timeout, the emulator can reject the SDK's retry transaction ID.
    return db.runTransaction(update);
  }
}

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
