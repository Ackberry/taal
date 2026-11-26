"use client";

import { useState, type FormEvent } from "react";
import EventStartTime from "../../event-start-time";
import { localDateTimeValue, useBrowserTimeZone, useLocalDateTimeValue } from "@/lib/time/browser-time";

export default function EditEventScheduleForm({ eventId, startAt }: { eventId: string; startAt: string | null }) {
  const [savedStart, setSavedStart] = useState(startAt);
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [invalidStart, setInvalidStart] = useState(false);
  const [status, setStatus] = useState("");
  const timeZone = useBrowserTimeZone();
  const savedLocalStart = useLocalDateTimeValue(savedStart);
  const localStart = draft ?? savedLocalStart;

  async function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setStatus("");
    setError("");
    setInvalidStart(false);

    const start = new Date(localStart);
    if (!Number.isFinite(start.getTime()) || localDateTimeValue(start) !== localStart) {
      setInvalidStart(true);
      setError("Choose a valid start date and time in your time zone.");
      return;
    }
    if (localStart === savedLocalStart) {
      setStatus("No changes to save.");
      return;
    }

    setPending(true);
    try {
      const response = await fetch(`/api/host/events/${eventId}/schedule`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startAt: start.toISOString() }),
      });
      const result = await response.json();
      if (!response.ok) {
        setInvalidStart(response.status === 400);
        setError(result.message ?? "Couldn’t save the event start.");
        return;
      }

      setSavedStart(result.startAt);
      setDraft(null);
      setStatus("Event start saved.");
    } catch {
      setError("Couldn’t save the event start. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="stack invite-panel" method="post" onSubmit={saveSchedule}>
      <p>Current start: {savedStart ? <EventStartTime startAt={savedStart} /> : "TBA"}</p>
      <label htmlFor="start-at">Start date and time</label>
      <input id="start-at" name="startAt" type="datetime-local" required disabled={pending} value={localStart}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalidStart(false);
          setError("");
          setStatus("");
        }}
        aria-invalid={invalidStart} aria-describedby={invalidStart ? "schedule-zone schedule-error" : "schedule-zone"} />
      <p id="schedule-zone" className="invite-meta">Time zone: {timeZone}</p>
      <p className="invite-meta">Live guest links that expire at the event start will move to the new start.</p>
      <button className="button" type="submit" disabled={pending}>{pending ? "Saving…" : "Save event start"}</button>
      {error && <p id="schedule-error" className="error" role="alert">{error}</p>}
      <div role="status">{status}</div>
    </form>
  );
}
