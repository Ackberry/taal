# MVP architecture for event access

**Draft.** A verified guest redeems an event invite to become a member. The RSVP determines whether that member can see private details, read announcements, or request songs. Posting an announcement additionally requires an event-specific grant from the host. The server checks these conditions on each request. [Confirmed product rules](rules.md)

## Confirmed decisions

- Use Firebase Authentication on the existing Blaze plan. Require a verified Taal account to browse event listings and host profiles, participate as a guest, or act as a host or delegate. Guests can sign in with Google or verify their phone by SMS.
- Use Cloud Firestore for event data, including invite redemption, membership, and RSVP transactions.
- Use one invite creation screen for guest links, with an option to customize the URL path. Multiple links can be active at once, each with its own expiration and a host-only **Disable** action. The host grants elevated permissions individually after RSVP confirmation.

## Invite creation and redemption

Create each guest link as its own Firestore invite record. The host can set a custom URL path segment, such as `special-party`. Every link uses the same guest experience and standard guest access. The final URL format is open. A random suffix would preserve the unguessable token requirement and let the host customize the readable part of the path.

The invite flow sends signed-out guests through Google sign-in or SMS verification and resumes redemption afterward. The server verifies the Firebase session and checks the token, disable status, and expiration against server time. Check the event block list and the invite in the same transaction that creates or returns membership. Apply the same RSVP and waitlist rules to all invite recipients. Rate-limit redemption by event and account across links so changing the link cannot reset the limit. Blocked attempts generate no host notifications.

Store the disable timestamp on the individual invite record. A redemption ordered after disabling fails. Existing memberships, RSVPs, grants, and other links stay active under their usual rules.

## Editing guest permissions

The host can open **Edit permissions** on a confirmed attendee’s row and select **Publish announcements**, **Edit event details**, or both. In one server transaction, check event ownership and the guest’s current confirmed RSVP, update the guest’s grants, and record who changed which permissions. Changes apply to subsequent requests, including requests from a page the guest already had open.

## Access by event state

