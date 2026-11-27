import "server-only";

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "@/lib/firebase/admin";
import { promoteWaitlistedGuests, readEventAttendance, runAttendanceTransaction } from "./event-attendance";
import { isEventId, type EventRecord } from "./event-record";
import type { CapacityChange } from "./host-capacity-input";

export class CapacityChangeError extends Error {
  constructor(readonly code: "stale_selection" | "insufficient_selection", readonly requiredRemovals: number) {
    super(code);
  }
}

export class HostEventCapacity {
  constructor(private readonly db = getFirestore(getFirebaseAdminApp())) {}

  async update(eventId: string, uid: string, { capacity, removeParticipantIds }: CapacityChange) {
    if (!isEventId(eventId)) return null;

    const eventRef = this.db.collection("events").doc(eventId);
    return runAttendanceTransaction(this.db, async (transaction) => {
      const event = (await transaction.get(eventRef)).data() as EventRecord | undefined;
      if (event?.ownerUid !== uid) return null;

      const { confirmed, waitlisted } = await readEventAttendance(transaction, eventRef.collection("participants"));
      const selected = new Set(removeParticipantIds);
      const removals = confirmed.filter(({ ref }) => selected.has(ref.id));
      const limit = capacity ?? Infinity;
      const requiredRemovals = Math.max(0, confirmed.length - limit);
      if (removals.length !== selected.size || (removals.length > 0 && requiredRemovals === 0)) {
        throw new CapacityChangeError("stale_selection", requiredRemovals);
      }
      if (removals.length < requiredRemovals) {
        throw new CapacityChangeError("insufficient_selection", requiredRemovals);
      }

      const blockedAt = Timestamp.now();
      for (const { ref } of removals) {
        transaction.update(ref, {
          membershipStatus: "removed",
          blockedAt,
          rsvpStatus: "none",
          waitlistPosition: null,
        });
      }

      const openSpots = limit - (confirmed.length - removals.length);
      const promotedCount = promoteWaitlistedGuests(transaction, waitlisted, openSpots);
      // The guest RSVP transaction writes this same document and retries against current attendance.
      transaction.update(eventRef, { capacity });
      return { capacity, promotedCount, removedCount: removals.length };
    });
  }
}
