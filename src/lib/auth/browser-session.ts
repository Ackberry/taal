import { signOut, type UserCredential } from "firebase/auth";
import { getFirebaseBrowserAuth } from "@/lib/firebase/browser";

export class BrowserSessionError extends Error {}

export async function startBrowserSession(credential: UserCredential): Promise<void> {
  try {
    const idToken = await credential.user.getIdToken();
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new BrowserSessionError(
        typeof body?.message === "string" ? body.message : "We couldn’t start your session.",
      );
    }
  } finally {
    await signOut(getFirebaseBrowserAuth()).catch(() => {});
  }
}

export async function endBrowserSession(): Promise<void> {
  const response = await fetch("/api/session", { method: "DELETE" });
  if (!response.ok) {
    throw new BrowserSessionError("We couldn’t sign you out. Try again.");
  }
}
