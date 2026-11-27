import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import process from "node:process";
import test from "node:test";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { appOrigin, signIn } from "./emulator-session.mjs";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const app = initializeApp({ projectId: "demo-taal" });
const db = getFirestore(app);

function api(path, account, options = {}) {
  return fetch(`${appOrigin}/api/${path}`, {
    ...options,
    headers: { origin: appOrigin, ...(account && { cookie: account.cookie }), ...options.headers },
  });
}

function write(path, account, method, body, headers = {}) {
  return api(path, account, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function change(event, host, body, headers) {
  return write(`host/events/${event.id}/capacity`, host, "PATCH", body, headers);
}

function page(path, account) {
  return fetch(`${appOrigin}${path}`, {
    headers: account ? { cookie: account.cookie } : {},
    redirect: "manual",
  });
}

async function expectJson(response, status) {
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json();
}

async function createEvent(host, capacity) {
  const event = db.collection("events").doc(`test-${randomUUID()}`);
  const startAt = Timestamp.fromMillis(Date.now() + 86_400_000);
  await event.create({ ownerUid: host.uid, name: "Test event", startAt, capacity });
  return event;
}

async function addGuest(event, account, rsvpStatus, waitlistPosition = null) {
  const key = createHash("sha256").update(account.uid).digest("hex");
  const ref = event.collection("participants").doc(key);
  await ref.create({
    uid: account.uid,
    membershipStatus: "active",
    rsvpStatus,
    waitlistPosition,
    blockedAt: null,
    joinedAt: Timestamp.now(),
  });
  return ref;
}

test("only the event owner can submit a valid capacity change", async () => {
  const [host, guest] = await Promise.all([signIn(), signIn()]);
  const event = await createEvent(host, 2);
  const body = { capacity: 5 };
  assert.equal((await change(event, null, body)).status, 401);
  assert.equal((await change(event, guest, body)).status, 404);
  assert.equal((await change(event, host, body, { origin: "https://example.test" })).status, 403);
  assert.equal((await change(event, host, body, { "content-type": "text/plain" })).status, 415);
  const id = "a".repeat(64);
  for (const invalid of [{}, { capacity: 0 }, { capacity: 1.5 }, { capacity: "2" },
    { capacity: 2, removeParticipantIds: [id, id] }, { capacity: 2, removeParticipantIds: ["bad/id"] }]) {
    assert.equal((await change(event, host, invalid)).status, 400);
  }
  assert.equal((await event.get()).get("capacity"), 2);
});

test("only the host's capacity page receives confirmed guest labels and the current roster", async () => {
  const [host, confirmed, waiting] = await Promise.all([signIn(), signIn(), signIn()]);
  await db.collection("hostAccounts").doc(host.uid).create({});
  const event = await createEvent(host, 1);
  const [confirmedEntry, waitingEntry] = await Promise.all([
    addGuest(event, confirmed, "confirmed"), addGuest(event, waiting, "waitlisted", 1),
  ]);
  const [confirmedAccount, waitingAccount] = await Promise.all([
    getAuth(app).getUser(confirmed.uid), getAuth(app).getUser(waiting.uid),
  ]);
  assert.ok(confirmedAccount.email);
  assert.ok(waitingAccount.email);

  const path = `/host/events/${event.id}/capacity`;
  const dashboard = await page("/host/events", host);
  assert.equal(dashboard.status, 200);
  assert.ok((await dashboard.text()).includes(`href="${path}"`));
  assert.equal((await page(path)).status, 307);
  const guestPage = await page(path, confirmed);
  assert.equal(guestPage.status, 404);
  assert.ok(!(await guestPage.text()).includes(confirmedAccount.email));

  const editor = await page(path, host);
  assert.equal(editor.status, 200);
  assert.match(editor.headers.get("cache-control"), /no-store/);
  const html = await editor.text();
  assert.match(html, /Edit RSVP capacity/);
  assert.ok(html.includes(confirmedEntry.id));
  assert.ok(html.includes(confirmedAccount.email));
  assert.ok(!html.includes(waitingEntry.id));
  assert.ok(!html.includes(waitingAccount.email));

  await expectJson(await change(event, host, { capacity: 2 }), 200);
  const reloaded = await page(path, host);
  assert.equal(reloaded.status, 200);
  const updated = await reloaded.text();
  assert.ok(updated.includes(waitingEntry.id));
  assert.ok(updated.includes(waitingAccount.email));
});

test("raising capacity promotes the oldest guest and unlimited capacity clears the waitlist", async () => {
  const [host, confirmed, oldest, newest] = await Promise.all(Array.from({ length: 4 }, () => signIn()));
  const event = await createEvent(host, 1);
  const [, first, second] = await Promise.all([
    addGuest(event, confirmed, "confirmed"), addGuest(event, oldest, "waitlisted", 1), addGuest(event, newest, "waitlisted", 2),
  ]);

  assert.deepEqual(await expectJson(await change(event, host, { capacity: 2 }), 200), { capacity: 2, promotedCount: 1, removedCount: 0 });
  assert.equal((await first.get()).get("rsvpStatus"), "confirmed");
  assert.equal((await first.get()).get("waitlistPosition"), null);
  assert.equal((await second.get()).get("rsvpStatus"), "waitlisted");
  assert.deepEqual(await expectJson(await change(event, host, { capacity: null }), 200), { capacity: null, promotedCount: 1, removedCount: 0 });
  assert.equal((await event.get()).get("capacity"), null);
  assert.equal((await second.get()).get("rsvpStatus"), "confirmed");
});

test("capacity reduction rejects incomplete and stale selections and blocks valid removals", async () => {
  const [host, removed, remaining, waiting] = await Promise.all(Array.from({ length: 4 }, () => signIn()));
  const event = await createEvent(host, 2);
  const [selected, kept, waitlisted] = await Promise.all([
    addGuest(event, removed, "confirmed"), addGuest(event, remaining, "confirmed"), addGuest(event, waiting, "waitlisted", 5),
  ]);
  const link = await expectJson(await write(`host/events/${event.id}/invites`, host, "POST", { slug: "test-link" }), 201);

  const insufficient = await expectJson(await change(event, host, { capacity: 1 }), 409);
  assert.equal(insufficient.code, "insufficient_selection");
  assert.equal(insufficient.requiredRemovals, 1);
  const stale = await expectJson(await change(event, host, { capacity: 1, removeParticipantIds: [selected.id, waitlisted.id] }), 409);
  assert.equal(stale.code, "stale_selection");
  assert.equal((await event.get()).get("capacity"), 2);
  assert.equal((await selected.get()).get("rsvpStatus"), "confirmed");
  assert.equal((await selected.get()).get("blockedAt"), null);

  const result = await expectJson(await change(event, host, { capacity: 1, removeParticipantIds: [selected.id] }), 200);
  assert.deepEqual(result, { capacity: 1, promotedCount: 0, removedCount: 1 });
  const removedGuest = (await selected.get()).data();
  assert.equal((await event.get()).get("capacity"), 1);
  assert.equal(removedGuest.membershipStatus, "removed");
  assert.ok(removedGuest.blockedAt instanceof Timestamp);
  assert.equal(removedGuest.rsvpStatus, "none");
  assert.equal((await kept.get()).get("rsvpStatus"), "confirmed");
  assert.equal((await waitlisted.get()).get("rsvpStatus"), "waitlisted");
  assert.equal((await api(`events/${event.id}`, removed)).status, 404);
  assert.equal((await api(`events/${event.id}/rsvp`, removed, { method: "POST" })).status, 404);
  assert.equal((await write("invites/redeem", removed, "POST", { invite: `${link.slug}-${link.token}` })).status, 404);
});

test("a concurrent RSVP cannot take a spot ahead of the waitlist during a capacity increase", async () => {
  const [host, confirmed, waiting, incoming] = await Promise.all(Array.from({ length: 4 }, () => signIn()));
  const event = await createEvent(host, 1);
  const [, oldest, newcomer] = await Promise.all([
    addGuest(event, confirmed, "confirmed"), addGuest(event, waiting, "waitlisted", 1), addGuest(event, incoming, "none"),
  ]);
  const [capacity, rsvp] = await Promise.all([
    change(event, host, { capacity: 2 }).then((response) => expectJson(response, 200)),
    api(`events/${event.id}/rsvp`, incoming, { method: "POST" }).then((response) => expectJson(response, 200)),
  ]);
  assert.equal(capacity.promotedCount, 1);
  assert.equal(rsvp.rsvpStatus, "waitlisted");
  assert.equal((await oldest.get()).get("rsvpStatus"), "confirmed");
  assert.equal((await newcomer.get()).get("rsvpStatus"), "waitlisted");
  assert.equal((await event.get()).get("capacity"), 2);
});
