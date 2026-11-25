import "server-only";

import { applicationDefault, cert, getApps, initializeApp, type AppOptions } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function getAppOptions(projectId: string): AppOptions {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    if (process.env.NODE_ENV === "production" || !projectId.startsWith("demo-")) {
      throw new Error("The Auth emulator requires a local demo project.");
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

export function getFirebaseAdminAuth() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("The Firebase project ID is required.");
  }

  const app = getApps().find(({ name }) => name === "[DEFAULT]") ??
    initializeApp(getAppOptions(projectId));
  return getAuth(app);
}
