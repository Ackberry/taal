import console from "node:console";
import process from "node:process";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const [uid] = process.argv.slice(2);
if (!uid) {
  console.error("Usage: npm run approve:test-host -- <host-uid>");
  process.exit(1);
}

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const app = initializeApp({ projectId: "demo-taal" });

try {
  await getAuth(app).getUser(uid);
  await getFirestore(app).collection("hostAccounts").doc(uid).set({ approvedAt: FieldValue.serverTimestamp() });
  console.log("Test host approved. Open http://localhost:3000/host/events.");
} catch (error) {
  console.error("Couldn’t approve the test host. Check that both emulators are running and the user exists.", error.code);
  process.exitCode = 1;
}
