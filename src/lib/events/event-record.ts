import type { Timestamp } from "firebase-admin/firestore";
import { privateDetailKeys, type PrivateEventDetails } from "./event-details-input";

export type EventRecord = {
  ownerUid: string;
  name: string;
  startAt: Timestamp | null;
  capacity?: number | null;
  rsvpSequence?: number;
  creationFingerprint?: string;
  privateDetails?: PrivateEventDetails;
  mediaCount?: number;
};

export function selectPrivateEventDetails(event: EventRecord): PrivateEventDetails {
  const details: PrivateEventDetails = {};
  for (const key of privateDetailKeys) {
    const value = event.privateDetails?.[key];
    if (typeof value === "string" && value) details[key] = value;
  }
  return details;
}

export const eventIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isEventId(value: string): boolean {
  return value.length <= 80 && eventIdPattern.test(value);
}
