import "server-only";

import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import { normalizeUsPhoneNumber } from "@/lib/auth/phone";
import { getFirebaseAdminAuth } from "@/lib/firebase/admin";

const isProduction = process.env.NODE_ENV === "production";
export const sessionCookieName = isProduction ? "__Host-taal_session" : "taal_session";
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isProduction,
  path: "/",
  maxAge: 60 * 60 * 24 * 5,
};

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

export class FirebaseSessions {
  constructor(private readonly auth: Auth = getFirebaseAdminAuth()) {}

  async create(idToken: string): Promise<string> {
    try {
      const claims = await this.auth.verifyIdToken(idToken, true);
      const secondsSinceSignIn = Math.floor(Date.now() / 1000) - claims.auth_time;

      if (!hasAllowedSignIn(claims) || secondsSinceSignIn < 0 || secondsSinceSignIn > 5 * 60) {
        throw new InvalidSessionCredentials();
      }

      return await this.auth.createSessionCookie(idToken, {
        expiresIn: sessionCookieOptions.maxAge * 1000,
      });
    } catch (error) {
      if (isInvalidCredential(error)) {
        throw new InvalidSessionCredentials();
      }
      throw error;
    }
  }

  async verify(cookie: string): Promise<{ uid: string } | null> {
    try {
      const claims = await this.auth.verifySessionCookie(cookie, true);
      return hasAllowedSignIn(claims) ? { uid: claims.uid } : null;
    } catch (error) {
      if (isInvalidCredential(error)) {
        return null;
      }
      throw error;
    }
  }
}
