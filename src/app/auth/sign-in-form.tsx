"use client";

import { FirebaseError } from "firebase/app";
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithPopup,
  type ConfirmationResult,
} from "firebase/auth";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BrowserSessionError, startBrowserSession } from "@/lib/auth/browser-session";
import { normalizeUsPhoneNumber } from "@/lib/auth/phone";
import { getFirebaseBrowserAuth } from "@/lib/firebase/browser";

const firebaseMessages: Record<string, string> = {
  "auth/invalid-verification-code": "That code doesn’t match. Check it and try again.",
  "auth/code-expired": "That code expired. Request a new one.",
  "auth/popup-blocked": "Allow pop-ups in your browser to continue with Google.",
  "auth/popup-closed-by-user": "The Google sign-in window closed. Try again when you’re ready.",
  "auth/too-many-requests": "There have been too many attempts. Try again later.",
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof BrowserSessionError) return error.message;
  if (error instanceof FirebaseError) return firebaseMessages[error.code] ?? fallback;
  return fallback;
}

export default function SignInForm({ returnPath = "/account" }: { returnPath?: string }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [pending, setPending] = useState<"google" | "sms" | "verify" | null>(null);
  const [error, setError] = useState("");
  const phoneInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const captchaContainer = useRef<HTMLDivElement>(null);
  const returnFocusToPhone = useRef(false);
  const busy = pending !== null;

  useEffect(() => {
    if (confirmation) {
      codeInput.current?.focus();
    } else if (returnFocusToPhone.current) {
      phoneInput.current?.focus();
      returnFocusToPhone.current = false;
    }
  }, [confirmation]);

  async function signInWithGoogle() {
    setError("");
    setPending("google");
    try {
      const credential = await signInWithPopup(getFirebaseBrowserAuth(), new GoogleAuthProvider());
      await startBrowserSession(credential);
      window.location.replace(returnPath);
    } catch (error) {
      setError(getErrorMessage(error, "We couldn’t sign you in with Google. Try again."));
      setPending(null);
    }
  }

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const normalized = normalizeUsPhoneNumber(phone);
    if (!normalized) {
      setError("Enter a valid U.S. phone number.");
      return;
    }

    let verifier: RecaptchaVerifier | undefined;
    setPending("sms");
    try {
      const auth = getFirebaseBrowserAuth();
      if (!captchaContainer.current) throw new Error("Missing reCAPTCHA container.");

      verifier = new RecaptchaVerifier(auth, captchaContainer.current, { size: "invisible" });
      setConfirmation(await signInWithPhoneNumber(auth, normalized, verifier));
    } catch (error) {
      setError(getErrorMessage(error, "We couldn’t send a text. Check your number and try again."));
    } finally {
      verifier?.clear();
      setPending(null);
    }
  }

  function resetCode() {
    returnFocusToPhone.current = true;
    setConfirmation(null);
    setCode("");
    setError("");
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmation) return;

    setError("");
    setPending("verify");
    try {
      const credential = await confirmation.confirm(code);
      await startBrowserSession(credential);
      window.location.replace(returnPath);
    } catch (error) {
      if (error instanceof BrowserSessionError) resetCode();
      setError(getErrorMessage(error, "We couldn’t verify the code. Try again."));
      setPending(null);
    }
  }

  return (
    <div className="sign-in-options">
      <button className="button button-secondary" type="button" disabled={busy} onClick={signInWithGoogle}>
        {pending === "google" ? "Opening Google…" : "Continue with Google"}
      </button>

      <div className="option-divider">or</div>

      {confirmation ? (
        <form className="stack" onSubmit={verifyCode}>
          <p role="status">Code sent. Enter the six-digit code from your text.</p>
          <label htmlFor="verification-code">Verification code</label>
          <input
            id="verification-code"
            ref={codeInput}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
          <button className="button" type="submit" disabled={busy}>
            {pending === "verify" ? "Verifying…" : "Verify code"}
          </button>
          <button className="text-button" type="button" disabled={busy} onClick={resetCode}>
            Use a different number or request a new code
          </button>
        </form>
      ) : (
        <form className="stack" onSubmit={sendCode}>
          <label htmlFor="phone-number">U.S. phone number</label>
          <input
            id="phone-number"
            ref={phoneInput}
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel"
            maxLength={40}
            required
          />
          <button className="button" type="submit" disabled={busy}>
            {pending === "sms" ? "Sending…" : "Get a code by text"}
          </button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div ref={captchaContainer} />
    </div>
  );
}
