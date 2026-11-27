import type { EventImageSummary } from "@/lib/events/event-media-record";

export function eventImageUrl(eventId: string, imageId: string) {
  return `/api/events/${eventId}/media/${imageId}`;
}

export default function EventMediaImage({ eventId, image, eager = false }: {
  eventId: string;
  image: EventImageSummary;
  eager?: boolean;
}) {
  // The browser must request private images directly with its session cookie.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="event-media-image" src={eventImageUrl(eventId, image.id)}
    alt={image.alt || (image.kind === "reference" ? "Event reference image" : "")}
    loading={eager ? "eager" : "lazy"} decoding="async" />;
}
