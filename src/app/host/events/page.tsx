import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { HostEventError, HostEvents } from "@/lib/events/host-events";
import CreateEventForm from "./create-event-form";
import EventStartTime from "./event-start-time";

export const runtime = "nodejs";

export default async function HostEventsPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/");

  const events = await new HostEvents().list(session.uid).catch((error: unknown) => {
    if (error instanceof HostEventError && error.code === "host_approval_required") notFound();
    throw error;
  });

  return (
    <main className="page invite-page host-events-page">
      <Link href="/account">Back to account</Link>
      <h1>Host events</h1>
      <CreateEventForm />

      <section aria-labelledby="host-event-list-title">
        <h2 id="host-event-list-title">Your events</h2>
        {events.length === 0 ? <p>You haven’t created any events yet.</p> : (
          <ul className="stack invite-list">
            {events.map(({ eventId, name, startAt, capacity }) => (
              <li key={eventId} className="stack invite-panel">
                <h3>{name}</h3>
                <p className="invite-meta">
                  {startAt ? <EventStartTime startAt={startAt} /> : "Start time TBA"}
                  {" · "}{capacity === null ? "Unlimited RSVPs" : `RSVP capacity ${capacity}`}
                </p>
                <div className="invite-actions">
                  <Link href={`/host/events/${eventId}/details`} aria-label={`Edit details for ${name}`}>
                    Edit details
                  </Link>
                  <Link href={`/host/events/${eventId}/schedule`} aria-label={`Edit start for ${name}`}>
                    Edit start
                  </Link>
                  <Link href={`/host/events/${eventId}/invites`} aria-label={`Manage guest invites for ${name}`}>
                    Manage guest invites
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
