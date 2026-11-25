import assert from "node:assert/strict";
import test from "node:test";

const appOrigin = "http://localhost:3000";
const emulatorOrigin = "http://127.0.0.1:9099";

function account(cookie) {
  return fetch(`${appOrigin}/account`, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
}

function exchange(idToken, origin = appOrigin) {
  return fetch(`${appOrigin}/api/session`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
}

async function emulatorPost(action, body) {
  const response = await fetch(
    `${emulatorOrigin}/identitytoolkit.googleapis.com/v1/accounts:${action}?key=demo-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  assert.equal(response.status, 200, action);
  return response.json();
}

async function signInWithTestPhone(phoneNumber) {
  const { sessionInfo } = await emulatorPost("sendVerificationCode", { phoneNumber });
  const response = await fetch(`${emulatorOrigin}/emulator/v1/projects/demo-taal/verificationCodes`);
  assert.equal(response.status, 200);
  const { verificationCodes } = await response.json();
  const code = verificationCodes.find((entry) => entry.sessionInfo === sessionInfo)?.code;
  assert.match(code, /^[0-9]{6}$/);
  const { idToken } = await emulatorPost("signInWithPhoneNumber", { sessionInfo, code });
  return idToken;
}

test("protected pages deny missing and invalid sessions", async () => {
  for (const cookie of [undefined, "taal_session=invalid"]) {
    const response = await account(cookie);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/");
  }
});

test("session changes reject cross-origin requests and invalid credentials", async () => {
  const crossOrigin = "https://example.test";
  assert.equal((await exchange("invalid", crossOrigin)).status, 403);

  const logout = await fetch(`${appOrigin}/api/session`, {
    method: "DELETE",
    headers: { origin: crossOrigin },
  });
  assert.equal(logout.status, 403);
  assert.equal(logout.headers.get("set-cookie"), null);

  const invalid = await exchange("invalid");
  assert.equal(invalid.status, 401);
  assert.equal(invalid.headers.get("set-cookie"), null);
});

test("a valid Firebase token for a non-U.S. phone cannot create a session", async () => {
  const idToken = await signInWithTestPhone("+14165550107");
  const response = await exchange(idToken);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("a verified U.S. phone can create a session and sign out", async () => {
  const idToken = await signInWithTestPhone("+12025550122");
  const response = await exchange(idToken);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /^taal_session=.+;.*HttpOnly/i);
  assert.match(setCookie, /SameSite=lax/i);
  const cookie = setCookie.split(";")[0];
  const protectedPage = await account(cookie);
  assert.equal(protectedPage.status, 200);
  assert.match(protectedPage.headers.get("cache-control"), /no-store/);

  const logout = await fetch(`${appOrigin}/api/session`, {
    method: "DELETE",
    headers: { origin: appOrigin, cookie },
  });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get("set-cookie"), /^taal_session=;.*Max-Age=0/i);
});
