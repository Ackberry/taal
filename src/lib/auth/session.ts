import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { cookies } from "next/headers";
import { normalizeUsPhoneNumber } from "@/lib/auth/phone";
import { getFirebaseAdminApp } from "@/lib/firebase/admin";

const isProduction = process.env.NODE_ENV === "production";
export const sessionCookieName = isProduction ? "__Host-taal_session" : "taal_session";
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isProduction,
  path: "/",
  maxAge: 60 * 60 * 24 * 5,
};

const maxSignInAgeSeconds = 5 * 60;
const signInClockSkewSeconds = 30;

const invalidCredentialCodes = new Set([
  "auth/argument-error",
  "auth/invalid-id-token",
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/invalid-session-cookie",
  "auth/session-cookie-expired",
  "auth/session-cookie-revoked",
  "auth/user-disabled",
  "auth/user-not-found",
]);

export class InvalidSessionCredentials extends Error {}

function isInvalidCredential(error: unknown): boolean {
  return error instanceof InvalidSessionCredentials ||
    (error instanceof Error && "code" in error && typeof error.code === "string" &&
      invalidCredentialCodes.has(error.code));
}

function hasAllowedSignIn(token: DecodedIdToken): boolean {
  const provider = token.firebase.sign_in_provider;
  return (provider === "google.com" && token.email_verified === true) ||
    (provider === "phone" && typeof token.phone_number === "string" &&
      normalizeUsPhoneNumber(token.phone_number) !== null);
}

function unwrapFirebaseCookie(cookie: string): string | null {
  const [sessionId, ...tokenParts] = cookie.split(".");
  if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId) || tokenParts.length !== 3) {
    return null;
  }

  return tokenParts.join(".");
}

export class FirebaseSessions {
  private readonly auth;
  private readonly records;

  constructor(app = getFirebaseAdminApp()) {
    this.auth = getAuth(app);
    this.records = getFirestore(app).collection("authSessions");
  }

  private recordFor(cookie: string) {
    // Hash the full cookie to bind the unique session ID to its Firebase credential.
    const digest = createHash("sha256").update(cookie).digest("hex");
    return this.records.doc(digest);
  }

  async create(idToken: string): Promise<string> {
    try {
      const claims = await this.auth.verifyIdToken(idToken, true);
      const secondsSinceSignIn = Math.floor(Date.now() / 1000) - claims.auth_time;

      const hasRecentSignIn = secondsSinceSignIn >= -signInClockSkewSeconds &&
        secondsSinceSignIn <= maxSignInAgeSeconds;

      if (!hasAllowedSignIn(claims) || !hasRecentSignIn) {
        throw new InvalidSessionCredentials();
      }

      const expiresIn = sessionCookieOptions.maxAge * 1000;
      const expiresAt = Timestamp.fromMillis(Date.now() + expiresIn);
      const firebaseCookie = await this.auth.createSessionCookie(idToken, { expiresIn });
      const cookie = `${randomBytes(32).toString("base64url")}.${firebaseCookie}`;

      await this.recordFor(cookie).create({ expiresAt });
      return cookie;
    } catch (error) {
      if (isInvalidCredential(error)) {
        throw new InvalidSessionCredentials();
      }
      throw error;
    }
  }

  async verify(cookie: string): Promise<{ uid: string } | null> {
    const identity = await this.verifyIdentity(cookie, true);
    if (!identity) return null;

    const record = await this.recordFor(cookie).get();
    const expiresAt: unknown = record.get("expiresAt");
    return expiresAt instanceof Timestamp && expiresAt.toMillis() > Date.now()
      ? { uid: identity.uid }
      : null;
  }

  async revoke(cookie: string): Promise<void> {
    // Firebase can still verify ownership for cleanup after account-wide revocation.
    if (await this.verifyIdentity(cookie, false)) {
      await this.recordFor(cookie).delete();
    }
  }

  private async verifyIdentity(cookie: string, checkRevoked: boolean): Promise<DecodedIdToken | null> {
    const firebaseCookie = unwrapFirebaseCookie(cookie);
    if (!firebaseCookie) return null;

    try {
      const claims = await this.auth.verifySessionCookie(firebaseCookie, checkRevoked);
      return hasAllowedSignIn(claims) ? claims : null;
    } catch (error) {
      if (isInvalidCredential(error)) {
        return null;
      }
      throw error;
    }
  }
}

export async function getCurrentSession() {
  const cookie = (await cookies()).get(sessionCookieName)?.value;
  return cookie ? new FirebaseSessions().verify(cookie) : null;
}
