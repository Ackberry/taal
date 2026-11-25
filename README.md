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

Use Node.js 24 or newer and install the Firebase CLI. Run `npm ci`, then start the Auth emulator in one terminal.

```sh
firebase emulators:start --only auth --project demo-taal
```

In a second terminal, start Next.js with the same demo project.

```sh
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099 \
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-taal \
npm run dev
```

Open `http://localhost:3000`. The emulator supplies a simulated Google sign-in and shows SMS verification codes in its terminal. With both processes running, run `npm run test:auth` to check session creation, access control, U.S.-only phone handling, and sign-out.

For live testing, copy `.env.example` to `.env.local` and fill in the Firebase Web app configuration. Authenticate the server with Application Default Credentials for the Firebase project or provide `FIREBASE_SERVICE_ACCOUNT_JSON` as a private server variable. Set `TAAL_APP_ORIGIN` to the origin users actually visit. Add the deployed domain to Firebase Authentication’s authorized domains before testing Google and real SMS. [Firebase Admin setup](https://firebase.google.com/docs/admin/setup) · [Firebase web phone sign-in](https://firebase.google.com/docs/auth/web/phone-auth)

## Auth interface

- `POST /api/session` accepts JSON with an `idToken` from Firebase sign-in. Success returns `204` and sets an HTTP-only session cookie. The browser sends the cookie on subsequent requests.
- `DELETE /api/session` clears the browser session and returns `204`.
- Both methods require the app’s origin. Error responses contain `code` and `message` fields. A request to `/account` without a valid session redirects to sign-in.
