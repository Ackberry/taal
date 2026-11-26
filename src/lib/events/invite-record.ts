import type { Timestamp } from "firebase-admin/firestore";
import type { HostInvite } from "./invite-input";

export type InviteRecord = {
  eventId: string;
  slug: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  expirationMode: HostInvite["expirationMode"];
  disabledAt: Timestamp | null;
};

export function isLiveInvite(invite: InviteRecord, now: Timestamp): boolean {
  return !invite.disabledAt && invite.expiresAt.toMillis() > now.toMillis();
}
