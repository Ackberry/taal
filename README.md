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

## Create a private event locally

With Next.js and both Firebase emulators running, sign in and find your test account’s UID in the local [Authentication emulator](http://127.0.0.1:4000/auth). Approve it with the emulator-only command.

```sh
npm run approve:test-host -- <host-uid>
```

Refresh your account page, open **Manage your events**, and create an event. Enter a date and time in your browser’s time zone or mark it TBA. Leave capacity blank for unlimited RSVPs. The event appears in **Your events**, with a link to **Manage guest invites**. Run `npm run test:host-events` to check approval, event ownership, retries, invite redemption, and RSVP.

For a live pilot, the project owner provisions approval using trusted Firebase administration. Create a document named with the approved account’s Firebase UID in the `hostAccounts` Firestore collection. The document’s presence grants access to the host event list and creation. The application derives event ownership from that account’s verified session.

## Host event interface

The host event page is `/host/events`. It redirects signed-out visitors to sign-in and returns 404 to verified accounts without host approval. It lists only events owned by the signed-in host.

`POST /api/host/events` requires a verified, approved host session, the app’s origin, and a JSON body.

| Field | Input |
| --- | --- |
| `requestId` | UUID v4 generated once per submission. Reuse it when retrying the same submission. |
| `name` | Nonblank event name up to 120 characters after trimming. |
| `startAt` | A future UTC ISO timestamp with milliseconds, or `null` for TBA. |
| `capacity` | Positive safe integer, `null`, or omitted for unlimited RSVPs. |

Creation returns `201` and `{ eventId, name, startAt, capacity }`. Retrying with the same `requestId` and event details returns `200` for the existing event. Use `/host/events/{eventId}/invites` to manage its guest links.

Errors contain `{ code, message }`, with an optional `fields` map keyed by `name`, `startAt`, and `capacity` for field validation. Expect `400` for invalid input, `401` for a missing or invalid session, `403` for the wrong origin or missing host approval, `409` for reusing a request ID with different details, `415` for a non-JSON request, and `503` when the service is unavailable. Responses use `Cache-Control: no-store`.

## Host event details interface

From `/host/events`, use **Edit details** to open `/host/events/{eventId}/details`. The editor uses `PATCH /api/host/events/{eventId}/details`. Both require the event owner’s verified session. The write also requires the app’s origin and JSON.

Send only the fields that changed. Omitted fields are preserved. Use `null` or blank text to clear an optional field. Text is trimmed and checked against these limits.

| Field | Input |
| --- | --- |
| `name` | Required when supplied. Nonblank text up to 120 characters. |
| `location` | Venue or address, up to 300 characters. |
| `description` | Up to 4,000 characters. |
| `lastEntryTime` | Up to 100 characters. Include the time zone in the text. |
| `directions` | Up to 1,000 characters. |
| `dressCode`, `idRequirements`, `plusOnePolicy`, `entrance`, `dropOff`, `stepFreeAccess`, `contact` | Up to 500 characters each. |

Success returns `200` with `{ name, ...privateDetails }`, including only the optional fields currently set. Each change saves an `event_details_updated` audit entry in `events/{eventId}/auditEntries` with the acting account, changed field names, and server timestamp, in the same transaction. An unchanged patch creates no audit entry.

Errors return `{ code, message }` with an optional `fields` map. Expect `400` for invalid JSON, unsupported fields, or invalid values, `401` for a missing or invalid session, `403` for the wrong origin, `404` for a missing event or non-owner, `415` for a non-JSON request, and `503` when editing is unavailable. Responses use `Cache-Control: no-store`.

With Next.js and both Firebase emulators running, run `npm run test:event-details` to verify validation, editor access, guest visibility, and auditing.

## Host event schedule interface

From `/host/events`, use **Edit start** to open `/host/events/{eventId}/schedule`. The editor shows the start in the browser’s time zone.

`PATCH /api/host/events/{eventId}/schedule` requires the event owner’s verified session, the app’s origin, and a JSON body with a single field, `startAt`. Use a future UTC ISO timestamp with milliseconds. The endpoint can announce a start for a TBA event or move a scheduled start.

Success returns `200` and `{ startAt }`. The change moves expirations for live guest invites that follow the event start. Manual, disabled, and already expired invites keep their saved expirations. The event, affected invites, and an `event_details_updated` audit entry with `changedFields: ["startAt"]` are saved together. Repeating the current start succeeds without writing another audit entry.

Errors return `{ code, message }` with an optional `fields.startAt` message. Expect `400` for invalid input, including a `null` start or a changed start at or before server time, `401` for a missing or invalid session, `403` for the wrong origin, `404` for a missing event or non-owner, `415` for a non-JSON request, and `503` when scheduling is unavailable. Responses use `Cache-Control: no-store`.

With Next.js and both Firebase emulators running, run `npm run test:event-schedule` to verify scheduling and invite expiration behavior.

## Seed an event for invite tests

With the app and both emulators running, sign in as the test host. Find that account’s UID in the local [Authentication emulator](http://127.0.0.1:4000/auth). Seed a private event using the UID, a lowercase event ID, a future UTC start timestamp or `tba`, and an optional RSVP capacity.

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

## Guest invite redemption interface

`POST /api/invites/redeem` requires a verified session, the app’s origin, and JSON `{ invite }`. Send the full path segment after `/invite/`, including the readable slug and token. A successful response returns `200` and `{ eventId }`. Redeeming another link for the same event reuses an active membership and preserves its RSVP state.

Errors contain `{ code, message }`. Expect `400` for a missing invite value, `401` for a missing or invalid session, `403` for the wrong origin, `404` for an unavailable invite, `415` for a non-JSON request, and `503` when redemption is unavailable. After 10 attempts against matching links in a 10-minute window for the same event and account, further attempts return `429` with a `Retry-After` header in seconds. Attempts by a blocked account count toward the limit.

The browser entry point is `GET /invite/{slug}-{token}`. It checks availability on the server before showing sign-in. An invalid, expired, or disabled link returns the default 404. After Google or SMS verification, the browser reloads that same invite and sends the redemption request. On success it navigates to `/events/{eventId}`.

## Event view interface

`GET /events/{eventId}` asks signed-out guests to sign in and returns them to the same URL. A verified account without access receives the default 404. Opening the event URL does not create membership.

`GET /api/events/{eventId}` requires a verified session. Active guests receive `{ name, role: "guest", rsvpStatus }`, with RSVP status `none`, `waitlisted`, or `confirmed`. Confirmed guests also receive `details` with `startAt` and the optional fields listed under the host event details interface. The event owner receives `{ name, role: "host", details }` with the same details shape. The start time is an ISO timestamp or null for TBA. Unset optional fields are omitted from the API response. The page displays TBA when `location` is unset. Both the page and endpoint use the current membership and RSVP status to determine which fields to return.

Errors contain `{ code, message }`. Expect `401` for a missing or invalid session, `404` for a missing event or an account without access, and `503` when event data is unavailable.

## RSVP interface

`POST /api/events/{eventId}/rsvp` requires a verified session and the app’s origin. Send no request body. The server uses the event ID and the signed-in account’s membership to decide the outcome. A successful response returns `200` and `{ rsvpStatus }` with `confirmed` or `waitlisted`. Repeat submissions return the guest’s current saved status. Fetch the event view for details available to that guest.

Errors contain `{ code, message }`. Expect `401` for a missing or invalid session, `403` for the wrong origin, `404` for an unavailable event or ineligible account, and `503` if RSVP is unavailable. Responses use `Cache-Control: no-store`.

With Next.js and both emulators running, run `npm run test:rsvp` to verify access, capacity, duplicate submissions, and waitlist order.
