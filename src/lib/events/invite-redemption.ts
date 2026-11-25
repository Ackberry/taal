import "server-only";

import { createHash } from "node:crypto";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "@/lib/firebase/admin";
import { parseGuestInviteSegment } from "./invite-input";
import type { InviteRecord } from "./invite-record";

const attemptLimit = 10;
const windowDurationMs = 10 * 60 * 1_000;

export type EventParticipant = {
  uid: string;
  membershipStatus: "active" | "canceled" | "removed";
  blockedAt: Timestamp | null;
  rsvpStatus: "none" | "waitlisted" | "confirmed";
  waitlistPosition: number | null;
  joinedAt: Timestamp;
};

type AttemptWindow = { count: number; resetsAt: Timestamp };

type RedemptionResult =
  | { status: "redeemed"; eventId: string }
  | { status: "unavailable" }
  | { status: "rate_limited"; retryAfter: number };

function isLive(invite: InviteRecord, now: Timestamp) {
  return !invite.disabledAt && invite.expiresAt.toMillis() > now.toMillis();
}

export class InviteRedemption {
  constructor(private readonly db = getFirestore(getFirebaseAdminApp())) {}

  async isAvailable(segment: string): Promise<boolean> {
    const link = parseGuestInviteSegment(segment);
    if (!link) return false;

    const snapshot = await this.db.collection("eventInvites").doc(link.token).get();
    const invite = snapshot.data() as InviteRecord | undefined;
    if (!invite || invite.slug !== link.slug || !isLive(invite, Timestamp.now())) return false;

    return (await this.db.collection("events").doc(invite.eventId).get()).exists;
  }

  async redeem(segment: string, uid: string): Promise<RedemptionResult> {
    const link = parseGuestInviteSegment(segment);
    if (!link) return { status: "unavailable" };

    return this.db.runTransaction(async (transaction) => {
      const inviteRef = this.db.collection("eventInvites").doc(link.token);
      const invite = (await transaction.get(inviteRef)).data() as InviteRecord | undefined;
      if (!invite || invite.slug !== link.slug) return { status: "unavailable" };

      const event = this.db.collection("events").doc(invite.eventId);
      const accountKey = createHash("sha256").update(uid).digest("hex");
      const participantRef = event.collection("participants").doc(accountKey);
      const attemptRef = event.collection("inviteRedemptionAttempts").doc(accountKey);
      const [eventSnapshot, participantSnapshot, attemptSnapshot] = await transaction.getAll(
        event, participantRef, attemptRef,
      );
      if (!eventSnapshot.exists) return { status: "unavailable" };

      const now = Timestamp.now();
      const previous = attemptSnapshot.data() as AttemptWindow | undefined;
      const window = previous && previous.resetsAt.toMillis() > now.toMillis()
        ? previous
        : { count: 0, resetsAt: Timestamp.fromMillis(now.toMillis() + windowDurationMs) };
      if (window.count >= attemptLimit) {
        return {
          status: "rate_limited",
          retryAfter: Math.ceil((window.resetsAt.toMillis() - now.toMillis()) / 1_000),
        };
      }
      transaction.set(attemptRef, { ...window, count: window.count + 1 });

      const participant = participantSnapshot.data() as EventParticipant | undefined;
      if (!isLive(invite, now) || participant?.blockedAt) {
        return { status: "unavailable" };
      }

      if (participant?.membershipStatus !== "active") {
        const membership: EventParticipant = {
          uid,
          membershipStatus: "active",
          blockedAt: null,
          rsvpStatus: "none",
          waitlistPosition: null,
          joinedAt: now,
        };
        transaction.set(participantRef, membership, { merge: true });
      }

      return { status: "redeemed", eventId: invite.eventId };
    });
  }
}
