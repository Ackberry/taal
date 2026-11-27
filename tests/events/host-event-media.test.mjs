import assert from "node:assert/strict";
import { Blob, Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import process from "node:process";
import test from "node:test";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
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
