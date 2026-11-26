import { parseUtcTimestamp } from "@/lib/time/utc-timestamp";

export const eventNameMaxLength = 120;
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type HostEvent = {
  eventId: string;
  name: string;
  startAt: string | null;
  capacity: number | null;
};

export type EventFields = "name" | "startAt" | "capacity";
export type EventFieldErrors = Partial<Record<EventFields, string>>;
export type EventCreationInput = Pick<HostEvent, "name" | "capacity"> & {
  requestId: string;
  startAt: Date | null;
};

type InputResult = { input: EventCreationInput } | { fields: EventFieldErrors } | null;

export function parseEventCreation(body: unknown): InputResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { requestId, name, startAt, capacity } = body as Record<string, unknown>;
  if (typeof requestId !== "string" || !requestIdPattern.test(requestId)) return null;

  const fields: EventFieldErrors = {};
  const eventName = typeof name === "string" ? name.trim() : "";
  if (!eventName || eventName.length > eventNameMaxLength) {
    fields.name = `Enter an event name up to ${eventNameMaxLength} characters.`;
  }
  const start = parseUtcTimestamp(startAt);
  if (startAt !== null && !start) fields.startAt = "Choose a valid start date and time or mark it TBA.";
  const limit = capacity === undefined || capacity === null ? null : capacity;
  if (limit !== null && (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1)) {
    fields.capacity = "Enter a positive whole number or leave capacity blank.";
    return { fields };
  }
  if (fields.name || fields.startAt) return { fields };

  return { input: { requestId: requestId.toLowerCase(), name: eventName, startAt: start, capacity: limit } };
}
