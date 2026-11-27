import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { parseCapacityChange } from "@/lib/events/host-capacity-input";
import { CapacityChangeError, HostEventCapacity } from "@/lib/events/host-event-capacity";
import { checkSameOrigin } from "@/lib/http/same-origin";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

function capacityError(status: number, code: string, message: string, requiredRemovals?: number) {
  return NextResponse.json({ code, message, requiredRemovals }, { status, headers });
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/host/events/[eventId]/capacity">) {
  const origin = checkSameOrigin(request);
  if (origin === "invalid") return capacityError(403, "invalid_origin", "This request couldn’t be verified.");
  if (origin === "unavailable") return capacityError(503, "events_unavailable", "Capacity editing is unavailable.");

  try {
    const session = await getCurrentSession();
    if (!session) return capacityError(401, "sign_in_required", "Sign in again to change capacity.");

    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return capacityError(415, "invalid_content_type", "The request must use JSON.");
    }

    const input = parseCapacityChange(await request.json().catch(() => null));
    if (!input) return capacityError(400, "invalid_input", "Enter a positive whole number or choose unlimited capacity, and use unique guest selections.");

    const { eventId } = await params;
    const result = await new HostEventCapacity().update(eventId, session.uid, input);
    if (!result) return capacityError(404, "event_unavailable", "This event is unavailable.");
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof CapacityChangeError) {
      const message = error.code === "insufficient_selection"
        ? "Select more confirmed guests to remove before lowering capacity."
        : "Attendance has changed. Reload the guest list and choose who to remove again.";
      return capacityError(409, error.code, message, error.requiredRemovals);
    }
    console.error("Taal could not update event capacity.");
    return capacityError(503, "events_unavailable", "Couldn’t save capacity. Try again later.");
  }
}
