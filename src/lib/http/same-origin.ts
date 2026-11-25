import "server-only";

type OriginCheck = "allowed" | "invalid" | "unavailable";

export function getAppOrigin(): string | null {
  const production = process.env.NODE_ENV === "production";
  const configuredOrigin = process.env.TAAL_APP_ORIGIN ??
    (production ? "" : "http://localhost:3000");
  const origin = URL.canParse(configuredOrigin) ? new URL(configuredOrigin) : null;

  if (!origin || (origin.protocol !== "https:" && (production || origin.protocol !== "http:"))) {
    return null;
  }

  return origin.origin;
}

export function checkSameOrigin(request: Request): OriginCheck {
  const origin = getAppOrigin();
  if (!origin) return "unavailable";
  return request.headers.get("origin") === origin ? "allowed" : "invalid";
}
