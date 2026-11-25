import "server-only";

import { randomBytes } from "node:crypto";
import { getFirestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "@/lib/firebase/admin";
import { eventIdPattern, type HostInvite, type InviteInput } from "./invite-input";
import type { InviteRecord } from "./invite-record";

type EventRecord = {
  ownerUid: string;
  name: string;
  startAt: Timestamp | null;
};

export class HostInviteError extends Error {
  constructor(readonly code: "not_found" | "expiration_required" | "expiration_in_past") {
    super(code);
  }
}

function toHostInvite(token: string, record: InviteRecord): HostInvite {
  return {
    token,
    slug: record.slug,
    expiresAt: record.expiresAt.toDate().toISOString(),
    expirationMode: record.expirationMode,
    disabledAt: record.disabledAt?.toDate().toISOString() ?? null,
  };
}

export class HostInvites {
  private readonly events;
  private readonly invites;

  constructor(private readonly db = getFirestore(getFirebaseAdminApp())) {
    this.events = db.collection("events");
    this.invites = db.collection("eventInvites");
  }

  private async ownedEvent(transaction: Transaction, eventId: string, uid: string) {
    if (eventId.length > 80 || !eventIdPattern.test(eventId)) {
      throw new HostInviteError("not_found");
    }
    const event = (await transaction.get(this.events.doc(eventId))).data() as EventRecord | undefined;
    if (!event || event.ownerUid !== uid) throw new HostInviteError("not_found");
    return event;
  }

  async list(eventId: string, uid: string) {
    return this.db.runTransaction(async (transaction) => {
      const event = await this.ownedEvent(transaction, eventId, uid);
      const snapshot = await transaction.get(this.invites.where("eventId", "==", eventId));
      const invites = snapshot.docs
        .map((doc) => ({ token: doc.id, record: doc.data() as InviteRecord }))
        .sort((a, b) => b.record.createdAt.toMillis() - a.record.createdAt.toMillis())
        .map(({ token, record }) => toHostInvite(token, record));

      return {
        name: event.name,
        startAt: event.startAt?.toDate().toISOString() ?? null,
        invites,
        checkedAt: snapshot.readTime.toMillis(),
      };
    }, { readOnly: true });
  }

  async create(eventId: string, uid: string, input: InviteInput) {
    const token = randomBytes(32).toString("base64url");
    return this.db.runTransaction(async (transaction) => {
      const event = await this.ownedEvent(transaction, eventId, uid);
      const followsStart = input.expiration === "event-start";
      const expiresAt = input.expiration === "event-start"
        ? event.startAt
        : Timestamp.fromDate(input.expiration);
      const now = Timestamp.now();
      if (!expiresAt) throw new HostInviteError("expiration_required");
      if (expiresAt.toMillis() <= now.toMillis()) throw new HostInviteError("expiration_in_past");

      const record: InviteRecord = {
        eventId,
        slug: input.slug,
        createdAt: now,
        expiresAt,
        expirationMode: followsStart ? "event-start" : "manual",
        disabledAt: null,
      };
      transaction.create(this.invites.doc(token), record);
      return toHostInvite(token, record);
    });
  }

  async disable(eventId: string, uid: string, token: string) {
    const ref = this.invites.doc(token);
    return this.db.runTransaction(async (transaction) => {
      await this.ownedEvent(transaction, eventId, uid);
      const record = (await transaction.get(ref)).data() as InviteRecord | undefined;
      if (!record || record.eventId !== eventId) throw new HostInviteError("not_found");

      if (!record.disabledAt) {
        record.disabledAt = Timestamp.now();
        transaction.update(ref, { disabledAt: record.disabledAt });
      }
      return toHostInvite(token, record);
    });
  }
}
