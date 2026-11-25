"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

const rsvpLabels = {
  none: "You haven’t RSVPed yet.",
  waitlisted: "You’re on the waitlist.",
  confirmed: "You’re going.",
};

export default function RsvpSection({
  eventId,
  rsvpStatus,
}: {
  eventId: string;
  rsvpStatus: keyof typeof rsvpLabels;
}) {
  const router = useRouter();
  const button = useRef<HTMLButtonElement>(null);
  const statusText = useRef<HTMLParagraphElement>(null);
  const moveFocusOnResult = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState(false);
  const pending = submitting || refreshing;

  useEffect(() => {
    // Keep keyboard focus in this section when the refreshed result replaces the button.
    if (rsvpStatus !== "none" && moveFocusOnResult.current) {
      moveFocusOnResult.current = false;
      statusText.current?.focus();
    }
  }, [rsvpStatus]);

  async function submitRsvp() {
    if (pending) return;

    setSubmitting(true);
    setError(false);
    try {
      const response = await fetch(`/api/events/${eventId}/rsvp`, { method: "POST" });
      if (response.ok || response.status === 401 || response.status === 404) {
        moveFocusOnResult.current = response.ok && document.activeElement === button.current;
        startRefresh(() => router.refresh());
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="event-rsvp">
      <h2 id="event-rsvp">RSVP status</h2>
      <div className="stack">
        <p ref={statusText} role="status" tabIndex={-1}>
          {pending && rsvpStatus === "none" ? "Saving your RSVP…" : rsvpLabels[rsvpStatus]}
        </p>
        {rsvpStatus === "none" && (
          <button ref={button} className="button" type="button" aria-disabled={pending} onClick={submitRsvp}>
            RSVP
          </button>
        )}
        {error && <p className="error" role="alert">We couldn’t save your RSVP. Try again.</p>}
      </div>
    </section>
  );
}
