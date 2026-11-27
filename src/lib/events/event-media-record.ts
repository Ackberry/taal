import type { Timestamp } from "firebase-admin/firestore";

export type EventImageKind = "photo" | "reference";

export type EventImageSummary = {
  id: string;
  kind: EventImageKind;
  alt: string;
};

export type EventImageRecord = EventImageSummary & {
  objectPath: string;
  createdAt: Timestamp;
};

export const eventImageAltMaxLength = 200;
export const eventPhotoDocumentId = "photo";

export function eventImageSummary({ id, kind, alt }: EventImageRecord): EventImageSummary {
  return { id, kind, alt };
}

export function isEventImageId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
