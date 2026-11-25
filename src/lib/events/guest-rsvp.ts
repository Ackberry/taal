import "server-only";

import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "@/lib/firebase/admin";
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

    return this.db.runTransaction(async (transaction) => {
      const [eventSnapshot, guestSnapshot] = await transaction.getAll(eventRef, guestRef);
      const event = eventSnapshot.data() as EventRecord | undefined;
      const guest = guestSnapshot.data() as EventParticipant | undefined;
      if (!event || event.ownerUid === uid || !isActiveEventGuest(guest)) return null;
      if (guest.rsvpStatus !== "none") return guest.rsvpStatus;

      const attendance = await transaction.get(participants.where("rsvpStatus", "in", ["confirmed", "waitlisted"]));
      const waiting = [];
      let confirmed = 0;
      let sequence = event.rsvpSequence ?? 0;
      for (const snapshot of attendance.docs) {
        const participant = snapshot.data() as EventParticipant;
        if (!isActiveEventGuest(participant)) continue;
        if (participant.rsvpStatus === "confirmed") {
          confirmed++;
        } else {
          sequence = Math.max(sequence, participant.waitlistPosition ?? 0);
          waiting.push({ ref: snapshot.ref, position: participant.waitlistPosition ?? Number.MAX_SAFE_INTEGER });
        }
      }

      let openSpots = (event.capacity ?? Infinity) - confirmed;
      waiting.sort((first, second) => first.position - second.position);
      for (const entry of waiting.slice(0, Math.max(0, openSpots))) {
        transaction.update(entry.ref, { rsvpStatus: "confirmed", waitlistPosition: null });
        openSpots--;
      }

      const rsvpStatus = openSpots > 0 ? "confirmed" : "waitlisted";
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
