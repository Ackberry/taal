import "server-only";

import { applicationDefault, cert, getApps, initializeApp, type AppOptions } from "firebase-admin/app";

function getAppOptions(projectId: string): AppOptions {
  const authEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (authEmulator || firestoreEmulator) {
    if (!authEmulator || !firestoreEmulator ||
        process.env.NODE_ENV === "production" || !projectId.startsWith("demo-")) {
      throw new Error("Use both Firebase emulators with a local demo project.");
    }

    return { projectId };
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    return { projectId, credential: applicationDefault() };
  }

  const serviceAccount = JSON.parse(serviceAccountJson);
  if (serviceAccount?.project_id !== projectId) {
    throw new Error("Firebase credentials must match the configured project.");
  }

  return { projectId, credential: cert(serviceAccount) };
}

export function getFirebaseAdminApp() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("The Firebase project ID is required.");
  }

  return getApps().find(({ name }) => name === "[DEFAULT]") ??
    initializeApp(getAppOptions(projectId));
}
