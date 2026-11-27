import { notFound } from "next/navigation";
import SignInForm from "@/app/auth/sign-in-form";
import EventMediaImage, { eventImageUrl } from "@/app/event-media-image";
import { getCurrentSession } from "@/lib/auth/session";
import { readEventView } from "@/lib/events/event-access";
import { privateDetailFields, privateDetailKeys } from "@/lib/events/event-details-input";
import { isEventId } from "@/lib/events/event-record";
import RsvpSection from "./rsvp-section";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const timeFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long", timeStyle: "short", timeZone: "UTC",
});

export default async function EventPage({ params }: PageProps<"/events/[eventId]">) {
  const { eventId } = await params;
  if (!isEventId(eventId)) notFound();

  const session = await getCurrentSession();
  if (!session) {
    return (
      <main className="page">
        <h1>Sign in to view the event</h1>
        <SignInForm returnPath={`/events/${eventId}`} />
      </main>
    );
  }

  const event = await readEventView(eventId, session.uid);
  if (!event) notFound();
  const references = "details" in event ? event.details.referenceImages : undefined;

  return (
    <main className="page event-page">
      <h1>{event.name}</h1>
      {event.role === "guest" && (
        <RsvpSection eventId={eventId} rsvpStatus={event.rsvpStatus} />
      )}
      {event.photo && <div className="event-photo"><EventMediaImage eventId={eventId} image={event.photo} eager /></div>}
      {"details" in event && (
        <section aria-labelledby="event-details">
          <h2 id="event-details">Event details</h2>
          <dl>
            <dt>Start time</dt>
            <dd>{event.details.startAt ? (
              <time dateTime={event.details.startAt}>
                {timeFormat.format(new Date(event.details.startAt))} UTC
              </time>
            ) : "TBA"}</dd>
            {privateDetailKeys.map((key) => {
              const value = event.details[key];
              if (!value && key !== "location") return null;
              return (
                <div key={key}>
                  <dt>{key === "lastEntryTime" ? "Last entry time" : privateDetailFields[key].label}</dt>
                  <dd>{value ?? "TBA"}</dd>
                </div>
              );
            })}
          </dl>
        </section>
      )}
      {references && references.length > 0 && (
        <section aria-labelledby="event-reference-images">
          <h2 id="event-reference-images">Reference images</h2>
          <ul className="event-image-list invite-list">
            {references.map((image, index) => (
              <li key={image.id}>
                <a className="event-image-link" href={eventImageUrl(eventId, image.id)}
                  aria-label={`Open reference image ${index + 1}${image.alt ? ` (${image.alt})` : ""}`}>
                  <EventMediaImage eventId={eventId} image={image} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
