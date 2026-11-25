# Taal

Taal is a collaborative Spotify playlist planner for private events. Guests RSVP and request songs, and hosts review requests before adding tracks to the event playlist.

**Status:** MVP development.

## Project docs

| Document | Purpose |
| --- | --- |
| [rules.md](rules.md) | Confirmed product rules for invites, RSVPs, waitlists, notifications, song requests, and Spotify playlists. |
| [mvp-architecture.md](mvp-architecture.md) | Draft architecture for event invitations, attendance, and announcement permissions. |
| [AGENTS.md](AGENTS.md) | Workflow for contributors and agents, including issue, branch, and commit conventions and direct pushes to `main`. |

Open decisions and follow-up work are tracked in [GitHub Issues](https://github.com/Ackberry/taal/issues).

## Run the sign-in flow locally

Use Node.js 24 or newer, Java 21 or newer, and the Firebase CLI. Run `npm ci`, then start the Auth and Firestore emulators in one terminal.

```sh
firebase emulators:start --only auth,firestore --project demo-taal
```

In a second terminal, start Next.js with the same demo project.

```sh
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099 \
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-taal \
npm run dev
```

Open `http://localhost:3000`. The emulator supplies a simulated Google sign-in and shows SMS verification codes in its terminal. With both processes running, run `npm run test:auth` to check session creation, access control, U.S.-only phone handling, and per-session sign-out.

For live testing, copy `.env.example` to `.env.local` and fill in the Firebase Web app configuration. Authenticate the server with Application Default Credentials for the Firebase project or provide `FIREBASE_SERVICE_ACCOUNT_JSON` as a private server variable. Set `TAAL_APP_ORIGIN` to the origin users actually visit. Initialize the default Firestore database in production mode and apply the server-only rules in `firestore.rules`. Give the server credentials access to Firebase Auth and Firestore. Enable Firestore TTL on `authSessions.expiresAt` to clean up expired session records. Add the deployed domain to Firebase Authentication’s authorized domains before testing Google and real SMS. [Firebase Admin setup](https://firebase.google.com/docs/admin/setup) · [Firestore TTL](https://firebase.google.com/docs/firestore/ttl) · [Firebase web phone sign-in](https://firebase.google.com/docs/auth/web/phone-auth)

## Auth interface

- `POST /api/session` accepts JSON with an `idToken` from Firebase sign-in. Success returns `204` and sets an HTTP-only session cookie. On protected requests the server verifies the Firebase credential and checks for an active Firestore session record.
- `DELETE /api/session` deletes the current session record and clears the cookie. Success returns `204`. A temporary revocation failure returns `503` so the browser can retry. Other sessions for the same account stay signed in.
- Both methods require the app’s origin. Error responses contain `code` and `message` fields. A request to `/account` without a valid session redirects to sign-in.

## Run the host invite flow locally

With the app and both emulators running, sign in as the approved test host. Find that account’s UID in the local [Authentication emulator](http://127.0.0.1:4000/auth). Seed a private event using the UID, a lowercase event ID, a future UTC start timestamp or `tba`, and an optional RSVP capacity.

```sh
npm run seed:test-event -- <host-uid> demo-event 2030-09-22T00:00:00Z 30
npm run seed:test-event -- <host-uid> demo-tba tba
```

Open the printed host page while signed in as that account. Generate multiple links, copy one, and disable another. The seed command uses only the local emulators and requires an unused event ID. Run `npm run test:invites` to verify ownership, expiration, and independent disable behavior. Guest redemption is tracked in [issue #12](https://github.com/Ackberry/taal/issues/12).

## Host invite interface

The host page is `/host/events/{eventId}/invites`. It redirects signed-out visitors to sign-in and returns 404 to signed-in non-owners. Both writes to `/api/host/events/{eventId}/invites` require a verified session, the app’s origin, and JSON.

| Method | Input | Success |
| --- | --- | --- |
| `POST` | `{ slug, expiresAt? }`. Use at most 80 lowercase letters, digits, and hyphens, with no leading, trailing, or consecutive hyphens. Omit `expiresAt` to follow the event start. For manual expiration, send a future UTC timestamp in ISO format with milliseconds. | `201` and the new invite. |
| `PATCH` | `{ token }` | `200` and the disabled invite. Retrying preserves the original disable timestamp. |

Successful writes return `{ token, slug, expiresAt, expirationMode, disabledAt }`. Timestamps are ISO strings and `disabledAt` is null for links the host has yet to disable. The expiration mode is `event-start` or `manual`. The share path is `/invite/{slug}-{token}`. The last 43 characters are the URL-safe token, which indexes a Firestore record containing the event ID and the exact slug. All records represent standard guest access.

Errors return `{ code, message }`. Expect `400` for invalid input, missing expiration on a TBA event, or a past expiration, `401` for a missing or invalid session, `403` for the wrong origin, `404` for an inaccessible event or invite, `415` for a non-JSON request, and `503` when the service is unavailable.
