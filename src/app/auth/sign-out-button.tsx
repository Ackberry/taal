"use client";

import { useState } from "react";
import { endBrowserSession } from "@/lib/auth/browser-session";

export default function SignOutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    setError("");
    setPending(true);
    try {
      await endBrowserSession();
      window.location.replace("/");
    } catch {
      setError("We couldn’t sign you out. Try again.");
      setPending(false);
    }
  }

  return (
    <>
      <button className="button button-secondary" type="button" onClick={signOut} disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
