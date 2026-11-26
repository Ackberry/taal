import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { HostEventSchedule } from "@/lib/events/host-event-schedule";
import EditEventScheduleForm from "./edit-event-schedule-form";

export const runtime = "nodejs";

export default async function EditEventSchedulePage({ params }: PageProps<"/host/events/[eventId]/schedule">) {
  const session = await getCurrentSession();
  if (!session) redirect("/");

  const { eventId } = await params;
  const event = await new HostEventSchedule().read(eventId, session.uid);
  if (!event) notFound();

  return (
    <main className="page invite-page host-events-page">
      <nav className="invite-actions" aria-label="Event navigation">
        <Link href="/host/events">Back to host events</Link>
        <Link href={`/host/events/${eventId}/invites`}>Manage guest invites</Link>
        <Link href={`/events/${eventId}`}>View event</Link>
      </nav>
      <h1>Edit event start</h1>
      <p className="invite-event-name">{event.name}</p>
      <EditEventScheduleForm eventId={eventId} startAt={event.startAt} />
    </main>
  );
}
