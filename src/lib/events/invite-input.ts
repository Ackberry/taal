import { eventIdPattern } from "./event-record";

export const inviteSlugPattern = eventIdPattern;
export const inviteSlugMaxLength = 80;
const inviteTokenLength = 43;
export const inviteTokenPattern = new RegExp(`^[A-Za-z0-9_-]{${inviteTokenLength}}$`);

export type InviteInput = { slug: string; expiration: "event-start" | Date };

export type HostInvite = {
  token: string;
  slug: string;
  expiresAt: string;
  expirationMode: "event-start" | "manual";
  disabledAt: string | null;
};

export function guestInvitePath(invite: Pick<HostInvite, "slug" | "token">) {
  return `/invite/${invite.slug}-${invite.token}`;
}

export function parseGuestInviteSegment(segment: string) {
  const separator = segment.length - inviteTokenLength - 1;
  if (separator < 1 || separator > inviteSlugMaxLength || segment[separator] !== "-") return null;

  const slug = segment.slice(0, separator);
  const token = segment.slice(separator + 1);
  return inviteSlugPattern.test(slug) && inviteTokenPattern.test(token) ? { slug, token } : null;
}

export function parseInviteInput(body: unknown): InviteInput | null {
  if (!body || typeof body !== "object" || !("slug" in body) ||
      typeof body.slug !== "string" || body.slug.length > inviteSlugMaxLength ||
      !inviteSlugPattern.test(body.slug)) {
    return null;
  }

  if (!("expiresAt" in body)) return { slug: body.slug, expiration: "event-start" };
  if (typeof body.expiresAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.expiresAt)) {
    return null;
  }

  const expiration = new Date(body.expiresAt);
  return Number.isFinite(expiration.getTime()) && expiration.toISOString() === body.expiresAt
    ? { slug: body.slug, expiration }
    : null;
}