Each guest row assumes a verified Firebase session. “Event page” means the RSVP and status view. The locked homepage card is available only to signed-in accounts that can see the listing. Serve the signed-out homepage without loading or embedding event or host data. Verify the Firebase session before serving listings, event previews, host profiles, or their protected media. Additional signed-out homepage content is deferred. [GitHub issue #7](https://github.com/Ackberry/taal/issues/7)

| Event relationship | Event page | Exact details and board | Request songs while open | Publish announcements | Edit event details |
| --- | --- | --- | --- | --- | --- |
| Guest without membership | — | — | — | — | — |
| Member without an RSVP | Yes | — | — | — | — |
| Waitlisted member | Yes | — | — | — | — |
| Confirmed member | Yes | Yes | Yes | With a posting grant | With an editing grant |
| Canceled or removed guest | — | — | — | — | — |
| Event host | Yes | Yes | Manages requests | Yes | Yes |

Exact details include the time, location, and private reference images. The server requires a current confirmed RSVP for guest access to private media and announcement history. Full tracklist access for a confirmed guest also requires the host's tracklist sharing setting to include them. Host-profile announcements require a verified session and use the host profile's visibility rules. [Event and announcement rules](rules.md#private-events)

## Proposed data and authorization model

| Record | What it represents |
| --- | --- |
| Host account | A Firebase user ID with the ability to host, assigned through the owner's separate host invite flow. |
| Event | The owning host, locked-card listing fields, private details, capacity, and song request settings. The event has a stable URL for normal navigation and notifications. |
| Event invite | An event-scoped token with an expiration and an optional disable timestamp. Every link admits verified guests under the same membership and RSVP rules. |
| Event participant | One record per event and Firebase user ID. It holds membership status, current RSVP status, and the waitlist position for an active waitlisted RSVP. A canceled guest can rejoin by redeeming a live invite and submitting a new RSVP. A host-removed record stays on the event’s block list until the event host clears it there. |
| Event permission grant | A host-managed grant for one event, attendee account, and permission. The attendee needs a current confirmed RSVP to use a posting or editing grant. |
| Event announcement | The event, author, content, and publication time. Keep existing posts available to confirmed attendees after the author loses access. |
| Event audit entry | The event, acting account, action, and timestamp for an announcement publication, event edit, or guest permission change. Retain the entry after the actor cancels. |

Redeeming a guest link again returns existing membership and preserves the RSVP and queue position. Redirect to the ordinary event URL after redemption. Keep the invite token out of ordinary URLs, notification content, and application logs.

Build listing, RSVP, and private-detail responses from explicit field sets. Check event ownership for host-only actions and the applicable grant for delegated actions. For guest actions, read current membership and RSVP state, plus the specific grant or setting required by the operation. Keep revocation-sensitive responses out of shared caches, and authorize private media requests when they arrive. Spotify search for an event follows the server-side event access checks. Song submission also checks whether the host has closed requests and whether the deadline has passed, using server time.

## RSVP and capacity changes

Use one transaction boundary per event for operations that change attendance. A new RSVP, a cancellation, a host add or removal, and a capacity edit all use the same capacity and waitlist logic. Assign a stable queue position when a guest joins the waitlist. The transaction checks current membership and active RSVP state, fills open spots in queue order, and confirms or waitlists the incoming RSVP. Removing the capacity limit confirms everyone waiting. A capacity decrease that needs removals saves the selected removals and the new limit together, or rejects the whole change.

Cancellation revokes access to the event and board, removes posting and editing grants, deletes the guest's requests, and removes their contributions to request counts. The guest can redeem a live shared invite and submit a fresh RSVP under the usual capacity and waitlist rules. Assign a new waitlist position if needed. Tracks already on Spotify stay on the playlist. [Deferred Spotify decision](https://github.com/Ackberry/taal/issues/1)

Save an audit entry alongside each announcement publication or event edit. Keep the published announcements, saved edits, and audit entries when the actor cancels. If the guest returns, the host can grant permissions again after a new RSVP is confirmed.

Host removal revokes access and grants and blocks the account for that event in the same transaction. If a confirmed spot opens, the next eligible guest moves up. Only the host can clear the block through the event’s block list. An unblocked account can redeem a live invite and submit a fresh RSVP. The guest rejoins with standard membership. The host can grant permissions again after a new RSVP is confirmed.

For manual additions, use the Firebase Admin SDK on the server to look up an exact verified sign-in email or phone number. Normalize phone numbers to E.164 before lookup. Firebase looks up the primary authentication email and primary phone number. Keep the lookup limited to the event host, rate-limit attempts, and use the resulting Firebase user ID in the capacity transaction. [Firebase Admin SDK user lookup](https://firebase.google.com/docs/auth/admin/manage-users)

Serialize song requests, announcement publication, and delegated edits with changes to the RSVP and grants they depend on so an action ordered after revocation fails.

Record notification work alongside the state change and send it after commit, with retries keyed to the notification and recipient. For a published announcement, record which guests were confirmed and had contact email at publication. Use the latest saved contact email for delivery. Use the ordinary event URL and the limited email content specified in the rules. [Notification rules](rules.md#rsvp-guest-confirmation-and-event-updates)

## First acceptance checks

- A signed-out visitor sees sign-in and account creation. Direct requests for event listings or host profiles return no protected content.
- A verified user without membership sees only the listing when opening the ordinary URL. Redeeming the invite twice establishes one membership and leaves any active RSVP untouched.
- Two links for one event can be redeemed while both are live. When one expires, the other still works, and a guest who already redeemed the expired link can use their existing membership through the ordinary event URL.
- After the host disables a link, it cannot be redeemed even before expiration. Other live links still work, and prior redemptions retain their membership, RSVP status, and grants.
- A host can create multiple guest links with custom URL paths for one event. Each link opens the standard guest invite flow and follows the same RSVP and waitlist rules.
- A host can manually confirm an existing verified Taal account found by exact sign-in email or phone when capacity allows. A lookup that only matches a notification contact address leaves the attendee list and available spots unchanged.
- With one remaining spot and two simultaneous RSVP submissions, one is confirmed and the other is waitlisted. When the confirmed guest cancels, the longest-waiting guest is promoted and can read prior announcements.
- A confirmed guest without a grant can read the board. Once granted permission, they can publish for that event. After revocation, a direct publish request fails even from a page opened before the revocation.
- A host can add editing permission and remove posting permission for the same guest without changing their RSVP. After the change, the guest can edit if confirmed, and a direct publish request using the old page fails.
- The host can grant editing permission to a confirmed attendee. Later loss of confirmation immediately blocks editing.
- A guest who cancels can redeem a live guest link and RSVP again. If the event is full, the guest joins at the end of the existing waitlist.
- When a guest with posting or editing permission cancels, their grants are removed immediately and their published posts, edits, and audit entries are retained. The guest returns with standard attendee access. The host can grant extra permissions again after confirmation.
- After host removal, event invite links fail for that account at that event. Repeated attempts are rate-limited across links and generate no host notification. Only the host can clear the block from the event’s block list.
- After the host clears a block, the guest can redeem a live link and RSVP again with standard guest access.
- After a cancellation or host removal, direct requests for private event details and board content fail. A guest's canceled song requests no longer count toward event totals, and tracks already on Spotify remain on the playlist.
- Announcement notifications go to eligible recipients as of publication. The email carries the ordinary event URL and omits private details, announcement text, and invite tokens.
