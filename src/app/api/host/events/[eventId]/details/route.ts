import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { parseEventDetailsPatch, type EventDetailsErrors } from "@/lib/events/event-details-input";
import { HostEventDetails } from "@/lib/events/host-event-details";
import { checkSameOrigin } from "@/lib/http/same-origin";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

function eventError(status: number, code: string, message: string, fields?: EventDetailsErrors) {
  return NextResponse.json({ code, message, fields }, { status, headers });
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/host/events/[eventId]/details">) {
  const origin = checkSameOrigin(request);
  if (origin === "invalid") return eventError(403, "invalid_origin", "This request couldn’t be verified.");
  if (origin === "unavailable") return eventError(503, "events_unavailable", "Event editing is unavailable.");

  try {
    const session = await getCurrentSession();
    if (!session) return eventError(401, "sign_in_required", "Sign in again to edit this event.");

    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return eventError(415, "invalid_content_type", "The request must use JSON.");
    }

    const parsed = parseEventDetailsPatch(await request.json().catch(() => null));
    if (!parsed || "fields" in parsed) {
      return eventError(400, "invalid_input", "Check the event details and try again.", parsed?.fields);
    }

    const { eventId } = await params;
    const details = await new HostEventDetails().update(eventId, session.uid, parsed.input);
    if (!details) return eventError(404, "event_unavailable", "This event is unavailable.");
    return NextResponse.json(details, { headers });
  } catch {
    console.error("Taal could not update event details.");
    return eventError(503, "events_unavailable", "Couldn’t save the event details. Try again later.");
  }
}
