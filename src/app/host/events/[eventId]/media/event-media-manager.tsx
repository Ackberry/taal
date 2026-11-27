"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import EventMediaImage from "@/app/event-media-image";
import { eventImageAltMaxLength, type EventImageKind, type EventImageSummary } from "@/lib/events/event-media-record";

type MediaAction = EventImageKind | "remove";
type Feedback = { action: MediaAction; message: string; error?: boolean };

export default function EventMediaManager({ eventId, photo, references }: {
  eventId: string;
  photo?: EventImageSummary;
  references: EventImageSummary[];
}) {
  const router = useRouter();
  const referenceHeading = useRef<HTMLHeadingElement>(null);
  const [refreshing, startRefresh] = useTransition();
  const [action, setAction] = useState<MediaAction | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const pending = action !== null || refreshing;
  const endpoint = `/api/host/events/${eventId}/media`;

  async function changeMedia(nextAction: MediaAction, url: string, options: RequestInit, success: string, form?: HTMLFormElement) {
    if (pending) return;
    setAction(nextAction);
    setFeedback(null);
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        setFeedback({ action: nextAction, message: result?.message ?? "Couldn’t update event images.", error: true });
        if (response.status === 404) startRefresh(() => router.refresh());
        return;
      }

      form?.reset();
      if (nextAction === "remove") referenceHeading.current?.focus();
      setFeedback({ action: nextAction, message: success });
      startRefresh(() => router.refresh());
    } catch {
      setFeedback({ action: nextAction, message: "Couldn’t update event images. Try again.", error: true });
    } finally {
      setAction(null);
    }
  }

  function upload(event: FormEvent<HTMLFormElement>, kind: EventImageKind) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    body.set("kind", kind);
    const success = kind === "photo" ? "Event photo saved." : "Reference image added.";
    void changeMedia(kind, endpoint, { method: "POST", body }, success, form);
  }

  return (
    <>
      <section className="stack" aria-labelledby="event-photo-heading">
        <h2 id="event-photo-heading">Event photo</h2>
        {photo && <EventMediaImage eventId={eventId} image={photo} eager />}
        <ImageUploadForm kind="photo" label={photo ? "Replace event photo" : "Add event photo"}
          pending={pending} uploading={action === "photo"} onSubmit={upload} />
        <MediaFeedback feedback={feedback?.action === "photo" ? feedback : null} />
      </section>

      <section className="stack" aria-labelledby="reference-images-heading">
        <h2 id="reference-images-heading" ref={referenceHeading} tabIndex={-1}>Private reference images</h2>
        <p className="invite-meta">Confirmed guests can see these images on the event page.</p>
        {references.length > 0 && (
          <ul className="event-image-list invite-list">
            {references.map((image, index) => (
              <li className="stack invite-panel" key={image.id}>
                <EventMediaImage eventId={eventId} image={image} />
                <p className="invite-meta">{image.alt || `Reference image ${index + 1}`}</p>
                <button className="button button-secondary" type="button" disabled={pending}
                  aria-label={`Remove image ${index + 1}${image.alt ? ` (${image.alt})` : ""}`}
                  onClick={() => void changeMedia("remove", `${endpoint}?imageId=${image.id}`, { method: "DELETE" }, "Reference image removed.")}>
                  Remove image
                </button>
              </li>
            ))}
          </ul>
        )}
        <div aria-busy={action === "remove"}>
          <MediaFeedback feedback={feedback?.action === "remove" ? feedback : null} />
        </div>
        <ImageUploadForm kind="reference" label="Add reference image" pending={pending}
          uploading={action === "reference"} onSubmit={upload} />
        <MediaFeedback feedback={feedback?.action === "reference" ? feedback : null} />
      </section>
    </>
  );
}

function ImageUploadForm({ kind, label, pending, uploading, onSubmit }: {
  kind: EventImageKind;
  label: string;
  pending: boolean;
  uploading: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>, kind: EventImageKind) => void;
}) {
  return (
    <form className="stack invite-panel event-image-upload" method="post" encType="multipart/form-data"
      onSubmit={(event) => onSubmit(event, kind)}>
      <fieldset className="stack invite-expiration" disabled={pending}>
        <label htmlFor={`${kind}-file`}>{kind === "photo" ? "Event photo file" : "Reference image file"}</label>
        <input id={`${kind}-file`} name="image" type="file" required
          accept="image/jpeg,image/png,image/webp" aria-describedby={`${kind}-limits`} />
        <p id={`${kind}-limits`} className="invite-meta">JPEG, PNG, or still WebP up to 3 MB.</p>
        <label htmlFor={`${kind}-alt`}>Image description (optional)</label>
        <input id={`${kind}-alt`} name="alt" type="text" maxLength={eventImageAltMaxLength} />
      </fieldset>
      <button className="button" type="submit" disabled={pending}>{uploading ? "Uploading…" : label}</button>
    </form>
  );
}

function MediaFeedback({ feedback }: { feedback: Feedback | null }) {
  return (
    <>
      <div role="status">{!feedback?.error && feedback?.message}</div>
      {feedback?.error && <p className="error" role="alert">{feedback.message}</p>}
    </>
  );
}
