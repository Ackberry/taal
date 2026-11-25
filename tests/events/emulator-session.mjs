import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { URLSearchParams } from "node:url";

export const appOrigin = "http://localhost:3000";
const authOrigin = "http://127.0.0.1:9099";

export async function signIn() {
  const response = await fetch(`${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestUri: appOrigin,
      postBody: new URLSearchParams({
        providerId: "google.com",
        id_token: JSON.stringify({ sub: randomUUID(), email: `${randomUUID()}@example.test`, email_verified: true }),
      }).toString(),
      returnSecureToken: true,
    }),
  });
  assert.equal(response.status, 200);
  const { idToken, localId: uid } = await response.json();
  const session = await fetch(`${appOrigin}/api/session`, {
    method: "POST",
    headers: { origin: appOrigin, "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  assert.equal(session.status, 204);
  return { uid, cookie: session.headers.get("set-cookie").split(";")[0], idToken };
}
