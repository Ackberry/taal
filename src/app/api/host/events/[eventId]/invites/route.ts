import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { HostInviteError, HostInvites } from "@/lib/events/host-invites";
import { inviteTokenPattern, parseInviteInput, type HostInvite } from "@/lib/events/invite-input";
import { checkSameOrigin } from "@/lib/http/same-origin";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

function inviteError(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status, headers });
}

async function writeInvite(
  request: Request,
  context: RouteContext<"/api/host/events/[eventId]/invites">,
  operation: (body: unknown, eventId: string, uid: string) => Promise<HostInvite | null>,
  successStatus: number,
) {
  const origin = checkSameOrigin(request);
  if (origin === "invalid") return inviteError(403, "invalid_origin", "This request couldn’t be verified.");
  if (origin === "unavailable") return inviteError(503, "invites_unavailable", "Invites are unavailable.");

  try {
    const session = await getCurrentSession();
    if (!session) return inviteError(401, "sign_in_required", "Sign in again to manage invites.");

    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return inviteError(415, "invalid_content_type", "The request must use JSON.");
    }

    const { eventId } = await context.params;
    const body: unknown = await request.json().catch(() => null);
    const invite = await operation(body, eventId, session.uid);
    return invite
      ? NextResponse.json(invite, { status: successStatus, headers })
      : inviteError(400, "invalid_input", "Check the invite details and try again.");
  } catch (error) {
    if (error instanceof HostInviteError) {
      switch (error.code) {
        case "not_found":
          return inviteError(404, error.code, "This event or invite is unavailable.");
        case "expiration_required":
          return inviteError(400, error.code, "Choose an expiration date and time.");
        case "expiration_in_past":
          return inviteError(400, error.code, "Choose an expiration in the future.");
      }
    }

    console.error("Taal could not save an event invite.");
    return inviteError(503, "invites_unavailable", "Invites are unavailable right now. Try again later.");
  }
}

export function POST(request: Request, context: RouteContext<"/api/host/events/[eventId]/invites">) {
  return writeInvite(request, context, async (body, eventId, uid) => {
    const input = parseInviteInput(body);
    return input && new HostInvites().create(eventId, uid, input);
  }, 201);
}

export function PATCH(request: Request, context: RouteContext<"/api/host/events/[eventId]/invites">) {
  return writeInvite(request, context, async (body, eventId, uid) => {
    if (!body || typeof body !== "object" || !("token" in body) ||
        typeof body.token !== "string" || !inviteTokenPattern.test(body.token)) {
      return null;
    }

    return new HostInvites().disable(eventId, uid, body.token);
  }, 200);
}
