import console from "node:console";
import process from "node:process";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const [ownerUid, eventId, start, capacityArg] = process.argv.slice(2);
const projectId = "demo-taal";
const capacity = capacityArg === undefined ? null : Number(capacityArg);
const startDate = start === "tba" ? null : new Date(start);

if (!ownerUid || !eventId || eventId.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(eventId) ||
    (startDate && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(start ?? "") ||
      !(startDate.getTime() > Date.now()))) ||
    (capacity !== null && (!Number.isSafeInteger(capacity) || capacity < 1))) {
  console.error("Usage: npm run seed:test-event -- <host-uid> <event-id> <future-utc-timestamp|tba> [capacity]");
  process.exit(1);
}

// Keep this fixture on the local emulator, even when the shell has live Firebase credentials.
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const app = initializeApp({ projectId });

try {
  await getAuth(app).getUser(ownerUid);
  await getFirestore(app).collection("events").doc(eventId).create({
    ownerUid,
    name: "Taal test event",
    startAt: startDate ? Timestamp.fromDate(startDate) : null,
    capacity,
  });
  console.log(`http://localhost:3000/host/events/${eventId}/invites`);
} catch (error) {
  console.error("Couldn’t seed the test event. Check that the emulators are running, the host UID exists, and the event ID is unused.", error.code);
  process.exitCode = 1;
}
