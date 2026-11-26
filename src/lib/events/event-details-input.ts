import { eventNameMaxLength } from "./host-event-input";

export const privateDetailFields = {
  location: { label: "Venue or address", maxLength: 300 },
  description: { label: "Description", maxLength: 4000 },
  dressCode: { label: "Theme or dress code", maxLength: 500 },
  lastEntryTime: { label: "Last entry time (include time zone)", maxLength: 100 },
  idRequirements: { label: "ID requirements", maxLength: 500 },
  plusOnePolicy: { label: "Plus-one policy", maxLength: 500 },
  directions: { label: "Directions", maxLength: 1000 },
  entrance: { label: "Entrance", maxLength: 500 },
  dropOff: { label: "Shuttle or rideshare drop-off", maxLength: 500 },
  stepFreeAccess: { label: "Step-free access", maxLength: 500 },
  contact: { label: "Event or accessibility contact", maxLength: 500 },
} as const;

export type PrivateDetailKey = keyof typeof privateDetailFields;
export const privateDetailKeys = Object.keys(privateDetailFields) as PrivateDetailKey[];
export type PrivateEventDetails = Partial<Record<PrivateDetailKey, string>>;
export type EditableEventDetails = { name: string } & PrivateEventDetails;
export type EventDetailsPatch = { name?: string } & Partial<Record<PrivateDetailKey, string | null>>;
export type EventDetailsErrors = Partial<Record<"name" | PrivateDetailKey, string>>;

type InputResult = { input: EventDetailsPatch } | { fields: EventDetailsErrors } | null;

export function parseEventDetailsPatch(body: unknown): InputResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const values = body as Record<string, unknown>;
  if (Object.keys(values).some((key) => key !== "name" && !Object.hasOwn(privateDetailFields, key))) return null;

  const input: EventDetailsPatch = {};
  const fields: EventDetailsErrors = {};
  if (Object.hasOwn(values, "name")) {
    const name = typeof values.name === "string" ? values.name.trim() : "";
    if (!name || name.length > eventNameMaxLength) {
      fields.name = `Enter an event name up to ${eventNameMaxLength} characters.`;
    } else {
      input.name = name;
    }
  }

  for (const key of privateDetailKeys) {
    if (!Object.hasOwn(values, key)) continue;
    const value = values[key];
    const { maxLength } = privateDetailFields[key];
    if (value === null) {
      input[key] = null;
    } else if (typeof value === "string" && value.trim().length <= maxLength) {
      input[key] = value.trim() || null;
    } else {
      fields[key] = `Enter text up to ${maxLength} characters or leave this field blank.`;
    }
  }

  return Object.keys(fields).length ? { fields } : { input };
}
