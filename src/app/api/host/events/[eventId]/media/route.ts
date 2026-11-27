import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { EventImageError } from "@/lib/events/event-image";
import { isEventImageId } from "@/lib/events/event-media-record";
import { EventImageLimitError, HostEventMedia } from "@/lib/events/host-event-media";
import { checkSameOrigin } from "@/lib/http/same-origin";
import { EventMediaInputError, readEventImageUpload } from "./read-upload";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

function mediaError(status: number, code: string, message: string) {
  // An oversized request may still have unread bytes on its HTTP connection.
  const responseHeaders = status === 413 ? { ...headers, Connection: "close" } : headers;
  return NextResponse.json({ code, message }, { status, headers: responseHeaders });
}

async function changeMedia(request: Request, { params }: RouteContext<"/api/host/events/[eventId]/media">) {
  const origin = checkSameOrigin(request);
  if (origin === "invalid") return mediaError(403, "invalid_origin", "This request couldn’t be verified.");
  if (origin === "unavailable") return mediaError(503, "media_unavailable", "Event media editing is unavailable.");

  try {
    const session = await getCurrentSession();
    if (!session) return mediaError(401, "sign_in_required", "Sign in again to manage event images.");

    const { eventId } = await params;
    const media = new HostEventMedia();
    if (request.method === "DELETE") {
      const imageId = new URL(request.url).searchParams.get("imageId");
      if (!isEventImageId(imageId)) return mediaError(400, "invalid_input", "Choose a reference image to remove.");
      if (await media.removeReference(eventId, session.uid, imageId)) {
        return new NextResponse(null, { status: 204, headers });
      }
    } else {
      const image = await media.upload(eventId, session.uid, () => readEventImageUpload(request));
      if (image) return NextResponse.json(image, { status: 201, headers });
    }
    return mediaError(404, "media_not_found", "This event or image is unavailable.");
  } catch (error) {
    if (error instanceof EventMediaInputError) {
      return mediaError(error.status, error.status === 415 ? "invalid_content_type" : "invalid_input", error.message);
    }
    if (error instanceof EventImageError) {
      return mediaError(error.code === "image_too_large" ? 413 : 400, error.code, error.message);
    }
    if (error instanceof EventImageLimitError) return mediaError(409, "image_limit_reached", error.message);
    console.error("Taal could not update event media.");
    return mediaError(503, "media_unavailable", "Couldn’t update event images. Try again later.");
  }
}

export { changeMedia as POST, changeMedia as DELETE };
