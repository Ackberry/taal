import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import process from "node:process";
import test from "node:test";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { appOrigin, signIn } from "./emulator-session.mjs";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const db = getFirestore(initializeApp({ projectId: "demo-taal" }));
const dateInDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString();

function write(path, account, method, body, headers = {}) {
  return fetch(`${appOrigin}/api/${path}`, {
    method,
    headers: { origin: appOrigin, "content-type": "application/json", ...(account && { cookie: account.cookie }), ...headers },
    body: JSON.stringify(body),
  });
}

function schedule(event, account, body, headers) {
  return write(`host/events/${event.id}/schedule`, account, "PATCH", body, headers);
}

async function expectJson(response, status) {
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json();
}

function inviteRef(invite) {
  return db.collection("eventInvites").doc(invite.token);
}

function createInvite(event, host, body) {
  return write(`host/events/${event.id}/invites`, host, "POST", body).then((response) => expectJson(response, 201));
}

async function createEvent(host, startAt) {
  const event = db.collection("events").doc(`test-${randomUUID()}`);
  await event.create({ ownerUid: host.uid, name: "Test event", startAt: startAt && Timestamp.fromDate(new Date(startAt)), capacity: 1 });
  return event;
}

function participantRef(event, account) {
  const key = createHash("sha256").update(account.uid).digest("hex");
  return event.collection("participants").doc(key);
}

test("the schedule endpoint requires an owner, the app origin, and an exact UTC timestamp", async () => {
  const [host, other] = await Promise.all([signIn(), signIn()]);
  const event = await createEvent(host, null);
  const body = { startAt: dateInDays(1) };
  assert.equal((await schedule(event, null, body)).status, 401);
  assert.equal((await schedule(event, other, body)).status, 404);
  assert.equal((await schedule(event, host, body, { origin: "https://example.test" })).status, 403);
  assert.equal((await schedule(event, host, body, { "content-type": "text/plain" })).status, 415);
  for (const invalid of [{}, { startAt: null }, { startAt: "2030-02-30T10:00:00.000Z" }, { ...body, capacity: 2 }]) {
    assert.equal((await schedule(event, host, invalid)).status, 400);
  }
  assert.equal((await event.get()).get("startAt"), null);
  assert.equal((await event.collection("auditEntries").get()).size, 0);
});

test("rescheduling moves live default invites and preserves manual, expired, and disabled links", async () => {
  const [host, confirmed, waitlisted] = await Promise.all([signIn(), signIn(), signIn()]);
  const oldStart = dateInDays(1);
  const newStart = dateInDays(2);
  const manualExpiration = dateInDays(3);
  const event = await createEvent(host, oldStart);
  const [live, disabled, expired, manual] = await Promise.all([
    createInvite(event, host, { slug: "live" }),
    createInvite(event, host, { slug: "disabled" }),
    createInvite(event, host, { slug: "expired" }),
    createInvite(event, host, { slug: "manual", expiresAt: manualExpiration }),
  ]);
  const expiredAt = Timestamp.fromDate(new Date(dateInDays(-1)));
  const disabledInvite = await expectJson(await write(`host/events/${event.id}/invites`, host, "PATCH", { token: disabled.token }), 200);
  await inviteRef(expired).update({ expiresAt: expiredAt });

  const participants = await Promise.all([confirmed, waitlisted].map(async (guest, index) => {
    const ref = participantRef(event, guest);
    const data = { uid: guest.uid, membershipStatus: "active", rsvpStatus: index ? "waitlisted" : "confirmed", blockedAt: null };
    await ref.create(data);
    return { ref, data };
  }));

  const request = { startAt: newStart };
  assert.deepEqual(await expectJson(await schedule(event, host, request), 200), request);
  assert.deepEqual(await expectJson(await schedule(event, host, request), 200), request);
  const [liveDoc, disabledDoc, expiredDoc, manualDoc] = await Promise.all([live, disabled, expired, manual].map((invite) => inviteRef(invite).get()));
  assert.equal(liveDoc.get("expiresAt").toDate().toISOString(), newStart);
  assert.equal(disabledDoc.get("expiresAt").toDate().toISOString(), oldStart);
  assert.equal(disabledDoc.get("disabledAt").toDate().toISOString(), disabledInvite.disabledAt);
  assert.ok(expiredDoc.get("expiresAt").isEqual(expiredAt));
  assert.equal(manualDoc.get("expiresAt").toDate().toISOString(), manualExpiration);

  const audit = await event.collection("auditEntries").get();
  assert.equal(audit.size, 1);
  const { action, actorUid, changedFields, createdAt } = audit.docs[0].data();
  assert.deepEqual({ action, actorUid, changedFields }, { action: "event_details_updated", actorUid: host.uid, changedFields: ["startAt"] });
  assert.ok(createdAt instanceof Timestamp);
  for (const { ref, data } of participants) assert.deepEqual((await ref.get()).data(), data);

  async function view(account) {
    return expectJson(await fetch(`${appOrigin}/api/events/${event.id}`, { headers: { cookie: account.cookie } }), 200);
  }
  assert.equal((await view(confirmed)).details.startAt, newStart);
  assert.equal((await view(waitlisted)).details, undefined);
});

test("announcing a TBA start keeps manual expirations and enables default invites", async () => {
  const host = await signIn();
  const event = await createEvent(host, null);
  const manualExpiration = dateInDays(3);
  const manual = await createInvite(event, host, { slug: "manual", expiresAt: manualExpiration });
  const startAt = dateInDays(2);
  await expectJson(await schedule(event, host, { startAt }), 200);
  const defaultInvite = await createInvite(event, host, { slug: "default" });
  assert.equal(defaultInvite.expiresAt, startAt);
  assert.equal((await inviteRef(manual).get()).get("expiresAt").toDate().toISOString(), manualExpiration);
});

test("concurrent invite creation, disable, and redemption stay consistent with rescheduling", async () => {
  const [host, guest] = await Promise.all([signIn(), signIn()]);
  const oldStart = dateInDays(1);
  const startAt = dateInDays(2);
  const event = await createEvent(host, oldStart);
  const [forDisable, forRedemption] = await Promise.all([
    createInvite(event, host, { slug: "disable" }),
    createInvite(event, host, { slug: "redeem" }),
  ]);

  const [, created, , redeemed] = await Promise.all([
    schedule(event, host, { startAt }).then((response) => expectJson(response, 200)),
    createInvite(event, host, { slug: "concurrent" }),
    write(`host/events/${event.id}/invites`, host, "PATCH", { token: forDisable.token }).then((response) => expectJson(response, 200)),
    write("invites/redeem", guest, "POST", { invite: `${forRedemption.slug}-${forRedemption.token}` }).then((response) => expectJson(response, 200)),
  ]);
  const [createdDoc, disableDoc, redemptionDoc] = await Promise.all([created, forDisable, forRedemption].map((invite) => inviteRef(invite).get()));
  assert.equal(createdDoc.get("expiresAt").toDate().toISOString(), startAt);
  assert.ok(disableDoc.get("disabledAt") instanceof Timestamp);
  assert.equal(redemptionDoc.get("expiresAt").toDate().toISOString(), startAt);
  assert.equal(redeemed.eventId, event.id);
  assert.equal((await participantRef(event, guest).get()).get("membershipStatus"), "active");
});
