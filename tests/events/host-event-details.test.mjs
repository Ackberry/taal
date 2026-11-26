import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import process from "node:process";
import test from "node:test";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { appOrigin, signIn } from "./emulator-session.mjs";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const db = getFirestore(initializeApp({ projectId: "demo-taal" }));

function request(path, account, options = {}) {
  const { headers, ...init } = options;
  return fetch(`${appOrigin}${path}`, {
    ...init,
    headers: { ...(account && { cookie: account.cookie }), ...headers },
    redirect: "manual",
  });
}

function update(event, account, patch, headers = {}) {
  return request(`/api/host/events/${event.id}/details`, account, {
    method: "PATCH",
    headers: { origin: appOrigin, "content-type": "application/json", ...headers },
    body: JSON.stringify(patch),
  });
}

async function createEvent(owner) {
  const ref = db.collection("events").doc(`test-${randomUUID()}`);
  await ref.create({ ownerUid: owner.uid, name: "Test event", startAt: null, capacity: 1, rsvpSequence: 2 });
  return ref;
}

async function addGuest(event, account, rsvpStatus) {
  const key = createHash("sha256").update(account.uid).digest("hex");
  const ref = event.collection("participants").doc(key);
  await ref.create({ uid: account.uid, membershipStatus: "active", blockedAt: null, rsvpStatus });
  return ref;
}

async function success(response) {
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json();
}

test("only the verified owner can open the editor and save a valid patch", async () => {
  const [owner, otherHost] = await Promise.all([signIn(), signIn()]);
  await Promise.all([owner, otherHost].map(({ uid }) => db.collection("hostAccounts").doc(uid).create({})));
  const event = await createEvent(owner);
  const editor = `/host/events/${event.id}/details`;
  assert.match(await (await request("/host/events", owner)).text(), new RegExp(editor));
  assert.equal((await request(editor)).status, 307);
  assert.equal((await request(editor, otherHost)).status, 404);
  assert.equal((await update(event, null, { name: "Rejected" })).status, 401);
  assert.equal((await update(event, otherHost, { name: "Rejected" })).status, 404);
  assert.equal((await update(event, owner, { name: "Rejected" }, { origin: "https://example.test" })).status, 403);
  assert.equal((await update(event, owner, {}, { "content-type": "text/plain" })).status, 415);

  const invalid = await update(event, owner, { name: "   ", location: 123, description: "x".repeat(4001) });
  assert.equal(invalid.status, 400);
  assert.deepEqual(Object.keys((await invalid.json()).fields).sort(), ["description", "location", "name"]);
  assert.equal((await update(event, owner, { name: "Rejected", capacity: 10 })).status, 400);
  assert.equal((await event.get()).get("name"), "Test event");
  assert.equal((await event.collection("auditEntries").get()).size, 0);
});

test("a saved edit reloads in the editor and stays private to the owner and confirmed guests", async () => {
  const [owner, confirmed, waitlisted, unconfirmed, outsider] = await Promise.all(
    Array.from({ length: 5 }, () => signIn()),
  );
  const event = await createEvent(owner);
  const participants = await Promise.all([
    addGuest(event, confirmed, "confirmed"),
    addGuest(event, waitlisted, "waitlisted"),
    addGuest(event, unconfirmed, "none"),
  ]);
  const before = await event.get();
  const page = `/events/${event.id}`;
  const api = `/api${page}`;
  const editor = `/host/events/${event.id}/details`;
  const details = {
    location: "Test venue 123",
    description: "Test description",
    dressCode: "Test dress code",
    lastEntryTime: "10 PM ET",
    idRequirements: "Test photo ID",
    plusOnePolicy: "Test plus-one policy",
    directions: "Test directions",
    entrance: "Test entrance",
    dropOff: "Test drop-off",
    stepFreeAccess: "Test accessible entrance",
    contact: "access@example.test",
  };

  const saved = await success(await update(event, owner, { name: " Updated listing ", ...details }));
  assert.deepEqual(saved, { name: "Updated listing", ...details });
  const editorPage = await request(editor, owner);
  assert.equal(editorPage.status, 200);
  const editorHtml = await editorPage.text();
  assert.match(editorHtml, /value="Updated listing"/);
  const ownerView = await success(await request(api, owner));
  const guestView = await success(await request(api, confirmed));
  assert.deepEqual(ownerView, { name: saved.name, role: "host", details: { startAt: null, ...details } });
  assert.deepEqual(guestView, { ...ownerView, role: "guest", rsvpStatus: "confirmed" });
  const confirmedPage = await (await request(page, confirmed)).text();
  assert.match(confirmedPage, /You’re going/);
  for (const value of Object.values(details)) {
    assert.ok(editorHtml.includes(value));
    assert.ok(confirmedPage.includes(value));
  }

  for (const [account, status, rsvpStatus] of [
    [null, 401], [outsider, 404], [unconfirmed, 200, "none"], [waitlisted, 200, "waitlisted"],
  ]) {
    const response = await request(api, account);
    assert.equal(response.status, status);
    const body = await response.json();
    if (rsvpStatus) assert.deepEqual(body, { name: saved.name, role: "guest", rsvpStatus });
    const htmlResponse = await request(page, account);
    assert.equal(htmlResponse.status, account === outsider ? 404 : 200);
    const html = await htmlResponse.text();
    for (const value of Object.values(details)) {
      assert.ok(!JSON.stringify(body).includes(value));
      assert.ok(!html.includes(value));
    }
  }

  const audit = event.collection("auditEntries");
  const persisted = (await audit.get()).docs.map((doc) => doc.data());
  assert.equal(persisted.length, 1);
  const [{ action, actorUid, changedFields, createdAt }] = persisted;
  assert.equal(action, "event_details_updated");
  assert.equal(actorUid, owner.uid);
  assert.deepEqual([...changedFields].sort(), Object.keys(saved).sort());
  assert.ok(createdAt instanceof Timestamp);

  const cleared = await success(await update(event, owner, { location: "  ", contact: null }));
  assert.equal(cleared.location, undefined);
  assert.equal(cleared.contact, undefined);
  assert.equal(cleared.description, details.description);
  assert.deepEqual(await success(await update(event, owner, { location: null, contact: null })), cleared);
  assert.equal((await audit.get()).size, 2);
  assert.match(await (await request(page, confirmed)).text(), /Venue or address<\/dt><dd>TBA<\/dd>/);
  const { startAt, capacity, rsvpSequence } = (await event.get()).data();
  assert.deepEqual({ startAt, capacity, rsvpSequence }, {
    startAt: before.get("startAt"), capacity: before.get("capacity"), rsvpSequence: before.get("rsvpSequence"),
  });
  assert.deepEqual(await Promise.all(participants.map(async (ref) => (await ref.get()).get("rsvpStatus"))),
    ["confirmed", "waitlisted", "none"]);
});

test("concurrent edits to different fields both survive and are audited", async () => {
  const owner = await signIn();
  const event = await createEvent(owner);
  await Promise.all([
    update(event, owner, { description: "Test program" }).then(success),
    update(event, owner, { location: "Test venue" }).then(success),
  ]);
  assert.deepEqual((await event.get()).get("privateDetails"), {
    location: "Test venue", description: "Test program",
  });
  const entries = (await event.collection("auditEntries").get()).docs;
  assert.deepEqual(entries.flatMap((entry) => entry.get("changedFields")).sort(), ["description", "location"]);
});
