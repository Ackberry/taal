import { NextResponse } from "next/server";
import { FirebaseSessions, InvalidSessionCredentials, sessionCookieName, sessionCookieOptions } from "@/lib/auth/session";
import { checkSameOrigin } from "@/lib/http/same-origin";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

function sessionError(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status, headers });
}

function getOriginError(request: Request): NextResponse | null {
  switch (checkSameOrigin(request)) {
    case "unavailable":
      return sessionError(503, "session_unavailable", "Sign-in is unavailable right now.");
    case "invalid":
      return sessionError(403, "invalid_origin", "This request couldn’t be verified.");
    case "allowed":
      return null;
  }
}

export async function POST(request: Request) {
  const originError = getOriginError(request);
  if (originError) return originError;

  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return sessionError(415, "invalid_content_type", "The request must use JSON.");
  }

  const body: unknown = await request.json().catch(() => null);
  const idToken = body && typeof body === "object" && "idToken" in body ? body.idToken : null;

  if (typeof idToken !== "string" || idToken.length === 0 || idToken.length > 8_192) {
    return sessionError(400, "invalid_token_input", "A sign-in token is required.");
  }

  try {
    const cookie = await new FirebaseSessions().create(idToken);
    const response = new NextResponse(null, { status: 204, headers });
    response.cookies.set(sessionCookieName, cookie, sessionCookieOptions);
    return response;
  } catch (error) {
    if (error instanceof InvalidSessionCredentials) {
      return sessionError(401, "invalid_sign_in", "We couldn’t verify that sign-in. Try signing in again.");
    }

    console.error("Firebase could not create a Taal session.");
    return sessionError(503, "session_unavailable", "Sign-in is unavailable right now. Try again later.");
  }
}

export function DELETE(request: Request) {
  const originError = getOriginError(request);
  if (originError) return originError;

  const response = new NextResponse(null, { status: 204, headers });
  response.cookies.set(sessionCookieName, "", { ...sessionCookieOptions, maxAge: 0 });
  return response;
}
