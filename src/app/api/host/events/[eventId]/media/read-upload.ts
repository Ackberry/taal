import { EventImageError, eventImageMaxBytes, eventImageSizeMessage } from "@/lib/events/event-image";
import { eventImageAltMaxLength } from "@/lib/events/event-media-record";

const maxUploadBodyBytes = eventImageMaxBytes + 64 * 1024;

export class EventMediaInputError extends Error {
  constructor(readonly status: 400 | 415, message: string) {
    super(message);
  }
}

export async function readEventImageUpload(request: Request) {
  const contentType = request.headers.get("content-type");
  if (contentType?.split(";")[0].trim().toLowerCase() !== "multipart/form-data") {
    throw new EventMediaInputError(415, "Send the image as multipart form data.");
  }
  if (Number(request.headers.get("content-length")) > maxUploadBodyBytes) {
    throw new EventImageError("image_too_large", eventImageSizeMessage);
  }

  const reader = request.body?.getReader();
  if (!reader) throw new EventMediaInputError(400, "Choose an image to upload.");

  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxUploadBodyBytes) {
        throw new EventImageError("image_too_large", eventImageSizeMessage);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const data = await new Response(new Uint8Array(Buffer.concat(chunks, size)), {
    headers: { "Content-Type": contentType },
  }).formData().catch(() => {
    throw new EventMediaInputError(400, "The image upload couldn’t be read. Try choosing the file again.");
  });
  const kind = data.get("kind");
  const file = data.get("image");
  const alt = data.get("alt") ?? "";
  if ((kind !== "photo" && kind !== "reference") || data.getAll("kind").length !== 1) {
    throw new EventMediaInputError(400, "Choose a photo or reference image upload.");
  }
  if (!(file instanceof File) || file.size === 0 || data.getAll("image").length !== 1) {
    throw new EventMediaInputError(400, "Choose one image to upload.");
  }
  if (file.size > eventImageMaxBytes) throw new EventImageError("image_too_large", eventImageSizeMessage);
  if (typeof alt !== "string" || alt.trim().length > eventImageAltMaxLength || data.getAll("alt").length > 1) {
    throw new EventMediaInputError(400, `Use a description of ${eventImageAltMaxLength} characters or fewer.`);
  }
  return { kind, image: Buffer.from(await file.arrayBuffer()), alt: alt.trim() } as const;
}
