import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import process from "node:process";
import test from "node:test";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { appOrigin, signIn } from "./emulator-session.mjs";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const db = getFirestore(initializeApp({ projectId: "demo-taal" }));
const startAt = "2031-04-13T16:47:00.000Z";

async function createEvent(fields = {}) {
  const event = db.collection("events").doc("test-" + randomUUID());
  await event.create({
    name: "Test event",
    startAt: Timestamp.fromDate(new Date(startAt)),
    ...fields,
  });
  return event;
}

async function addMember(event, account, fields = {}) {
  const key = createHash("sha256").update(account.uid).digest("hex");
  const ref = event.collection("participants").doc(key);
  await ref.create({
    uid: account.uid,
    membershipStatus: "active",
    blockedAt: null,
    rsvpStatus: "none",
    waitlistPosition: null,
    joinedAt: Timestamp.now(),
    ...fields,
  });
  return ref;
}

function submit(event, account, origin = appOrigin) {
  return fetch(appOrigin + "/api/events/" + event.id + "/rsvp", {
    method: "POST",
    headers: { origin, ...(account && { cookie: account.cookie }) },
  });
}

async function eventPage(event, account) {
  const response = await fetch(appOrigin + "/events/" + event.id, { headers: { cookie: account.cookie } });
  assert.equal(response.status, 200);
  return response.text();
}

async function savedOutcome(response) {
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "no-store");
  const { rsvpStatus } = await response.json();
  return rsvpStatus;
}

test("RSVP requires a verified, active, unblocked guest and the app origin", async () => {
  const [guest, host] = await Promise.all([signIn(), signIn()]);
  const event = await createEvent({ ownerUid: host.uid });
  assert.equal((await submit(event)).status, 401);
  assert.equal((await submit(event, guest, "https://example.test")).status, 403);
  assert.equal((await submit(event, guest)).status, 404);
  await addMember(event, host);
  assert.equal((await submit(event, host)).status, 404);

  const member = await addMember(event, guest, { blockedAt: Timestamp.now() });
  assert.equal((await submit(event, guest)).status, 404);
  await member.update({ blockedAt: null, membershipStatus: "canceled" });
  assert.equal((await submit(event, guest)).status, 404);
  assert.equal((await member.get()).get("rsvpStatus"), "none");
});

test("concurrent RSVPs for the final spot save one outcome per guest", async () => {
  const event = await createEvent({ capacity: 1 });
  const guests = await Promise.all([signIn(), signIn()]);
  const members = await Promise.all(guests.map((guest) => addMember(event, guest)));
  const rsvpButton = /<button[^>]*>RSVP<\/button>/;
  assert.match(await eventPage(event, guests[0]), rsvpButton);
  const outcomes = await Promise.all(guests.map(async (guest) => savedOutcome(await submit(event, guest))));
  assert.deepEqual([...outcomes].sort(), ["confirmed", "waitlisted"]);

  for (const [index, guest] of guests.entries()) {
    const member = members[index];
    const before = (await member.get()).data();
    assert.equal(before.rsvpStatus, outcomes[index]);
    assert.equal(await savedOutcome(await submit(event, guest)), outcomes[index]);
    assert.deepEqual((await member.get()).data(), before);

    const view = await fetch(appOrigin + "/api/events/" + event.id, { headers: { cookie: guest.cookie } });
    assert.equal(view.status, 200);
    const details = outcomes[index] === "confirmed" ? { details: { startAt } } : {};
    assert.deepEqual(await view.json(), {
      name: "Test event", role: "guest", rsvpStatus: outcomes[index], ...details,
    });

    const page = await eventPage(event, guest);
    assert.doesNotMatch(page, rsvpButton);
    if (outcomes[index] === "confirmed") {
      assert.match(page, /You’re going/);
      assert.ok(page.includes(startAt));
    } else {
      assert.match(page, /You’re on the waitlist/);
      assert.ok(!page.includes(startAt));
    }
  }
  assert.equal((await event.get()).get("rsvpSequence"), 2);
});

test("an open spot goes to the oldest eligible waitlisted guest", async () => {
  const event = await createEvent({ capacity: 1 });
  const [first, second, incoming] = await Promise.all([signIn(), signIn(), signIn()]);
  const earlier = await addMember(event, first, { rsvpStatus: "waitlisted", waitlistPosition: 4 });
  const later = await addMember(event, second, { rsvpStatus: "waitlisted", waitlistPosition: 5 });
  const newcomer = await addMember(event, incoming);

  assert.equal(await savedOutcome(await submit(event, incoming)), "waitlisted");
  assert.equal((await earlier.get()).get("rsvpStatus"), "confirmed");
  assert.equal((await earlier.get()).get("waitlistPosition"), null);
  assert.equal((await later.get()).get("rsvpStatus"), "waitlisted");
  assert.equal((await later.get()).get("waitlistPosition"), 5);
  assert.equal((await newcomer.get()).get("waitlistPosition"), 6);
});

test("an event without capacity confirms existing waitlisted guests and new RSVPs", async () => {
  const event = await createEvent({ capacity: null });
  const [first, second] = await Promise.all([signIn(), signIn()]);
  const earlier = await addMember(event, first, { rsvpStatus: "waitlisted", waitlistPosition: 1 });
  await addMember(event, second);

  const duplicate = await Promise.all([submit(event, second), submit(event, second)]);
  assert.deepEqual(await Promise.all(duplicate.map(savedOutcome)), ["confirmed", "confirmed"]);
  assert.equal((await earlier.get()).get("rsvpStatus"), "confirmed");
  assert.equal((await event.get()).get("rsvpSequence"), 2);
});
