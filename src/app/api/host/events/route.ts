import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { parseEventCreation, type EventFieldErrors } from "@/lib/events/host-event-input";
import { HostEventError, HostEvents } from "@/lib/events/host-events";
import { checkSameOrigin } from "@/lib/http/same-origin";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

function eventError(status: number, code: string, message: string, fields?: EventFieldErrors) {
  return NextResponse.json({ code, message, fields }, { status, headers });
}

export async function POST(request: Request) {
  const origin = checkSameOrigin(request);
  if (origin === "invalid") return eventError(403, "invalid_origin", "This request couldn’t be verified.");
  if (origin === "unavailable") return eventError(503, "events_unavailable", "Event creation is unavailable.");

  try {
    const session = await getCurrentSession();
    if (!session) return eventError(401, "sign_in_required", "Sign in again to create an event.");

    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return eventError(415, "invalid_content_type", "The request must use JSON.");
    }

    const parsed = parseEventCreation(await request.json().catch(() => null));
    if (!parsed || "fields" in parsed) {
      return eventError(400, "invalid_input", "Check the event details and try again.", parsed?.fields);
    }

    const { event, created } = await new HostEvents().create(session.uid, parsed.input);
    return NextResponse.json(event, { status: created ? 201 : 200, headers });
  } catch (error) {
    if (error instanceof HostEventError) {
      if (error.code === "host_approval_required") {
        return eventError(403, error.code, "Only approved hosts can create events.");
      }
      return eventError(409, error.code, "This submission was already used to create a different event.");
    }

    console.error("Taal could not create an event.");
    return eventError(503, "events_unavailable", "Couldn’t create the event right now. Try again later.");
  }
}
