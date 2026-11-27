"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import type { HostCapacityView } from "@/lib/events/host-capacity-input";

export default function EditEventCapacityForm({ eventId, event }: { eventId: string; event: HostCapacityView }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [capacityText, setCapacityText] = useState(event.capacity?.toString() ?? "");
  const [unlimited, setUnlimited] = useState(event.capacity === null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const { confirmedGuests, waitlistedCount } = event;
  const capacity = unlimited ? null : Number(capacityText);
  const validLimit = capacity === null || (/^\d+$/.test(capacityText) && Number.isSafeInteger(capacity) && capacity > 0);
  const requiredRemovals = validLimit && capacity !== null ? Math.max(0, confirmedGuests.length - capacity) : 0;
  const pending = saving || refreshing;

  function resetSelection() {
    setSelected([]);
    setError("");
    setStatus("");
  }

  async function saveCapacity(submission: FormEvent<HTMLFormElement>) {
    submission.preventDefault();
    if (pending) return;
    setError("");
    setStatus("");
    if (!validLimit) {
      setError("Enter a positive whole number or choose Unlimited RSVPs.");
      return;
    }
    if (selected.length < requiredRemovals) {
      setError("Select enough confirmed guests to remove before saving.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/host/events/${eventId}/capacity`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capacity, removeParticipantIds: requiredRemovals ? selected : [] }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.message ?? "Couldn’t save capacity.");
        if (response.status === 409) {
          setSelected([]);
          startRefresh(() => router.refresh());
        }
        return;
      }

      setCapacityText(result.capacity?.toString() ?? "");
      setSelected([]);
      const summary = ["Capacity saved."];
      if (result.promotedCount) summary.push(`Confirmed from the waitlist: ${result.promotedCount}.`);
      if (result.removedCount) summary.push(`Guests removed: ${result.removedCount}.`);
      setStatus(summary.join(" "));
      startRefresh(() => router.refresh());
    } catch {
      setError("Couldn’t save capacity. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack invite-panel" method="post" onSubmit={saveCapacity}>
      <p>{confirmedGuests.length} confirmed · {waitlistedCount} waitlisted</p>
      <fieldset className="stack invite-expiration" disabled={pending}>
        <label className="invite-choice">
          <input type="checkbox" checked={unlimited} onChange={(change) => {
            setUnlimited(change.target.checked);
            resetSelection();
          }} />
          Unlimited RSVPs
        </label>
        {!unlimited && (
          <>
            <label htmlFor="rsvp-capacity">RSVP capacity</label>
            <input id="rsvp-capacity" name="capacity" inputMode="numeric" required value={capacityText}
              aria-invalid={!validLimit && Boolean(error)} aria-describedby={!validLimit && error ? "capacity-error" : undefined}
              onChange={(change) => {
                setCapacityText(change.target.value);
                resetSelection();
              }} />
          </>
        )}
      </fieldset>
      {requiredRemovals > 0 && (
        <fieldset className="stack invite-expiration" disabled={pending} aria-describedby="capacity-removal-help">
          <legend>Remove confirmed guests</legend>
          <p id="capacity-removal-help">Select at least {requiredRemovals}. Removed guests lose access to this event and can’t rejoin through an invite.</p>
          {confirmedGuests.map(({ participantId, label }) => (
            <label className="invite-choice invite-meta" key={participantId}>
              <input type="checkbox" checked={selected.includes(participantId)} onChange={(change) => {
                setSelected((ids) => change.target.checked ? [...ids, participantId] : ids.filter((id) => id !== participantId));
                setError("");
              }} />
              <span>{label}</span>
            </label>
          ))}
          <p aria-live="polite">{selected.length} selected</p>
        </fieldset>
      )}
      <button className="button" type="submit" disabled={pending}>
        {pending ? "Saving…" : requiredRemovals > 0 ? "Save capacity and remove guests" : "Save capacity"}
      </button>
      {error && <p className="error" id="capacity-error" role="alert">{error}</p>}
      <div role="status">{status}</div>
    </form>
  );
}
