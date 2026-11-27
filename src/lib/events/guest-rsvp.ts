import "server-only";

import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "@/lib/firebase/admin";
import { promoteWaitlistedGuests, readEventAttendance } from "./event-attendance";
import { eventAccountKey, isActiveEventGuest, type EventParticipant } from "./event-participant";
import { isEventId, type EventRecord } from "./event-record";

type RsvpOutcome = Exclude<EventParticipant["rsvpStatus"], "none">;

function isClosedEmulatorTransaction(error: unknown): boolean {
  const invalidArgument = 3;
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST) &&
    error instanceof Error && "code" in error && error.code === invalidArgument &&
    error.message.endsWith("Transaction is invalid or closed.");
}

export class GuestRsvp {
  constructor(private readonly db = getFirestore(getFirebaseAdminApp())) {}

  async submit(eventId: string, uid: string): Promise<RsvpOutcome | null> {
    if (!isEventId(eventId)) return null;

    const eventRef = this.db.collection("events").doc(eventId);
    const participants = eventRef.collection("participants");
    const guestRef = participants.doc(eventAccountKey(uid));

    const saveRsvp = () => this.db.runTransaction(async (transaction) => {
      const [eventSnapshot, guestSnapshot] = await transaction.getAll(eventRef, guestRef);
      const event = eventSnapshot.data() as EventRecord | undefined;
      const guest = guestSnapshot.data() as EventParticipant | undefined;
      if (!event || event.ownerUid === uid || !isActiveEventGuest(guest)) return null;
      if (guest.rsvpStatus !== "none") return guest.rsvpStatus;

      const { confirmed, waitlisted } = await readEventAttendance(transaction, participants);
      const sequence = waitlisted.reduce(
        (latest, { participant }) => Math.max(latest, participant.waitlistPosition ?? 0),
        event.rsvpSequence ?? 0,
      );
      const openSpots = (event.capacity ?? Infinity) - confirmed.length;
      const promoted = promoteWaitlistedGuests(transaction, waitlisted, openSpots);
      const rsvpStatus = openSpots > promoted ? "confirmed" : "waitlisted";
      // Every new RSVP writes the same event document, so competing submissions retry against fresh attendance.
      const rsvpSequence = sequence + 1;
      transaction.update(eventRef, { rsvpSequence });
      transaction.update(guestRef, {
        rsvpStatus,
        waitlistPosition: rsvpStatus === "waitlisted" ? rsvpSequence : null,
      });
      return rsvpStatus;
    });

    try {
      return await saveRsvp();
    } catch (error) {
      if (!isClosedEmulatorTransaction(error)) throw error;
      // After a lock timeout, the emulator can reject the SDK's retry transaction ID.
      return saveRsvp();
    }
  }
}
