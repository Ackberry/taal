import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { readEventView } from "@/lib/events/event-access";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

function eventError(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status, headers });
}

export async function GET(_request: Request, { params }: RouteContext<"/api/events/[eventId]">) {
  try {
    const session = await getCurrentSession();
    if (!session) return eventError(401, "sign_in_required", "Sign in to view the event.");

    const { eventId } = await params;
    const event = await readEventView(eventId, session.uid);
    if (!event) return eventError(404, "event_unavailable", "This event is unavailable.");

    return NextResponse.json(event, { headers });
  } catch {
    console.error("Taal could not read an event.");
    return eventError(503, "event_service_unavailable", "Events are unavailable right now.");
  }
}
