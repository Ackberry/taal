# MVP architecture for event access

**Draft.** A verified guest redeems an event invite to become a member. The RSVP determines whether that member can see private details, read announcements, or request songs. Posting an announcement additionally requires an event-specific grant from the host. The server checks these conditions on each request. [Confirmed product rules](rules.md)

## Confirmed decisions

- Use Firebase Authentication on the existing Blaze plan. Require a verified Taal account for host actions, guest participation, and delegated event actions. Guests can sign in with Google or verify their phone by SMS.
- Use Cloud Firestore for event data, including invite redemption, membership, and RSVP transactions.
- Use one invite creation screen per event. It creates shared guest links or permission invites for a specific person. Multiple links can be active at once, each with its own expiration.

## Invite creation and redemption

The host selects **Guest** to create a shareable membership link. The screen disables all elevated permission controls when **Guest** is selected. For a permission invite, the host selects an existing verified Taal account using its exact sign-in email or phone number and chooses the permissions to delegate. **Publish announcements** and **Edit event details** are separate permission options. Both require a current confirmed RSVP, and recipients appear on the attendee list once confirmed.

The invite flow sends signed-out guests through Google sign-in or SMS verification and resumes redemption afterward. On redemption, the server verifies the Firebase session and checks the token and its expiration against server time. Redeeming either kind of link creates or returns event membership. A permission invite additionally requires the intended verified account and records the selected permissions for that event. Check these restrictions on the server as well as in the creation screen. Apply the same RSVP and waitlist rules to all invite recipients. Check the event block list for the verified account before creating membership or grants. Rate-limit redemption by event and account across links so changing the link cannot reset the limit. Blocked attempts generate no host notifications.

## Access by event state

Each guest row assumes a verified Firebase session. “Event page” means the RSVP and status view. The locked homepage card is available to anyone who can see the listing.

| Event relationship | Event page | Exact details and board | Request songs while open | Publish announcements | Edit event details |
| --- | --- | --- | --- | --- | --- |
| Guest without membership | — | — | — | — | — |
| Member without an RSVP | Yes | — | — | — | — |
| Waitlisted member | Yes | — | — | — | — |
| Confirmed member | Yes | Yes | Yes | With a posting grant | With an editing grant |
| Canceled or removed guest | — | — | — | — | — |
| Event host | Yes | Yes | Manages requests | Yes | Yes |

