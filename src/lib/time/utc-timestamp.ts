const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function parseUtcTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || !utcTimestampPattern.test(value) || value.startsWith("0000-")) {
    return null;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? date : null;
}
