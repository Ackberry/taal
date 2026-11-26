import "server-only";

import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "@/lib/firebase/admin";
import { privateDetailKeys, type EditableEventDetails, type EventDetailsPatch } from "./event-details-input";
import { isEventId, selectPrivateEventDetails, type EventRecord } from "./event-record";

export class HostEventDetails {
  private readonly events;

  constructor(private readonly db = getFirestore(getFirebaseAdminApp())) {
    this.events = db.collection("events");
  }

  async read(eventId: string, uid: string): Promise<EditableEventDetails | null> {
    if (!isEventId(eventId)) return null;
    const event = (await this.events.doc(eventId).get()).data() as EventRecord | undefined;
    if (event?.ownerUid !== uid) return null;
    return { name: event.name, ...selectPrivateEventDetails(event) };
  }

  async update(eventId: string, uid: string, input: EventDetailsPatch): Promise<EditableEventDetails | null> {
    if (!isEventId(eventId)) return null;
    const ref = this.events.doc(eventId);
    const auditRef = ref.collection("auditEntries").doc();

    return this.db.runTransaction(async (transaction) => {
      const event = (await transaction.get(ref)).data() as EventRecord | undefined;
      if (event?.ownerUid !== uid) return null;

      const name = input.name ?? event.name;
      const privateDetails = selectPrivateEventDetails(event);
      const changedFields: ("name" | keyof typeof privateDetails)[] = [];
      if (name !== event.name) changedFields.push("name");
      for (const key of privateDetailKeys) {
        const next = input[key];
        if (next === undefined || next === (privateDetails[key] ?? null)) continue;
        if (next === null) delete privateDetails[key];
        else privateDetails[key] = next;
        changedFields.push(key);
      }

      if (changedFields.length) {
        transaction.update(ref, { name, privateDetails });
        transaction.create(auditRef, {
          action: "event_details_updated",
          actorUid: uid,
          changedFields,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      return { name, ...privateDetails };
    });
  }
}