Exact details include the time, location, and private reference images. The server requires a current confirmed RSVP for guest access to private media and announcement history. Full tracklist access for a confirmed guest also requires the host's tracklist sharing setting to include them. Host-profile announcements follow the host profile's visibility rules. [Event and announcement rules](rules.md#private-events)

## Proposed data and authorization model

| Record | What it represents |
| --- | --- |
| Host account | A Firebase user ID with the ability to host, assigned through the owner's separate host invite flow. |
| Event | The owning host, locked-card listing fields, private details, capacity, and song request settings. The event has a stable URL for normal navigation and notifications. |
| Event invite | An event-scoped token with an expiration. A guest invite admits verified guests. A permission invite identifies the intended account and its selected permissions. |
| Event participant | One record per event and Firebase user ID. It holds membership status, current RSVP status, and the waitlist position for an active waitlisted RSVP. A canceled guest can rejoin by redeeming a live invite and submitting a new RSVP. A host-removed record stays on the event’s block list until the event host clears it there. |
| Event permission grant | A host-managed grant for one event, attendee account, and permission. The attendee needs a current confirmed RSVP to use a posting or editing grant. |
| Event announcement | The event, author, content, and publication time. Keep existing posts available to confirmed attendees after the author loses access. |
| Event audit entry | The event, acting account, action, and timestamp for an announcement publication or event edit. Retain the entry after the actor cancels. |

Redeeming a guest link again returns existing membership and preserves the RSVP and queue position. Redirect to the ordinary event URL after redemption. Keep the invite token out of ordinary URLs, notification content, and application logs.

Build listing, RSVP, and private-detail responses from explicit field sets. Check event ownership for host-only actions and the applicable grant for delegated actions. For guest actions, read current membership and RSVP state, plus the specific grant or setting required by the operation. Keep revocation-sensitive responses out of shared caches, and authorize private media requests when they arrive. Spotify search for an event follows the server-side event access checks. Song submission also checks whether the host has closed requests and whether the deadline has passed, using server time.

## RSVP and capacity changes

Use one transaction boundary per event for operations that change attendance. A new RSVP, a cancellation, a host add or removal, and a capacity edit all use the same capacity and waitlist logic. Assign a stable queue position when a guest joins the waitlist. The transaction checks current membership and active RSVP state, fills open spots in queue order, and confirms or waitlists the incoming RSVP. Removing the capacity limit confirms everyone waiting. A capacity decrease that needs removals saves the selected removals and the new limit together, or rejects the whole change.

Cancellation revokes access to the event and board, removes posting and editing grants, deletes the guest's requests, and removes their contributions to request counts. The guest can redeem a live shared invite and submit a fresh RSVP under the usual capacity and waitlist rules. Assign a new waitlist position if needed. Tracks already on Spotify stay on the playlist. [Deferred Spotify decision](https://github.com/Ackberry/taal/issues/1)

Save an audit entry alongside each announcement publication or event edit. Keep the published announcements, saved edits, and audit entries when the actor cancels. The same account can redeem its original permission invite again while it is live. Record the selected grants for the new attendance, and require a fresh confirmed RSVP before they can be used.

Host removal revokes access and grants and blocks the account for that event in the same transaction. If a confirmed spot opens, the next eligible guest moves up. Only the host can clear the block through the event’s block list. An unblocked account can redeem a live invite and submit a fresh RSVP. A guest link gives standard membership. A permission invite, including a still-live link issued before removal, records the selected grants for the intended account. Those grants become usable when the new RSVP is confirmed.

For manual additions and permission invite creation, use the Firebase Admin SDK on the server to look up an exact verified sign-in email or phone number. Normalize phone numbers to E.164 before lookup. Firebase looks up the primary authentication email and primary phone number. Keep the lookup limited to the event host, rate-limit attempts, and use the resulting Firebase user ID in the capacity transaction or as the permission invite’s intended recipient. [Firebase Admin SDK user lookup](https://firebase.google.com/docs/auth/admin/manage-users)

Serialize song requests, announcement publication, and delegated edits with changes to the RSVP and grants they depend on so an action ordered after revocation fails.

Record notification work alongside the state change and send it after commit, with retries keyed to the notification and recipient. For a published announcement, record which guests were confirmed and had contact email at publication. Use the latest saved contact email for delivery. Use the ordinary event URL and the limited email content specified in the rules. [Notification rules](rules.md#rsvp-guest-confirmation-and-event-updates)

## First acceptance checks

- A verified user without membership sees only the listing when opening the ordinary URL. Redeeming the invite twice establishes one membership and leaves any active RSVP untouched.
- Two links for one event can be redeemed while both are live. When one expires, the other still works, and a guest who already redeemed the expired link can use their existing membership through the ordinary event URL.
- Choosing **Guest** disables the permission controls. The server rejects a guest-link creation request that includes an elevated permission.
- The host can issue a permission invite after matching an existing verified account by exact sign-in email or phone. A verified account other than the intended recipient cannot redeem a permission invite. The intended recipient receives the selected permissions for that event.
- A host can manually confirm an existing verified Taal account found by exact sign-in email or phone when capacity allows. A lookup that only matches a notification contact address leaves the attendee list and available spots unchanged.
- With one remaining spot and two simultaneous RSVP submissions, one is confirmed and the other is waitlisted. When the confirmed guest cancels, the longest-waiting guest is promoted and can read prior announcements.
- A confirmed guest without a grant can read the board. Once granted permission, they can publish for that event. After revocation, a direct publish request fails even from a page opened before the revocation.
- A recipient with an editing grant follows the usual waitlist rules. Once confirmed, they appear on the attendee list and can edit event details. A later loss of confirmation immediately blocks editing.
- A guest who cancels can redeem a live guest link and RSVP again. If the event is full, the guest joins at the end of the existing waitlist.
- When a guest with posting or editing permission cancels, their grants are removed immediately and their published posts, edits, and audit entries are retained. Rejoining through the original live permission invite restores the selected permissions once a new RSVP is confirmed. A fresh RSVP alone leaves the guest with standard attendee access.
- After host removal, both shared and permission links fail for that account at that event. Repeated attempts are rate-limited across links and generate no host notification. Only the host can clear the block from the event’s block list.
- After the host clears a block, redeeming a live guest link gives standard guest access. Redeeming a still-live permission link issued before removal records its selected grants, which the intended account can use after a fresh RSVP is confirmed.
- After a cancellation or host removal, direct requests for private event details and board content fail. A guest's canceled song requests no longer count toward event totals, and tracks already on Spotify remain on the playlist.
- Announcement notifications go to eligible recipients as of publication. The email carries the ordinary event URL and omits private details, announcement text, and invite tokens.
