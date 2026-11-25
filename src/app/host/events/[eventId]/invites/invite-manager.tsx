"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { guestInvitePath, inviteSlugMaxLength, inviteSlugPattern, type HostInvite } from "@/lib/events/invite-input";

const subscribeToTimeZone = () => () => {};
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverTimeZone = () => "UTC";

function localDateTimeValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function InviteManager({ eventId, origin, startAt, initialInvites, checkedAt }: {
  eventId: string;
  origin: string;
  startAt: string | null;
  initialInvites: HostInvite[];
  checkedAt: number;
}) {
  const timeZone = useSyncExternalStore(subscribeToTimeZone, browserTimeZone, serverTimeZone);
  const dateFormat = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium", timeStyle: "short", timeZone,
  });
  const [invites, setInvites] = useState(initialInvites);
  const [now, setNow] = useState(checkedAt);
  const [customExpiration, setCustomExpiration] = useState(!startAt || Date.parse(startAt) <= checkedAt);
  const [localExpiration, setLocalExpiration] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const startInFuture = startAt !== null && Date.parse(startAt) > now;
  const usesCustomExpiration = customExpiration || !startInFuture;

  useEffect(() => {
    const upcoming = [
      ...(startAt ? [Date.parse(startAt)] : []),
      ...invites.filter((invite) => !invite.disabledAt).map((invite) => Date.parse(invite.expiresAt)),
    ].filter((timestamp) => timestamp > now);
    if (upcoming.length === 0) return;
    const delay = Math.min(2_147_483_647, Math.max(0, Math.min(...upcoming) - Date.now()));
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [invites, now, startAt]);

  async function saveInvite(method: "POST" | "PATCH", body: object, pendingId: string) {
    setStatus("");
    setError("");
    setPending(pendingId);
    try {
      const response = await fetch(`/api/host/events/${eventId}/invites`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.message ?? "Couldn’t save the invite. Try again.");
        return false;
      }

      const invite: HostInvite = result;
      setInvites((current) => method === "POST"
        ? [invite, ...current]
        : current.map((item) => item.token === invite.token ? invite : item));
      setNow(Date.now());
      setStatus(method === "POST" ? "Invite created." : "Invite disabled.");
      return true;
    } catch {
      setError("Couldn’t save the invite. Try again.");
      return false;
    } finally {
      setPending(null);
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const slug = new FormData(form).get("slug");
    if (usesCustomExpiration) {
      const date = new Date(localExpiration);
      if (!Number.isFinite(date.getTime()) || localDateTimeValue(date) !== localExpiration) {
        setStatus("");
        setError("Choose a valid expiration date and time in your time zone.");
        return;
      }
      if (!await saveInvite("POST", { slug, expiresAt: date.toISOString() }, "create")) return;
    } else if (!await saveInvite("POST", { slug }, "create")) {
      return;
    }
    form.reset();
  }

  function chooseCustomExpiration() {
    setCustomExpiration(true);
    if (!localExpiration && startAt && Date.parse(startAt) > now) {
      setLocalExpiration(localDateTimeValue(new Date(startAt)));
    }
  }

  async function copyLink(url: string) {
    setStatus("");
    setError("");
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Link copied.");
    } catch {
      setError("Couldn’t copy automatically. Select the invite URL to copy it.");
    }
  }

  return (
    <>
      <form className="stack invite-panel" onSubmit={createInvite}>
        <h2>Create a link</h2>
        <label htmlFor="invite-slug">Readable URL path</label>
        <input id="invite-slug" name="slug" required maxLength={inviteSlugMaxLength}
          pattern={inviteSlugPattern.source} placeholder="special-party"
          autoCapitalize="none" spellCheck={false} aria-describedby="invite-path-help" />
        <p id="invite-path-help" className="invite-meta">
          Use lowercase letters, numbers, and hyphens. Taal adds a unique suffix.
        </p>
        <fieldset className="stack invite-expiration">
          <legend>Expiration</legend>
          {startInFuture ? (
            <>
              <label className="invite-choice">
                <input type="radio" name="expiration" checked={!customExpiration}
                  onChange={() => setCustomExpiration(false)} />
                Event start · {dateFormat.format(new Date(startAt))}
              </label>
              <label className="invite-choice">
                <input type="radio" name="expiration" checked={customExpiration}
                  onChange={chooseCustomExpiration} />
                Choose a date and time
              </label>
            </>
          ) : (
            <p className="invite-meta">{startAt
              ? "The event start has passed. Choose an expiration."
              : "The event start is TBA. Choose an expiration."}</p>
          )}
          {usesCustomExpiration && (
            <div className="stack">
              <label htmlFor="invite-expiration">Expiration date and time</label>
              <input id="invite-expiration" type="datetime-local" required
                value={localExpiration} onChange={(event) => setLocalExpiration(event.target.value)}
                aria-describedby="invite-time-zone" />
              <p id="invite-time-zone" className="invite-meta">Time zone: {timeZone}</p>
            </div>
          )}
        </fieldset>
        <button className="button" type="submit" disabled={pending !== null}>
          {pending === "create" ? "Creating…" : "Create invite"}
        </button>
      </form>
      <div className="invite-feedback">
        <p role="status">{status}</p>
        {error && <p role="alert" className="error">{error}</p>}
      </div>

      <section aria-labelledby="invite-list-title">
        <h2 id="invite-list-title">Invite links</h2>
        {invites.length === 0 ? <p>No invite links yet.</p> : (
          <ul className="stack invite-list">
            {invites.map((invite) => {
              const url = origin + guestInvitePath(invite);
              const expired = Date.parse(invite.expiresAt) <= now;
              const active = !invite.disabledAt && !expired;
              return (
                <li key={invite.token} className="stack invite-panel">
                  <h3>{invite.slug}</h3>
                  <p className="invite-meta">
                    {invite.disabledAt ? "Disabled" : expired ? "Expired" : "Active"} ·{" "}
                    {expired ? "Expiration" : "Expires"}{" "}
                    <time dateTime={invite.expiresAt}>{dateFormat.format(new Date(invite.expiresAt))}</time>
                    {invite.expirationMode === "event-start" && " (event start)"}
                  </p>
                  {active && (
                    <>
                      <input aria-label={`Invite URL for ${invite.slug}`} value={url} readOnly />
                      <div className="invite-actions">
                        <button type="button" className="button button-secondary" onClick={() => copyLink(url)}>
                          Copy link
                        </button>
                        <button type="button" className="text-button" disabled={pending !== null}
                          onClick={() => saveInvite("PATCH", { token: invite.token }, invite.token)}>
                          {pending === invite.token ? "Disabling…" : "Disable"}
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
