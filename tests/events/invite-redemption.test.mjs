import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import test from "node:test";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { appOrigin, signIn } from "./emulator-session.mjs";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const db = getFirestore(initializeApp({ projectId: "demo-taal" }));

function redeem(invite, account, origin = appOrigin) {
  return fetch(appOrigin + "/api/invites/redeem", {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...(account && { cookie: account.cookie }) },
    body: JSON.stringify({ invite }),
  });
}

async function fixture() {
  const event = db.collection("events").doc("test-" + randomUUID());
  const now = Date.now();
  await event.create({ name: "Test event" });

  async function invite(slug, { expiresAt = now + 60_000, disabledAt = null } = {}) {
    const token = randomBytes(32).toString("base64url");
    await db.collection("eventInvites").doc(token).create({
      eventId: event.id,
      slug,
      createdAt: Timestamp.fromMillis(now),
      expiresAt: Timestamp.fromMillis(expiresAt),
      expirationMode: "manual",
      disabledAt,
    });
    return slug + "-" + token;
  }

  return { event, invite };
}

function participant(event, account) {
  return event.collection("participants").doc(createHash("sha256").update(account.uid).digest("hex"));
}

test("redemption requires a verified same-origin request and an exact live invite", async () => {
  const account = await signIn();
  const { event, invite } = await fixture();
  const live = await invite("special-party");
  const expired = await invite("expired", { expiresAt: Date.now() - 1 });
  const disabled = await invite("disabled", { disabledAt: Timestamp.now() });
  assert.equal((await redeem(live)).status, 401);
  assert.equal((await redeem(live, account, "https://example.test")).status, 403);
  for (const invalid of ["bad", "other-party" + live.slice(-44), expired, disabled]) {
    assert.equal((await redeem(invalid, account)).status, 404);
  }
  assert.equal((await participant(event, account).get()).exists, false);
});

test("concurrent redemption creates one membership and keeps existing RSVP state", async () => {
  const account = await signIn();
  const { event, invite } = await fixture();
  const [first, second] = await Promise.all([invite("special-party"), invite("second-link")]);
  const results = await Promise.all([redeem(first, account), redeem(second, account)]);
  for (const result of results) {
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { eventId: event.id });
  }
  assert.equal((await event.collection("participants").get()).size, 1);

  const record = participant(event, account);
  assert.equal((await record.get()).get("rsvpStatus"), "none");
  await record.update({ rsvpStatus: "waitlisted", waitlistPosition: 4 });
  const waitlisted = (await record.get()).data();
  assert.equal((await redeem(second, account)).status, 200);
  assert.deepEqual((await record.get()).data(), waitlisted);

  await record.update({ membershipStatus: "canceled" });
  assert.equal((await redeem(first, account)).status, 200);
  const rejoined = await record.get();
  assert.equal(rejoined.get("membershipStatus"), "active");
  assert.equal(rejoined.get("rsvpStatus"), "none");
  assert.equal(rejoined.get("waitlistPosition"), null);
});

test("blocked attempts are counted across links and do not change membership", async () => {
  const [account, otherAccount] = await Promise.all([signIn(), signIn()]);
  const { event, invite } = await fixture();
  const links = await Promise.all([invite("special-party"), invite("second-link")]);
  const record = participant(event, account);
  const blocked = { uid: account.uid, membershipStatus: "removed", blockedAt: Timestamp.now() };
  await record.create(blocked);

  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await redeem(links[attempt % links.length], account)).status, 404);
  }
  const limited = await redeem(links[1], account);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.deepEqual((await record.get()).data(), blocked);
  assert.equal((await redeem(links[0], otherAccount)).status, 200);
});

function openInvite(segment, account) {
  return fetch(appOrigin + "/invite/" + segment, {
    redirect: "manual",
    headers: account ? { cookie: account.cookie } : {},
  });
}

