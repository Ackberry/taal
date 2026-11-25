import { getApps, initializeApp } from "firebase/app";
import {
  browserPopupRedirectResolver,
  connectAuthEmulator,
  inMemoryPersistence,
  initializeAuth,
} from "firebase/auth";

export function getFirebaseBrowserAuth() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const emulatorUrl = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

  if (!projectId || (!emulatorUrl && (!apiKey || !authDomain || !appId))) {
    throw new Error("Missing Firebase Web configuration.");
  }

  if (emulatorUrl && (process.env.NODE_ENV === "production" || !projectId.startsWith("demo-"))) {
    throw new Error("The Auth emulator requires a local demo project.");
  }

  const app = getApps().find(({ name }) => name === "[DEFAULT]") ?? initializeApp(
    emulatorUrl ? { apiKey: "demo-key", projectId } : { apiKey, authDomain, projectId, appId },
  );
  const auth = initializeAuth(app, {
    persistence: inMemoryPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });

  if (emulatorUrl && !auth.emulatorConfig) {
    connectAuthEmulator(auth, emulatorUrl);
  }

  return auth;
}
