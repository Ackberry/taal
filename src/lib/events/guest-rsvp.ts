import "server-only";

import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "@/lib/firebase/admin";
import { runFirestoreWriteTransaction } from "@/lib/firebase/firestore-transaction";
import { promoteWaitlistedGuests, readEventAttendance } from "./event-attendance";
import { eventAccountKey, isActiveEventGuest, type EventParticipant } from "./event-participant";
import { isEventId, type EventRecord } from "./event-record";

type RsvpOutcome = Exclude<EventParticipant["rsvpStatus"], "none">;

export class GuestRsvp {
  constructor(private readonly db = getFirestore(getFirebaseAdminApp())) {}

  async submit(eventId: string, uid: string): Promise<RsvpOutcome | null> {
    if (!isEventId(eventId)) return null;

    const eventRef = this.db.collection("events").doc(eventId);
    const participants = eventRef.collection("participants");
    const guestRef = participants.doc(eventAccountKey(uid));

    return runFirestoreWriteTransaction(this.db, async (transaction) => {
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
  }
}