test("the browser entry rejects unavailable links before exposing sign-in", async () => {
  const event = await fixture();
  const live = await event.invite("special-party");
  const expired = await event.invite("expired", { expiresAt: Date.now() - 1 });
  const disabled = await event.invite("disabled", { disabledAt: Timestamp.now() });
  for (const invalid of ["bad", "other-party" + live.slice(-44), expired, disabled]) {
    const response = await openInvite(invalid);
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /Continue with Google/);
  }

  const page = await openInvite(live);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("cache-control"), /no-store/);
  const html = await page.text();
  assert.match(html, /Continue with Google/);
  assert.match(html, /Get a code by text/);
  assert.doesNotMatch(html, /Test event/);

  const account = await signIn();
  const signedInPage = await openInvite(live, account);
  assert.equal(signedInPage.status, 200);
  assert.match(await signedInPage.text(), /Opening invite/);
  assert.equal((await participant(event.event, account).get()).exists, false);
});

function eventView(eventId, account, { api = false } = {}) {
  const path = api ? "/api/events/" : "/events/";
  return fetch(appOrigin + path + eventId, { headers: account ? { cookie: account.cookie } : {} });
}

test("the ordinary event URL grants no access until redemption and returns only RSVP fields", async () => {
  const [guest, host] = await Promise.all([signIn(), signIn()]);
  const { event, invite } = await fixture();
  const link = await invite("shared-link");
  const startAt = "2031-04-13T16:47:00.000Z";
  const address = "Private fixture address";
  await event.update({ ownerUid: host.uid, startAt: Timestamp.fromDate(new Date(startAt)), address });

  const signedOutPage = await eventView(event.id);
  assert.equal(signedOutPage.status, 200);
  const signInForm = await signedOutPage.text();
  assert.match(signInForm, /Sign in to view the event/);
  assert.doesNotMatch(signInForm, /Test event|Private fixture address/);
  assert.equal((await eventView(event.id, null, { api: true })).status, 401);
  assert.equal((await eventView(event.id, guest)).status, 404);
  assert.equal((await eventView(event.id, guest, { api: true })).status, 404);
  const member = participant(event, guest);
  assert.equal((await member.get()).exists, false);
  assert.equal((await redeem(link, guest)).status, 200);

  for (const [rsvpStatus, label] of [["none", /RSVPed yet/], ["waitlisted", /on the waitlist/]]) {
    await member.update({ rsvpStatus });
    const limited = await eventView(event.id, guest, { api: true });
    assert.equal(limited.status, 200);
    assert.match(limited.headers.get("cache-control"), /no-store/);
    assert.deepEqual(await limited.json(), { name: "Test event", role: "guest", rsvpStatus });
    const page = await eventView(event.id, guest);
    assert.match(page.headers.get("cache-control"), /no-store/);
    const html = await page.text();
    assert.match(html, label);
    assert.equal(html.includes(startAt), false);
    assert.equal(html.includes(address), false);
    assert.doesNotMatch(html, /Event details/);
  }

  const raw = await fetch(
    `http://127.0.0.1:8080/v1/projects/demo-taal/databases/(default)/documents/events/${event.id}`,
    { headers: { authorization: `Bearer ${guest.idToken}` } },
  );
  assert.equal(raw.status, 403);

  await member.update({ rsvpStatus: "confirmed" });
  assert.deepEqual(await (await eventView(event.id, guest, { api: true })).json(), {
    name: "Test event", role: "guest", rsvpStatus: "confirmed", details: { startAt },
  });
  assert.match(await (await eventView(event.id, guest)).text(), /Event details/);
  assert.deepEqual(await (await eventView(event.id, host, { api: true })).json(), {
    name: "Test event", role: "host", details: { startAt },
  });

  for (const state of [
    { membershipStatus: "canceled" },
    { membershipStatus: "removed" },
    { membershipStatus: "active", blockedAt: Timestamp.now() },
  ]) {
    await member.update(state);
    assert.equal((await eventView(event.id, guest)).status, 404);
    assert.equal((await eventView(event.id, guest, { api: true })).status, 404);
  }
});
