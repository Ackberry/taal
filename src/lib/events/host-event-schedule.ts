import "server-only";

import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "@/lib/firebase/admin";
import { isEventId, type EventRecord } from "./event-record";
import { assertFutureEventStart } from "./event-start";
import { isLiveInvite, type InviteRecord } from "./invite-record";

export class HostEventSchedule {
  constructor(private readonly db = getFirestore(getFirebaseAdminApp())) {}

  async read(eventId: string, uid: string): Promise<{ name: string; startAt: string | null } | null> {
    if (!isEventId(eventId)) return null;
    const event = (await this.db.collection("events").doc(eventId).get()).data() as EventRecord | undefined;
    if (event?.ownerUid !== uid) return null;

    return { name: event.name, startAt: event.startAt?.toDate().toISOString() ?? null };
  }

  async reschedule(eventId: string, uid: string, newStart: Date): Promise<{ startAt: string } | null> {
    if (!isEventId(eventId)) return null;

    const eventRef = this.db.collection("events").doc(eventId);
    const auditRef = eventRef.collection("auditEntries").doc();
    const startAt = Timestamp.fromDate(newStart);
    const result = { startAt: newStart.toISOString() };

    return this.db.runTransaction(async (transaction) => {
      const event = (await transaction.get(eventRef)).data() as EventRecord | undefined;
      if (event?.ownerUid !== uid) return null;
      if (event.startAt?.isEqual(startAt)) return result;

      const invites = await transaction.get(this.db.collection("eventInvites").where("eventId", "==", eventId));
      const now = Timestamp.now();
      assertFutureEventStart(newStart, now.toMillis());
      for (const doc of invites.docs) {
        const invite = doc.data() as InviteRecord;
        if (invite.expirationMode === "event-start" && isLiveInvite(invite, now)) {
          transaction.update(doc.ref, { expiresAt: startAt });
        }
      }

      transaction.update(eventRef, { startAt });
      transaction.create(auditRef, {
        action: "event_details_updated",
        actorUid: uid,
        changedFields: ["startAt"],
        createdAt: FieldValue.serverTimestamp(),
      });
      return result;
    });
  }
}
