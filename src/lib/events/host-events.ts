import "server-only";

import { createHash } from "node:crypto";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "@/lib/firebase/admin";
import type { EventRecord } from "./event-record";
import type { EventCreationInput, HostEvent } from "./host-event-input";

export class HostEventError extends Error {
  constructor(readonly code: "host_approval_required" | "request_conflict") {
    super(code);
  }
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toHostEvent(eventId: string, record: EventRecord): HostEvent {
  return {
    eventId,
    name: record.name,
    startAt: record.startAt?.toDate().toISOString() ?? null,
    capacity: record.capacity ?? null,
  };
}

export class HostEvents {
  private readonly hosts;
  private readonly events;

  constructor(private readonly db = getFirestore(getFirebaseAdminApp())) {
    this.hosts = db.collection("hostAccounts");
    this.events = db.collection("events");
  }

  async isApproved(uid: string) {
    return (await this.hosts.doc(uid).get()).exists;
  }

  async list(uid: string) {
    return this.db.runTransaction(async (transaction) => {
      if (!(await transaction.get(this.hosts.doc(uid))).exists) {
        throw new HostEventError("host_approval_required");
      }

      const snapshot = await transaction.get(this.events.where("ownerUid", "==", uid));
      return snapshot.docs
        .map((doc) => toHostEvent(doc.id, doc.data() as EventRecord))
        .sort((a, b) => a.name.localeCompare(b.name) || a.eventId.localeCompare(b.eventId));
    }, { readOnly: true });
  }

  async create(uid: string, input: EventCreationInput) {
    const eventId = `event-${digest([uid, input.requestId])}`;
    const ref = this.events.doc(eventId);
    const creationFingerprint = digest([input.name, input.startAt, input.capacity]);

    return this.db.runTransaction(async (transaction) => {
      if (!(await transaction.get(this.hosts.doc(uid))).exists) {
        throw new HostEventError("host_approval_required");
      }

      const existing = (await transaction.get(ref)).data() as EventRecord | undefined;
      if (existing) {
        if (existing.ownerUid !== uid || existing.creationFingerprint !== creationFingerprint) {
          throw new HostEventError("request_conflict");
        }
        return { event: toHostEvent(eventId, existing), created: false };
      }

      const record: EventRecord = {
        ownerUid: uid,
        name: input.name,
        startAt: input.startAt && Timestamp.fromDate(input.startAt),
        capacity: input.capacity,
        creationFingerprint,
      };
      transaction.create(ref, record);
      return { event: toHostEvent(eventId, record), created: true };
    });
  }
}
