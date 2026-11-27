import assert from "node:assert/strict";
import { Blob, Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import process from "node:process";
import test from "node:test";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import sharp from "sharp";
import { appOrigin, signIn } from "./emulator-session.mjs";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
process.env.STORAGE_EMULATOR_HOST = "http://127.0.0.1:9199";
const app = initializeApp({ projectId: "demo-taal", storageBucket: "demo-taal.appspot.com" });
const db = getFirestore(app);
const bucket = getStorage(app).bucket();

function mediaRequest(event, account, { method, body, query = "", origin = appOrigin }) {
  return fetch(`${appOrigin}/api/host/events/${event.id}/media${query}`, {
    headers: { origin, ...(account && { cookie: account.cookie }) },
    method,
    body,
  });
}

function upload(event, account, kind, bytes, alt, origin) {
  const body = new globalThis.FormData();
  body.set("kind", kind);
  body.set("image", new Blob([bytes], { type: "image/png" }), "upload.png");
  if (alt) body.set("alt", alt);
  return mediaRequest(event, account, { method: "POST", body, origin });
}

function remove(event, account, imageId) {
  return mediaRequest(event, account, { method: "DELETE", query: `?imageId=${imageId}` });
}

function readEvent(event, account, suffix = "") {
  return fetch(`${appOrigin}/api/events/${event.id}${suffix}`, { headers: account ? { cookie: account.cookie } : {} });
}

function page(path, account) {
  return fetch(`${appOrigin}${path}`, {
    redirect: "manual",
    headers: account ? { cookie: account.cookie } : {},
  });
}

async function addMember(event, account, rsvpStatus) {
  const id = createHash("sha256").update(account.uid).digest("hex");
  const member = event.collection("participants").doc(id);
  await member.create({
    uid: account.uid,
    membershipStatus: "active",
    rsvpStatus,
    blockedAt: null,
    waitlistPosition: rsvpStatus === "waitlisted" ? 1 : null,
    joinedAt: Timestamp.now(),
  });
  return member;
}

async function expectJson(response, status) {
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json();
}

async function createEvent(host, t) {
  const event = db.collection("events").doc(`test-${randomUUID()}`);
  await event.create({ ownerUid: host.uid, name: "Test event", startAt: null });
  t.after(() => bucket.deleteFiles({ prefix: `events/${event.id}/` }));
  return event;
}

function sampleImage(color) {
  return sharp({ create: { width: 20, height: 10, channels: 3, background: color } }).png().toBuffer();
}

test("only the event owner can upload event media from the app origin", async (t) => {
  const [host, guest] = await Promise.all([signIn(), signIn()]);
  const event = await createEvent(host, t);
  const bytes = await sampleImage("#369");
  assert.equal((await upload(event, null, "photo", bytes)).status, 401);
  assert.equal((await upload(event, guest, "photo", bytes)).status, 404);
  assert.equal((await upload(event, host, "photo", bytes, "", "https://example.test")).status, 403);
  assert.equal((await mediaRequest(event, host, { method: "POST", body: "not multipart" })).status, 415);
  assert.equal((await upload(event, host, "invalid", bytes)).status, 400);
  assert.equal((await upload(event, host, "photo", bytes, "x".repeat(201))).status, 400);
  assert.equal((await event.collection("media").get()).size, 0);
});

test("invalid replacements preserve the saved photo and a valid replacement switches the object", async (t) => {
  const host = await signIn();
  const event = await createEvent(host, t);
  const firstImage = await sampleImage("#369");
  const secondImage = await sampleImage("#fe5");
  const photo = event.collection("media").doc("photo");
  const first = await expectJson(await upload(event, host, "photo", firstImage, " First banner "), 201);
  assert.deepEqual(first, { id: first.id, kind: "photo", alt: "First banner" });
  const previous = (await photo.get()).data();
  const [originalBytes] = await bucket.file(previous.objectPath).download();

  const bad = await expectJson(await upload(event, host, "photo", Buffer.from("invalid")), 400);
  assert.equal(bad.code, "unsupported_image");
  for (const size of [3 * 1024 * 1024 + 1, 4 * 1024 * 1024]) {
    const big = await expectJson(await upload(event, host, "photo", Buffer.alloc(size)), 413);
    assert.equal(big.code, "image_too_large");
  }
  const chunk = Buffer.alloc(64 * 1024);
  let remaining = 64;
  const streamed = await fetch(`${appOrigin}/api/host/events/${event.id}/media`, {
    method: "POST",
    headers: { origin: appOrigin, cookie: host.cookie, "content-type": "multipart/form-data; boundary=test" },
    duplex: "half",
    body: new globalThis.ReadableStream({
      pull(controller) {
        if (remaining-- > 0) controller.enqueue(chunk);
        else controller.close();
      },
    }),
  });
  assert.equal((await expectJson(streamed, 413)).code, "image_too_large");
  assert.deepEqual((await photo.get()).data(), previous);
  assert.deepEqual((await bucket.file(previous.objectPath).download())[0], originalBytes);
  assert.equal((await event.collection("auditEntries").get()).size, 1);

  const second = await expectJson(await upload(event, host, "photo", secondImage), 201);
  assert.notEqual(second.id, first.id);
  const current = (await photo.get()).data();
  assert.equal(current.id, second.id);
  assert.equal((await bucket.file(previous.objectPath).exists())[0], false);
  const [savedBytes] = await bucket.file(current.objectPath).download();
  assert.equal((await sharp(savedBytes).metadata()).format, "webp");
  assert.notDeepEqual(savedBytes, originalBytes);
  assert.equal((await readEvent(event, host, `/media/${first.id}`)).status, 404);
  assert.equal((await readEvent(event, host, `/media/${second.id}`)).status, 200);
  const audit = await event.collection("auditEntries").get();
  assert.equal(audit.size, 2);
  assert.ok(audit.docs.every((entry) => entry.get("action") === "event_details_updated" && entry.get("actorUid") === host.uid));
});

test("reference images are independent and only their event owner can remove them", async (t) => {
  const [host, guest] = await Promise.all([signIn(), signIn()]);
  const [event, otherEvent] = await Promise.all([createEvent(host, t), createEvent(host, t)]);
  const bytes = await sampleImage("#369");
  const first = await expectJson(await upload(event, host, "reference", bytes, "Entrance"), 201);
  const second = await expectJson(await upload(event, host, "reference", bytes, "Flyer"), 201);
  const { objectPath } = (await event.collection("media").doc(first.id).get()).data();

  assert.equal((await remove(event, guest, first.id)).status, 404);
  assert.equal((await remove(otherEvent, host, first.id)).status, 404);
  assert.equal((await event.collection("media").get()).size, 2);
  const response = await remove(event, host, first.id);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await remove(event, host, first.id)).status, 404);
  const remaining = await event.collection("media").get();
  assert.deepEqual(remaining.docs.map((doc) => doc.id), [second.id]);
  assert.equal((await bucket.file(objectPath).exists())[0], false);
  assert.equal((await readEvent(event, host, `/media/${first.id}`)).status, 404);
  const editor = await page(`/host/events/${event.id}/media`, host);
  assert.equal(editor.status, 200);
  const html = await editor.text();
  assert.ok(!html.includes(first.id));
  assert.ok(html.includes(second.id));
  assert.equal((await event.collection("auditEntries").get()).size, 3);
});

