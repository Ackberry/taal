import "server-only";

import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "@/lib/firebase/admin";
import { runFirestoreWriteTransaction } from "@/lib/firebase/firestore-transaction";
import { promoteWaitlistedGuests, readEventAttendance } from "./event-attendance";
import { isEventId, type EventRecord } from "./event-record";
import type { CapacityChange, HostCapacityView } from "./host-capacity-input";

export class CapacityChangeError extends Error {
  constructor(readonly code: "stale_selection" | "insufficient_selection", readonly requiredRemovals: number) {
    super(code);
  }
}

export class HostEventCapacity {
  constructor(private readonly db = getFirestore(getFirebaseAdminApp())) {}

  async read(eventId: string, uid: string): Promise<HostCapacityView | null> {
    if (!isEventId(eventId)) return null;

    const eventRef = this.db.collection("events").doc(eventId);
    const snapshot = await this.db.runTransaction(async (transaction) => {
      const event = (await transaction.get(eventRef)).data() as EventRecord | undefined;
      if (event?.ownerUid !== uid) return null;

      const { confirmed, waitlisted } = await readEventAttendance(transaction, eventRef.collection("participants"));
      return { name: event.name, capacity: event.capacity ?? null, confirmed, waitlistedCount: waitlisted.length };
    }, { readOnly: true });
    if (!snapshot) return null;

    const { confirmed, ...event } = snapshot;
    const auth = getAuth(getFirebaseAdminApp());
    const lookups = [];
    // Firebase Auth accepts up to 100 account identifiers per lookup.
    for (let index = 0; index < confirmed.length; index += 100) {
      const accounts = confirmed.slice(index, index + 100).map(({ participant }) => ({ uid: participant.uid }));
      lookups.push(auth.getUsers(accounts));
    }
    const users = (await Promise.all(lookups)).flatMap(({ users }) => users);
    const contacts = new Map(users.map((user) => [user.uid, user.emailVerified ? user.email : user.phoneNumber]));
    const confirmedGuests = confirmed.map(({ ref, participant }) => ({
      participantId: ref.id,
      label: contacts.get(participant.uid) || `Guest ${ref.id.slice(0, 8)}`,
    }));
    confirmedGuests.sort((first, second) => first.label.localeCompare(second.label));
    return { ...event, confirmedGuests };
  }

  async update(eventId: string, uid: string, { capacity, removeParticipantIds }: CapacityChange) {
    if (!isEventId(eventId)) return null;

    const eventRef = this.db.collection("events").doc(eventId);
    return runFirestoreWriteTransaction(this.db, async (transaction) => {
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
