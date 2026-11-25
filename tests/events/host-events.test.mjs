import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { appOrigin, signIn } from "./emulator-session.mjs";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const db = getFirestore(initializeApp({ projectId: "demo-taal" }));
const exec = promisify(execFile);

function request(path, account, options = {}) {
  return fetch(appOrigin + path, {
    redirect: "manual",
    ...options,
    headers: { ...(account && { cookie: account.cookie }), ...options.headers },
  });
}

function post(path, account, body, headers = {}) {
  return request(path, account, {
    method: "POST",
    headers: { origin: appOrigin, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function createEvent(account, body, headers) {
  return post("/api/host/events", account, body, headers);
}

async function expectJson(response, status) {
  assert.equal(response.status, status, await response.clone().text());
  assert.match(response.headers.get("cache-control"), /no-store/);
  return response.json();
}

test("only approved, signed-in hosts can list or create events", async () => {
  const account = await signIn();
  const body = { requestId: randomUUID(), name: "Unapproved test event", startAt: null };

  assert.equal((await request("/host/events")).status, 307);
  assert.equal((await request("/host/events", account)).status, 404);
  assert.doesNotMatch(await (await request("/account", account)).text(), /Manage your events/);
  assert.equal((await expectJson(await createEvent(undefined, body), 401)).code, "sign_in_required");
  assert.equal((await expectJson(await createEvent(account, body), 403)).code, "host_approval_required");

  const approval = db.collection("hostAccounts").doc(account.uid);
  const firestoreApproval = await fetch(
    `http://127.0.0.1:8080/v1/projects/demo-taal/databases/(default)/documents/hostAccounts?documentId=${account.uid}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${account.idToken}`, "content-type": "application/json" },
      body: JSON.stringify({ fields: { approved: { booleanValue: true } } }),
    },
  );
  assert.equal(firestoreApproval.status, 403);
  await exec(process.execPath, ["scripts/approve-test-host.mjs", account.uid]);
  assert.equal((await request("/host/events", account)).status, 200);
  assert.match(await (await request("/account", account)).text(), /Manage your events/);
  assert.equal((await expectJson(await createEvent(account, body, { origin: "https://example.test" }), 403)).code, "invalid_origin");
  assert.equal((await expectJson(await createEvent(account, body, { "content-type": "text/plain" }), 415)).code, "invalid_content_type");

  const invalid = { ...body, name: "  ", startAt: "2031-02-30T11:00:00.000Z", capacity: 1.5 };
  const error = await expectJson(await createEvent(account, invalid), 400);
  assert.equal(error.code, "invalid_input");
  assert.deepEqual(Object.keys(error.fields).sort(), ["capacity", "name", "startAt"]);
  assert.equal((await db.collection("events").where("ownerUid", "==", account.uid).get()).size, 0);

  await approval.delete();
  assert.equal((await request("/host/events", account)).status, 404);
  assert.equal((await expectJson(await createEvent(account, body), 403)).code, "host_approval_required");
});

test("a created private event appears only for its host and supports guest invites and RSVP", async () => {
  const [host, otherHost, guest] = await Promise.all([signIn(), signIn(), signIn()]);
  await Promise.all([host, otherHost].map(({ uid }) => db.collection("hostAccounts").doc(uid).create({})));

  const startAt = new Date(Date.now() + 86_400_000).toISOString();
  const body = { requestId: randomUUID(), name: " First host event ", startAt, capacity: 3, ownerUid: otherHost.uid };
  const responses = await Promise.all([createEvent(host, body), createEvent(host, body)]);
  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 201]);
  const [event, replay] = await Promise.all(responses.map((response) => expectJson(response, response.status)));
  assert.deepEqual(event, replay);
  assert.deepEqual(event, { eventId: event.eventId, name: body.name.trim(), startAt, capacity: 3 });
  assert.match(event.eventId, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal((await db.collection("events").doc(event.eventId).get()).get("ownerUid"), host.uid);
  assert.equal((await db.collection("events").where("ownerUid", "==", host.uid).get()).size, 1);
  const changed = { ...body, capacity: 4 };
  assert.equal((await expectJson(await createEvent(host, changed), 409)).code, "request_conflict");

  const other = await expectJson(await createEvent(otherHost, {
    requestId: body.requestId, name: "Second host event", startAt: null,
  }), 201);
  assert.notEqual(other.eventId, event.eventId);
  assert.equal(other.startAt, null);
  assert.equal(other.capacity, null);

  const invitesPath = `/host/events/${event.eventId}/invites`;
  for (const [account, own, foreign] of [[host, event, other], [otherHost, other, event]]) {
    const page = await request("/host/events", account);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("cache-control"), /no-store/);
    const html = await page.text();
    assert.ok(html.includes(own.name));
    assert.ok(html.includes(`/host/events/${own.eventId}/invites`));
    assert.ok(!html.includes(foreign.name));
    assert.ok(!html.includes(foreign.eventId));
  }
  assert.equal((await request(invitesPath, otherHost)).status, 404);
  assert.equal((await request(invitesPath, host)).status, 200);

  const pagePath = `/events/${event.eventId}`;
  const apiPath = `/api${pagePath}`;
  assert.equal((await request(pagePath, guest)).status, 404);
  assert.equal((await request(apiPath, guest)).status, 404);
  const slug = "test-guest-link";
  const invite = await expectJson(await post(`/api${invitesPath}`, host, { slug }), 201);
  assert.equal(invite.expiresAt, startAt);
  assert.deepEqual(await expectJson(await post("/api/invites/redeem", guest, {
    invite: `${slug}-${invite.token}`,
  }), 200), { eventId: event.eventId });
  assert.deepEqual(await expectJson(await request(apiPath, guest), 200), {
    name: event.name, role: "guest", rsvpStatus: "none",
  });
  assert.deepEqual(await expectJson(await post(`${apiPath}/rsvp`, guest), 200), { rsvpStatus: "confirmed" });
  assert.deepEqual(await expectJson(await request(apiPath, guest), 200), {
    name: event.name, role: "guest", rsvpStatus: "confirmed", details: { startAt },
  });
});
