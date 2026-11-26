export class EventStartInPastError extends Error {
  constructor() {
    super("Choose a start date and time in the future.");
  }
}

export function assertFutureEventStart(startAt: Date, now = Date.now()): void {
  if (startAt.getTime() <= now) throw new EventStartInPastError();
}