test("concurrent photo replacements leave one current storage object", async (t) => {
  const host = await signIn();
  const event = await createEvent(host, t);
  const bytes = await sampleImage("#369");
  const results = await Promise.all(["First", "Second"].map(async (alt) => (
    expectJson(await upload(event, host, "photo", bytes, alt), 201)
  )));
  const [stored] = await bucket.getFiles({ prefix: `events/${event.id}/` });
  const photo = (await event.collection("media").doc("photo").get()).data();
  assert.ok(results.some(({ id }) => photo.id === id));
  assert.deepEqual(stored.map((file) => file.name), [photo.objectPath]);
  assert.equal((await event.collection("auditEntries").get()).size, 2);
});

test("the fifth slot is shared by photo and references, and concurrent uploads cannot exceed it", async (t) => {
  const host = await signIn();
  const event = await createEvent(host, t);
  const bytes = await sampleImage("#369");
  const photo = await expectJson(await upload(event, host, "photo", bytes), 201);
  for (let index = 0; index < 3; index++) {
    await expectJson(await upload(event, host, "reference", bytes), 201);
  }

  const attempts = await Promise.all([
    upload(event, host, "reference", bytes, "First"), upload(event, host, "reference", bytes, "Second"),
  ]);
  assert.deepEqual(attempts.map(({ status }) => status).sort(), [201, 409]);
  const blocked = await expectJson(attempts.find(({ status }) => status === 409), 409);
  assert.equal(blocked.code, "image_limit_reached");
  assert.equal((await event.get()).get("mediaCount"), 5);
  assert.equal((await event.collection("media").get()).size, 5);
  assert.equal((await bucket.getFiles({ prefix: `events/${event.id}/` }))[0].length, 5);
  assert.equal((await event.collection("auditEntries").get()).size, 5);

  const editor = await page(`/host/events/${event.id}/media`, host);
  assert.equal(editor.status, 200);
  const html = await editor.text();
  assert.match(html, /5<!-- --> of <!-- -->5<!-- --> images/);
  assert.match(html, /<button[^>]* disabled=""[^>]*>Add reference image<\/button>/);
  assert.match(html, /<button class="button" type="submit">Replace event photo<\/button>/);

  const newPhoto = await expectJson(await upload(event, host, "photo", bytes), 201);
  assert.notEqual(newPhoto.id, photo.id);
  assert.equal((await event.get()).get("mediaCount"), 5);
  const added = await expectJson(attempts.find(({ status }) => status === 201), 201);
  assert.equal((await remove(event, host, added.id)).status, 204);
  assert.equal((await event.get()).get("mediaCount"), 4);
  await expectJson(await upload(event, host, "reference", bytes), 201);
  assert.equal((await event.collection("media").get()).size, 5);
});

