import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { HostEventCapacity } from "@/lib/events/host-event-capacity";
import EditEventCapacityForm from "./edit-event-capacity-form";

export const runtime = "nodejs";

export default async function EditEventCapacityPage({ params }: PageProps<"/host/events/[eventId]/capacity">) {
  const session = await getCurrentSession();
  if (!session) redirect("/");

  const { eventId } = await params;
  const event = await new HostEventCapacity().read(eventId, session.uid);
  if (!event) notFound();

  return (
    <main className="page invite-page host-events-page">
      <Link href="/host/events">Back to host events</Link>
      <h1>Edit RSVP capacity</h1>
      <p className="invite-event-name">{event.name}</p>
      <EditEventCapacityForm eventId={eventId} event={event} />
    </main>
  );
}
