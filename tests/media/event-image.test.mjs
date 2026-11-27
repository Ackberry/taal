import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import sharp from "sharp";
import { eventImageMaxBytes, prepareEventImage } from "../../src/lib/events/event-image.ts";

const create = { width: 40, height: 20, channels: 3, background: "#b0cafe" };

test("JPEG, PNG, and WebP uploads are rewritten as still WebP images", async () => {
  for (const format of ["jpeg", "png", "webp"]) {
    const input = await sharp({ create }).toFormat(format).toBuffer();
    const output = await sharp(await prepareEventImage(input)).metadata();
    assert.equal(output.format, "webp");
    assert.equal(output.width, create.width);
    assert.equal(output.height, create.height);
  }
});

test("rewriting applies the camera orientation, strips metadata, and limits saved dimensions", async () => {
  const input = await sharp({ create: { ...create, width: 3000, height: 1500 } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  assert.equal((await sharp(input).metadata()).orientation, 6);

  const output = await sharp(await prepareEventImage(input)).metadata();
  assert.equal(output.width, 1200);
  assert.equal(output.height, 2400);
  assert.equal(output.exif, undefined);
  assert.equal(output.orientation, undefined);
});

test("unsupported, malformed, animated, and over-limit uploads are rejected", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
  await assert.rejects(prepareEventImage(svg), { code: "unsupported_image" });
  await assert.rejects(prepareEventImage(Buffer.from([0xff, 0xd8, 0xff])), { code: "invalid_image" });
  assert.equal(eventImageMaxBytes, 3 * 1024 * 1024);
  await assert.rejects(prepareEventImage(Buffer.alloc(eventImageMaxBytes + 1)), {
    code: "image_too_large",
    message: "Choose an image no larger than 3 MB.",
  });

  const oversized = await sharp({ create: { ...create, width: 5000, height: 5000 } }).jpeg().toBuffer();
  await assert.rejects(prepareEventImage(oversized), { code: "image_too_large" });

  const frames = await Promise.all(["#fff", "#000"].map((background) =>
    sharp({ create: { ...create, background } }).png().toBuffer(),
  ));
  const animation = await sharp(frames, { join: { animated: true } }).webp().toBuffer();
  await assert.rejects(prepareEventImage(animation), { code: "unsupported_image" });
});
