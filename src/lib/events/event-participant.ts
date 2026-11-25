import "server-only";

import { createHash } from "node:crypto";
import type { Timestamp } from "firebase-admin/firestore";

export type EventParticipant = {
  uid: string;
  membershipStatus: "active" | "canceled" | "removed";
  blockedAt: Timestamp | null;
  rsvpStatus: "none" | "waitlisted" | "confirmed";
  waitlistPosition: number | null;
  joinedAt: Timestamp;
};

export function eventAccountKey(uid: string): string {
  return createHash("sha256").update(uid).digest("hex");
}

export function isActiveEventGuest(guest: EventParticipant | undefined): guest is EventParticipant {
  return guest?.membershipStatus === "active" && !guest.blockedAt;
}
