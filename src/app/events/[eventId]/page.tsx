import { notFound } from "next/navigation";
import SignInForm from "@/app/auth/sign-in-form";
import { getCurrentSession } from "@/lib/auth/session";
import { readEventView } from "@/lib/events/event-access";
import { isEventId } from "@/lib/events/event-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rsvpLabels = {
  none: "You haven’t RSVPed yet.",
  waitlisted: "You’re on the waitlist.",
  confirmed: "You’re going.",
};

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

  return (
    <main className="page event-page">
      <h1>{event.name}</h1>
      {event.role === "guest" && (
        <section aria-labelledby="event-rsvp">
          <h2 id="event-rsvp">RSVP status</h2>
          <p>{rsvpLabels[event.rsvpStatus]}</p>
        </section>
      )}
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
          </dl>
        </section>
      )}
    </main>
  );
}
