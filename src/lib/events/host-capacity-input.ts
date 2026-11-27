export type CapacityChange = { capacity: number | null; removeParticipantIds: string[] };

export function parseCapacityChange(body: unknown): CapacityChange | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (Object.keys(body).some((key) => key !== "capacity" && key !== "removeParticipantIds")) return null;

  const { capacity, removeParticipantIds = [] } = body as Record<string, unknown>;
  if (capacity !== null && (typeof capacity !== "number" || !Number.isSafeInteger(capacity) || capacity < 1)) {
    return null;
  }
  if (!Array.isArray(removeParticipantIds) ||
    removeParticipantIds.some((id) => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) ||
    new Set(removeParticipantIds).size !== removeParticipantIds.length) {
    return null;
  }
  return { capacity, removeParticipantIds };
}
