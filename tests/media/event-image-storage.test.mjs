import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import test from "node:test";
import { initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { initializeApp as initializeClient } from "firebase/app";
import { connectStorageEmulator, getBytes, getStorage as getClientStorage, ref, uploadBytes } from "firebase/storage";
import sharp from "sharp";
import { EventImageStorage } from "../../src/lib/firebase/event-image-storage.ts";

process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
process.env.STORAGE_EMULATOR_HOST = "http://127.0.0.1:9199";
const projectId = "demo-taal";
const storageBucket = `${projectId}.appspot.com`;

test("private event images can be managed through Firebase Admin alone", async (t) => {
  const app = initializeApp({ projectId, storageBucket });
  const storage = new EventImageStorage(app);
  const image = await sharp({ create: { width: 20, height: 10, channels: 3, background: "#b0cafe" } }).webp().toBuffer();
  const eventId = `test-${randomUUID()}`;
  const first = await storage.save(eventId, image);
  t.after(() => storage.remove(first.objectPath));
  const second = await storage.save(eventId, image);
  t.after(() => storage.remove(second.objectPath));
  assert.notEqual(first.id, second.id);
  assert.equal(first.objectPath, `events/${eventId}/${first.id}.webp`);
  assert.deepEqual(await storage.download(first.objectPath), image);

  const [metadata] = await getStorage(app).bucket().file(first.objectPath).getMetadata();
  assert.equal(metadata.contentType, "image/webp");
  assert.equal(metadata.cacheControl, "private, no-store");
  assert.equal(metadata.metadata?.firebaseStorageDownloadTokens, undefined);

  const client = getClientStorage(initializeClient({ projectId, storageBucket, apiKey: "demo-key" }));
  connectStorageEmulator(client, "127.0.0.1", 9199, { mockUserToken: { sub: "test-guest" } });
  const object = ref(client, first.objectPath);
  await assert.rejects(getBytes(object), { code: "storage/unauthorized" });
  await assert.rejects(uploadBytes(object, image, { contentType: "image/webp" }), { code: "storage/unauthorized" });
  const direct = await fetch(`http://127.0.0.1:9199/v0/b/${storageBucket}/o/${encodeURIComponent(first.objectPath)}?alt=media`);
  assert.equal(direct.status, 403);

  await storage.remove(first.objectPath);
  await storage.remove(first.objectPath);
  await assert.rejects(storage.download(first.objectPath), { code: 404 });
  assert.deepEqual(await storage.download(second.objectPath), image);
});
