import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { GuestRsvp } from "@/lib/events/guest-rsvp";
import { checkSameOrigin } from "@/lib/http/same-origin";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

function rsvpError(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status, headers });
}

export async function POST(request: Request, { params }: RouteContext<"/api/events/[eventId]/rsvp">) {
  const origin = checkSameOrigin(request);
  if (origin === "invalid") return rsvpError(403, "invalid_origin", "This request couldn’t be verified.");
  if (origin === "unavailable") return rsvpError(503, "rsvp_unavailable", "RSVP is unavailable.");

  try {
    const session = await getCurrentSession();
    if (!session) return rsvpError(401, "sign_in_required", "Sign in to RSVP.");

    const { eventId } = await params;
    const rsvpStatus = await new GuestRsvp().submit(eventId, session.uid);
    if (!rsvpStatus) return rsvpError(404, "event_unavailable", "This event is unavailable.");

    return NextResponse.json({ rsvpStatus }, { headers });
  } catch {
    console.error("Taal could not save an RSVP.");
    return rsvpError(503, "rsvp_unavailable", "RSVP is unavailable right now.");
  }
}
