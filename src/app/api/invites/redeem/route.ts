import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { InviteRedemption } from "@/lib/events/invite-redemption";
import { checkSameOrigin } from "@/lib/http/same-origin";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

function redemptionError(status: number, code: string, message: string, retryAfter?: number) {
  return NextResponse.json({ code, message }, {
    status,
    headers: retryAfter === undefined ? headers : { ...headers, "Retry-After": String(retryAfter) },
  });
}

export async function POST(request: Request) {
  const origin = checkSameOrigin(request);
  if (origin === "invalid") return redemptionError(403, "invalid_origin", "This request couldn’t be verified.");
  if (origin === "unavailable") return redemptionError(503, "redemption_unavailable", "Invite redemption is unavailable.");

  try {
    const session = await getCurrentSession();
    if (!session) return redemptionError(401, "sign_in_required", "Sign in to accept the invite.");

    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return redemptionError(415, "invalid_content_type", "The request must use JSON.");
    }

    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || !("invite" in body) || typeof body.invite !== "string") {
      return redemptionError(400, "invalid_input", "An invite is required.");
    }

    const result = await new InviteRedemption().redeem(body.invite, session.uid);
    switch (result.status) {
      case "redeemed":
        return NextResponse.json({ eventId: result.eventId }, { headers });
      case "unavailable":
        return redemptionError(404, "invite_unavailable", "This invite is unavailable.");
      case "rate_limited":
        return redemptionError(429, "rate_limited", "Too many attempts. Try again later.", result.retryAfter);
    }
  } catch {
    console.error("Taal could not redeem an invite.");
    return redemptionError(503, "redemption_unavailable", "Invite redemption is unavailable right now.");
  }
}
