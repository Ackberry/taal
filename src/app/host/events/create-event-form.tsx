"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { eventNameMaxLength, type EventFieldErrors, type HostEvent } from "@/lib/events/host-event-input";
import { localDateTimeValue, useBrowserTimeZone } from "@/lib/time/browser-time";

export default function CreateEventForm() {
  const router = useRouter();
  const timeZone = useBrowserTimeZone();
  const submission = useRef<{ payload: string; requestId: string } | null>(null);
  const [tba, setTba] = useState(false);
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<EventFieldErrors>({});
  const [error, setError] = useState("");
  const [created, setCreated] = useState<HostEvent | null>(null);

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const localStart = String(data.get("startAt") ?? "");
    const capacityText = String(data.get("capacity") ?? "").trim();
    const start = tba ? null : new Date(localStart);
    const capacity = capacityText ? Number(capacityText) : null;
    const inputErrors: EventFieldErrors = {};
    if (!name || name.length > eventNameMaxLength) {
      inputErrors.name = `Enter an event name up to ${eventNameMaxLength} characters.`;
    }
    if (start && (!Number.isFinite(start.getTime()) || localDateTimeValue(start) !== localStart)) {
      inputErrors.startAt = "Choose a valid start date and time in your time zone or mark it TBA.";
    }
    if (capacity !== null && (!/^\d+$/.test(capacityText) || !Number.isSafeInteger(capacity) || capacity < 1)) {
      inputErrors.capacity = "Enter a positive whole number or leave capacity blank.";
    }

    setCreated(null);
    setFields(inputErrors);
    setError("");
    if (Object.keys(inputErrors).length) {
      setError("Check the highlighted fields and try again.");
      return;
    }

    setPending(true);
    try {
      const details = { name, startAt: start?.toISOString() ?? null, capacity };
      const payload = JSON.stringify(details);
      if (submission.current?.payload !== payload) {
        submission.current = { payload, requestId: crypto.randomUUID() };
      }

      const response = await fetch("/api/host/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...details, requestId: submission.current.requestId }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) submission.current = null;
        setFields(result.fields ?? {});
        setError(result.message ?? "Couldn’t create the event. Try again.");
        return;
      }

      submission.current = null;
      form.reset();
      setTba(false);
      setCreated(result);
      router.refresh();
    } catch {
      setError("Couldn’t create the event. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="stack invite-panel" onSubmit={createEvent} noValidate>
      <h2>Create a private event</h2>
      <fieldset className="stack invite-expiration" disabled={pending}>
        <label htmlFor="event-name">Event name</label>
        <input id="event-name" name="name" required maxLength={eventNameMaxLength}
          aria-invalid={Boolean(fields.name)} aria-describedby={fields.name ? "event-name-error" : undefined} />
        {fields.name && <p id="event-name-error" className="error">{fields.name}</p>}

        <label className="invite-choice">
          <input type="checkbox" name="tba" checked={tba} onChange={(event) => setTba(event.target.checked)} />
          Start date and time are TBA
        </label>
        <div hidden={tba} className="event-start-field">
          <label htmlFor="event-start">Start date and time</label>
          <input id="event-start" name="startAt" type="datetime-local" required={!tba}
            aria-invalid={Boolean(fields.startAt)}
            aria-describedby={fields.startAt ? "event-time-zone event-start-error" : "event-time-zone"} />
          <p id="event-time-zone" className="invite-meta">Time zone: {timeZone}</p>
          {fields.startAt && <p id="event-start-error" className="error">{fields.startAt}</p>}
        </div>

        <label htmlFor="event-capacity">RSVP capacity (optional)</label>
        <input id="event-capacity" name="capacity" inputMode="numeric" aria-invalid={Boolean(fields.capacity)}
          aria-describedby={fields.capacity ? "event-capacity-help event-capacity-error" : "event-capacity-help"} />
        <p id="event-capacity-help" className="invite-meta">Leave blank for unlimited RSVPs.</p>
        {fields.capacity && <p id="event-capacity-error" className="error">{fields.capacity}</p>}
      </fieldset>

      <button className="button" type="submit" disabled={pending}>{pending ? "Creating…" : "Create event"}</button>
      {error && <p className="error" role="alert">{error}</p>}
      <div role="status">
        {created && (
          <p>Created {created.name}. <Link href={`/host/events/${created.eventId}/invites`}>Manage guest invites</Link></p>
        )}
      </div>
    </form>
  );
}
