import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { readEventImage } from "@/lib/events/event-access";
import { eventImageContentType } from "@/lib/firebase/event-image-storage";

export const runtime = "nodejs";

const headers = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
};

function mediaError(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status, headers });
}

export async function GET(_request: Request, { params }: RouteContext<"/api/events/[eventId]/media/[imageId]">) {
  try {
    const session = await getCurrentSession();
    if (!session) return mediaError(401, "sign_in_required", "Sign in to view event images.");

    const { eventId, imageId } = await params;
    const image = await readEventImage(eventId, imageId, session.uid);
    if (!image) return mediaError(404, "media_not_found", "This image is unavailable.");

    return new NextResponse(new Uint8Array(image), {
      headers: { ...headers, "Content-Type": eventImageContentType },
    });
  } catch {
    console.error("Taal could not read an event image.");
    return mediaError(503, "media_unavailable", "Event images are unavailable right now.");
  }
}
