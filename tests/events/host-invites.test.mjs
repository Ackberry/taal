import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { execPath } from "node:process";
import test from "node:test";
import { URLSearchParams } from "node:url";
import { promisify } from "node:util";

const appOrigin = "http://localhost:3000";
const authOrigin = "http://127.0.0.1:9099";
const exec = promisify(execFile);

async function signIn() {
  const response = await fetch(`${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestUri: appOrigin,
      postBody: new URLSearchParams({
        providerId: "google.com",
        id_token: JSON.stringify({ sub: randomUUID(), email: `${randomUUID()}@example.test`, email_verified: true }),
      }).toString(),
      returnSecureToken: true,
    }),
  });
  assert.equal(response.status, 200);
  const { idToken, localId: uid } = await response.json();
  const session = await fetch(`${appOrigin}/api/session`, {
    method: "POST",
    headers: { origin: appOrigin, "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  assert.equal(session.status, 204);
  return { uid, cookie: session.headers.get("set-cookie").split(";")[0], idToken };
}

async function seedEvent(host, start) {
  const eventId = `test-${randomUUID()}`;
  await exec(execPath, ["scripts/seed-test-event.mjs", host.uid, eventId, start]);
  return eventId;
}

function writeInvite(eventId, method, body, account, origin = appOrigin) {
  return fetch(`${appOrigin}/api/host/events/${eventId}/invites`, {
    method,
    headers: { origin, "content-type": "application/json", ...(account && { cookie: account.cookie }) },
    body: JSON.stringify(body),
  });
}

function hostPage(eventId, account) {
  return fetch(`${appOrigin}/host/events/${eventId}/invites`, {
    redirect: "manual",
    headers: account ? { cookie: account.cookie } : {},
  });
}

test("owner-scoped invites have independent expiration and disable state", async () => {
  const [host, guest] = await Promise.all([signIn(), signIn()]);
  const startAt = new Date(Date.now() + 86_400_000).toISOString();
  const customAt = new Date(Date.now() + 172_800_000).toISOString();
  const [eventId, tbaEventId] = await Promise.all([seedEvent(host, startAt), seedEvent(host, "tba")]);
  const body = { slug: "special-party" };

  assert.equal((await hostPage(eventId)).status, 307);
  assert.equal((await hostPage(eventId, guest)).status, 404);
  assert.equal((await writeInvite(eventId, "POST", body)).status, 401);
  assert.equal((await writeInvite(eventId, "POST", body, guest)).status, 404);
  assert.equal((await writeInvite(eventId, "POST", body, host, "https://example.test")).status, 403);
  assert.equal((await writeInvite(eventId, "POST", { slug: "bad/path" }, host)).status, 400);
  assert.equal((await writeInvite(eventId, "POST", { ...body, expiresAt: "2020-01-01T00:00:00.000Z" }, host)).status, 400);
  const missingExpiration = await writeInvite(tbaEventId, "POST", body, host);
  assert.equal(missingExpiration.status, 400);
  assert.equal((await missingExpiration.json()).code, "expiration_required");
  assert.equal((await writeInvite(tbaEventId, "POST", { ...body, expiresAt: customAt }, host)).status, 201);

  const [defaultResponse, manualResponse] = await Promise.all([
    writeInvite(eventId, "POST", body, host),
    writeInvite(eventId, "POST", { ...body, expiresAt: customAt }, host),
  ]);
  for (const response of [defaultResponse, manualResponse]) {
    assert.equal(response.status, 201);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  const first = await defaultResponse.json();
  const second = await manualResponse.json();
  for (const invite of [first, second]) {
    assert.match(invite.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(invite.slug, body.slug);
    assert.equal(invite.disabledAt, null);
  }
  assert.notEqual(first.token, second.token);
  assert.equal(first.expirationMode, "event-start");
  assert.equal(first.expiresAt, startAt);
  assert.equal(second.expirationMode, "manual");
  assert.equal(second.expiresAt, customAt);

  const guestRead = await fetch(
    `http://127.0.0.1:8080/v1/projects/demo-taal/databases/(default)/documents/eventInvites/${first.token}`,
    { headers: { authorization: `Bearer ${guest.idToken}` } },
  );
  assert.equal(guestRead.status, 403);

  const disable = { token: first.token };
  assert.equal((await writeInvite(eventId, "PATCH", disable)).status, 401);
  assert.equal((await writeInvite(eventId, "PATCH", disable, guest)).status, 404);
  assert.equal((await writeInvite(tbaEventId, "PATCH", disable, host)).status, 404);
  const [disabled, repeated] = await Promise.all([
    writeInvite(eventId, "PATCH", disable, host),
    writeInvite(eventId, "PATCH", disable, host),
  ]);
  assert.equal(disabled.status, 200);
  assert.equal(repeated.status, 200);
  const disabledInvite = await disabled.json();
  assert.ok(Date.parse(disabledInvite.disabledAt));
  assert.deepEqual(await repeated.json(), disabledInvite);

  const page = await hostPage(eventId, host);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("cache-control"), /no-store/);
  const rendered = await page.text();
  assert.match(rendered, /Disabled/);
  assert.ok(rendered.includes(`/invite/${body.slug}-${second.token}`));
});
