import "server-only";

import { randomUUID } from "node:crypto";
import type { App } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

export const eventImageContentType = "image/webp";

export class EventImageStorage {
  private readonly bucket;

  constructor(app: App) {
    if (!app.options.storageBucket) throw new Error("Configure a private Firebase Storage bucket for event images.");
    this.bucket = getStorage(app).bucket();
  }

  async save(eventId: string, image: Buffer) {
    const id = randomUUID();
    const objectPath = `events/${eventId}/${id}.webp`;
    await this.bucket.file(objectPath).save(image, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: eventImageContentType, cacheControl: "private, no-store" },
    });
    return { id, objectPath };
  }

  async download(objectPath: string) {
    const [image] = await this.bucket.file(objectPath).download();
    return image;
  }

  async remove(objectPath: string) {
    await this.bucket.file(objectPath).delete({ ignoreNotFound: true });
  }
}
