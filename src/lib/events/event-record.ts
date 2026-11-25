import type { Timestamp } from "firebase-admin/firestore";

export type EventRecord = {
  ownerUid: string;
  name: string;
  startAt: Timestamp | null;
  capacity?: number | null;
  rsvpSequence?: number;
  creationFingerprint?: string;
};

export const eventIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isEventId(value: string): boolean {
  return value.length <= 80 && eventIdPattern.test(value);
}
