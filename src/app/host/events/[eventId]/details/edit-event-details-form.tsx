"use client";

import { useState, type FormEvent } from "react";
import {
  privateDetailFields, privateDetailKeys,
  type EditableEventDetails, type EventDetailsErrors, type EventDetailsPatch,
} from "@/lib/events/event-details-input";
import { eventNameMaxLength } from "@/lib/events/host-event-input";

export default function EditEventDetailsForm({ eventId, initialDetails }: {
  eventId: string;
  initialDetails: EditableEventDetails;
}) {
  const [saved, setSaved] = useState(initialDetails);
  const [draft, setDraft] = useState(initialDetails);
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<EventDetailsErrors>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  function change(field: keyof EditableEventDetails, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setFields((current) => ({ ...current, [field]: undefined }));
    setStatus("");
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFields({});
    setError("");
    setStatus("");

    const patch: EventDetailsPatch = {};
    if (draft.name.trim() !== saved.name) patch.name = draft.name.trim();
    for (const key of privateDetailKeys) {
      const value = draft[key]?.trim() || null;
      if (value !== (saved[key] ?? null)) patch[key] = value;
    }
    if (!Object.keys(patch).length) {
      setDraft(saved);
      setStatus("No changes to save.");
      return;
    }

    setPending(true);
    try {
      const response = await fetch(`/api/host/events/${eventId}/details`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const result = await response.json();
      if (!response.ok) {
        setFields(result.fields ?? {});
        setError(result.message ?? "Couldn’t save the event details.");
        return;
      }
      setSaved(result);
      setDraft(result);
      setStatus("Event details saved.");
    } catch {
      setError("Couldn’t save the event details. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="stack invite-panel" method="post" onSubmit={saveDetails}>
      <fieldset className="stack invite-expiration" disabled={pending}>
        <label htmlFor="name">Event name</label>
        <input id="name" name="name" required maxLength={eventNameMaxLength} value={draft.name}
          onChange={(event) => change("name", event.target.value)} aria-invalid={Boolean(fields.name)}
          aria-describedby={fields.name ? "name-error" : undefined} />
        {fields.name && <p id="name-error" className="error">{fields.name}</p>}

        <p className="invite-meta">Only confirmed guests can see the optional details below. Leave a field blank to clear it.</p>
        {privateDetailKeys.map((key) => {
          const { label, maxLength } = privateDetailFields[key];
          return (
            <div className="stack" key={key}>
              <label htmlFor={key}>{label}</label>
              <textarea id={key} name={key} rows={key === "description" ? 4 : 2} maxLength={maxLength}
                value={draft[key] ?? ""} onChange={(event) => change(key, event.target.value)}
                aria-invalid={Boolean(fields[key])} aria-describedby={fields[key] ? `${key}-error` : undefined} />
              {fields[key] && <p id={`${key}-error`} className="error">{fields[key]}</p>}
            </div>
          );
        })}
      </fieldset>
      <button className="button" type="submit" disabled={pending}>{pending ? "Saving…" : "Save details"}</button>
      {error && <p className="error" role="alert">{error}</p>}
      <div role="status">{status}</div>
    </form>
  );
}
