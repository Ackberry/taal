import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { HostEventDetails } from "@/lib/events/host-event-details";
import EditEventDetailsForm from "./edit-event-details-form";

export const runtime = "nodejs";

export default async function EditEventDetailsPage({ params }: PageProps<"/host/events/[eventId]/details">) {
  const session = await getCurrentSession();
  if (!session) redirect("/");

  const { eventId } = await params;
  const details = await new HostEventDetails().read(eventId, session.uid);
  if (!details) notFound();

  return (
    <main className="page invite-page host-events-page">
      <nav className="invite-actions" aria-label="Event navigation">
        <Link href="/host/events">Back to host events</Link>
        <Link href={`/events/${eventId}`}>View event</Link>
      </nav>
      <h1>Edit event details</h1>
      <EditEventDetailsForm eventId={eventId} initialDetails={details} />
    </main>
  );
}
