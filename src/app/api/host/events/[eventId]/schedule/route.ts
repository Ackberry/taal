import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { HostEventSchedule } from "@/lib/events/host-event-schedule";
import { checkSameOrigin } from "@/lib/http/same-origin";
import { parseUtcTimestamp } from "@/lib/time/utc-timestamp";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

function scheduleError(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status, headers });
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/host/events/[eventId]/schedule">) {
  const origin = checkSameOrigin(request);
  if (origin === "invalid") return scheduleError(403, "invalid_origin", "This request couldn’t be verified.");
  if (origin === "unavailable") return scheduleError(503, "events_unavailable", "Event scheduling is unavailable.");

  try {
    const session = await getCurrentSession();
    if (!session) return scheduleError(401, "sign_in_required", "Sign in again to reschedule this event.");

    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return scheduleError(415, "invalid_content_type", "The request must use JSON.");
    }

    const body: unknown = await request.json().catch(() => null);
    const startAt = body && typeof body === "object" && "startAt" in body && Object.keys(body).length === 1
      ? parseUtcTimestamp(body.startAt)
      : null;
    if (!startAt) return scheduleError(400, "invalid_input", "Choose a valid start date and time.");

    const { eventId } = await params;
    const schedule = await new HostEventSchedule().reschedule(eventId, session.uid, startAt);
    if (!schedule) return scheduleError(404, "event_unavailable", "This event is unavailable.");
    return NextResponse.json(schedule, { headers });
  } catch {
    console.error("Taal could not reschedule an event.");
    return scheduleError(503, "events_unavailable", "Couldn’t save the event start. Try again later.");
  }
}
