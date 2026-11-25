"use client";

import { notFound } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { eventIdPattern } from "@/lib/events/invite-input";

type Redemption =
  | { status: "redeemed"; eventId: string }
  | { status: "unavailable" }
  | { status: "sign_in_required" }
  | { status: "error"; message: string };

const retryMessage = "We couldn’t open the invite. Try again.";

async function redeemInvite(segment: string): Promise<Redemption> {
  try {
    const response = await fetch("/api/invites/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invite: segment }),
    });
    if (response.status === 404) return { status: "unavailable" };
    if (response.status === 401) return { status: "sign_in_required" };

    const body = await response.json();
    if (response.ok && typeof body?.eventId === "string" && eventIdPattern.test(body.eventId)) {
      return { status: "redeemed", eventId: body.eventId };
    }

    return { status: "error", message: typeof body?.message === "string" ? body.message : retryMessage };
  } catch {
    return { status: "error", message: retryMessage };
  }
}

export default function RedeemInvite({ segment }: { segment: string }) {
  const request = useRef<Promise<Redemption> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Redemption | null>(null);

  useEffect(() => {
    // Reuse the request if React restarts this effect during hydration.
    request.current ??= redeemInvite(segment);
    let current = true;
    void request.current.then((outcome) => {
      if (!current) return;
      if (outcome.status === "redeemed") {
        window.location.replace(`/events/${outcome.eventId}`);
      } else {
        setResult(outcome);
      }
    });
    return () => { current = false; };
  }, [attempt, segment]);

  if (result?.status === "unavailable") notFound();

  if (result?.status === "sign_in_required") {
    return (
      <div className="stack">
        <p role="alert">Your session ended. Sign in again to open the invite.</p>
        <button className="button" type="button" onClick={() => window.location.reload()}>Sign in again</button>
      </div>
    );
  }

  if (result?.status === "error") {
    return (
      <div className="stack">
        <p className="error" role="alert">{result.message}</p>
        <button className="button" type="button" onClick={() => {
          request.current = null;
          setResult(null);
          setAttempt((previous) => previous + 1);
        }}>Try again</button>
      </div>
    );
  }

  return <p role="status">Opening invite…</p>;
}