test("an event with five reference images needs a free slot before its first photo", async (t) => {
  const host = await signIn();
  const event = await createEvent(host, t);
  const bytes = await sampleImage("#369");
  const first = await expectJson(await upload(event, host, "reference", bytes), 201);
  for (let index = 0; index < 4; index++) {
    await expectJson(await upload(event, host, "reference", bytes), 201);
  }
  // Existing media records can predate the stored count.
  await event.update({ mediaCount: FieldValue.delete() });

  assert.equal((await expectJson(await upload(event, host, "photo", bytes), 409)).code, "image_limit_reached");
  assert.equal((await remove(event, host, first.id)).status, 204);
  assert.equal((await event.get()).get("mediaCount"), 4);
  await expectJson(await upload(event, host, "photo", bytes), 201);
  assert.equal((await event.get()).get("mediaCount"), 5);
});

test("event views and direct image requests enforce current photo and reference visibility", async (t) => {
  const [host, confirmed, waitlisted, member, outsider] = await Promise.all(Array.from({ length: 5 }, () => signIn()));
  const [event, otherEvent] = await Promise.all([createEvent(host, t), createEvent(host, t)]);
  const [confirmedEntry, waitlistedEntry] = await Promise.all([
    addMember(event, confirmed, "confirmed"), addMember(event, waitlisted, "waitlisted"), addMember(event, member, "none"),
  ]);
  const bytes = await sampleImage("#369");
  const photo = await expectJson(await upload(event, host, "photo", bytes, "Banner"), 201);
  const reference = await expectJson(await upload(event, host, "reference", bytes, "Private entrance"), 201);
  const photoUrl = `/media/${photo.id}`;
  const referenceUrl = `/media/${reference.id}`;

  const eventPath = `/events/${event.id}`;
  const hostPath = `/host${eventPath}/media`;
  await db.collection("hostAccounts").doc(host.uid).create({});
  const dashboard = await page("/host/events", host);
  assert.equal(dashboard.status, 200);
  assert.ok((await dashboard.text()).includes(`href="${hostPath}"`));
  assert.equal((await page(hostPath)).status, 307);
  assert.equal((await page(hostPath, confirmed)).status, 404);
  const manager = await page(hostPath, host);
  assert.equal(manager.status, 200);
  const editor = await manager.text();
  assert.match(editor, /Replace event photo/);
  assert.match(editor, /Add reference image/);
  assert.match(editor, /Remove image 1 \(Private entrance\)/);

  const confirmedPage = await page(eventPath, confirmed);
  assert.equal(confirmedPage.status, 200);
  const confirmedHtml = await confirmedPage.text();
  assert.ok(confirmedHtml.includes(`src="/api${eventPath}${photoUrl}"`));
  assert.ok(confirmedHtml.includes(`src="/api${eventPath}${referenceUrl}"`));
  assert.match(confirmedHtml, /alt="Private entrance"/);

  const waitlistedPage = await page(eventPath, waitlisted);
  assert.equal(waitlistedPage.status, 200);
  const waitlistedHtml = await waitlistedPage.text();
  assert.ok(waitlistedHtml.includes(`src="/api${eventPath}${photoUrl}"`));
  assert.ok(!waitlistedHtml.includes(reference.id));
  assert.ok(!waitlistedHtml.includes("Private entrance"));

  for (const viewer of [host, confirmed]) {
    const view = await expectJson(await readEvent(event, viewer), 200);
    assert.deepEqual(view.photo, photo);
    assert.deepEqual(view.details.referenceImages, [reference]);
    for (const url of [photoUrl, referenceUrl]) {
      const image = await readEvent(event, viewer, url);
      assert.equal(image.status, 200);
      assert.equal(image.headers.get("content-type"), "image/webp");
      assert.equal(image.headers.get("cache-control"), "private, no-store");
      assert.equal(image.headers.get("cross-origin-resource-policy"), "same-origin");
      assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format, "webp");
    }
  }

  for (const [viewer, rsvpStatus] of [[waitlisted, "waitlisted"], [member, "none"]]) {
    assert.deepEqual(await expectJson(await readEvent(event, viewer), 200), {
      name: "Test event", role: "guest", rsvpStatus, photo,
    });
    assert.equal((await readEvent(event, viewer, photoUrl)).status, 200);
    assert.equal((await readEvent(event, viewer, referenceUrl)).status, 404);
  }
  for (const url of [photoUrl, referenceUrl]) {
    assert.equal((await readEvent(event, null, url)).status, 401);
    assert.equal((await readEvent(event, outsider, url)).status, 404);
    assert.equal((await readEvent(otherEvent, host, url)).status, 404);
  }

  await waitlistedEntry.update({ rsvpStatus: "confirmed", waitlistPosition: null });
  assert.equal((await readEvent(event, waitlisted, referenceUrl)).status, 200);
  const reduction = await fetch(`${appOrigin}/api/host/events/${event.id}/capacity`, {
    method: "PATCH",
    headers: { origin: appOrigin, cookie: host.cookie, "content-type": "application/json" },
    body: JSON.stringify({ capacity: 1, removeParticipantIds: [confirmedEntry.id] }),
  });
  assert.equal((await expectJson(reduction, 200)).removedCount, 1);
  assert.equal((await readEvent(event, confirmed, referenceUrl)).status, 404);
  assert.equal((await readEvent(event, confirmed, photoUrl)).status, 404);

  // Model cancellation while the guest cancellation endpoint is still pending.
  await waitlistedEntry.update({ membershipStatus: "canceled", rsvpStatus: "none" });
  assert.equal((await readEvent(event, waitlisted, referenceUrl)).status, 404);
  assert.equal((await readEvent(event, waitlisted, photoUrl)).status, 404);
});
