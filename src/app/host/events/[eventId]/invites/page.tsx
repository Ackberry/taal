import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { HostInviteError, HostInvites } from "@/lib/events/host-invites";
import { getAppOrigin } from "@/lib/http/same-origin";
import InviteManager from "./invite-manager";

export const runtime = "nodejs";

export default async function HostInvitesPage({ params }: PageProps<"/host/events/[eventId]/invites">) {
  const session = await getCurrentSession();
  if (!session) redirect("/");

  const { eventId } = await params;
  const event = await new HostInvites().list(eventId, session.uid).catch((error: unknown) => {
    if (error instanceof HostInviteError && error.code === "not_found") notFound();
    throw error;
  });
  const origin = getAppOrigin();
  if (!origin) throw new Error("Taal’s public origin is required.");

  return (
    <main className="page invite-page">
      <p className="invite-event-name">{event.name}</p>
      <h1>Guest invites</h1>
      <InviteManager eventId={eventId} origin={origin} startAt={event.startAt}
        initialInvites={event.invites} checkedAt={event.checkedAt} />
    </main>
  );
}
