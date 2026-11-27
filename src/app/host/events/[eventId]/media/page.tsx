import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { readEventView } from "@/lib/events/event-access";
import EventMediaManager from "./event-media-manager";

export const runtime = "nodejs";

export default async function HostEventMediaPage({ params }: PageProps<"/host/events/[eventId]/media">) {
  const session = await getCurrentSession();
  if (!session) redirect("/");

  const { eventId } = await params;
  const event = await readEventView(eventId, session.uid);
  if (event?.role !== "host") notFound();

  return (
    <main className="page invite-page host-events-page">
      <nav className="invite-actions" aria-label="Event navigation">
        <Link href="/host/events">Back to host events</Link>
        <Link href={`/events/${eventId}`}>View event</Link>
      </nav>
      <h1>Manage event images</h1>
      <p className="invite-event-name">{event.name}</p>
      <EventMediaManager eventId={eventId} photo={event.photo} references={event.details.referenceImages ?? []} />
    </main>
  );
}
