# MVP architecture for event access

**Draft.** A verified guest redeems an event invite to become a member. The RSVP determines whether that member can see private details, read announcements, or request songs. Posting an announcement additionally requires an event-specific grant from the host. The server checks these conditions on each request. [Confirmed product rules](rules.md)

## Confirmed decisions

- Use Firebase Authentication on the existing Blaze plan. Require a verified Taal account to browse event listings and host profiles, participate as a guest, or act as a host or delegate. Guests can sign in with Google or verify their phone by SMS.
- Use Cloud Firestore for event data, including invite redemption, membership, and RSVP transactions.
- Use Brevo’s free transactional email plan for confirmation, event update, and announcement emails. [Brevo free-plan limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan)
- Use one invite creation screen for guest links, with a host-chosen readable path and an automatically generated random suffix. Multiple links can be active at once, each with its own expiration and a host-only **Disable** action. The host grants elevated permissions individually after RSVP confirmation.

## Invite creation and redemption

Create each guest link as its own Firestore invite record. Let the host enter a readable path such as `special-party` and append a cryptographically random, URL-safe token as a suffix. Show the complete URL for copying. Resolve the invite by the token and match the readable path against the invite record before redemption. Every link uses the same guest experience and standard guest access.

Before showing sign-in, make a read-only server check of the invite token, disable status, and expiration. Return the unavailable page for an invalid, expired, or disabled link. The check exposes no event data. For a live link, send signed-out guests through Google sign-in or SMS verification and resume redemption afterward. The server verifies the Firebase session and checks the token, disable status, and expiration against server time. Check the event block list and the invite in the same transaction that creates or returns membership. Apply the same RSVP and waitlist rules to all invite recipients. Rate-limit redemption by event and account across links so changing the link cannot reset the limit. Blocked attempts generate no host notifications.

Prefill each new invite’s expiration when the event has a start time. When the start is TBA, require the host to enter an expiration in the form and validate it on the server before creating the invite. Let the host set a different date and time. Save the expiration as a Firestore timestamp and track whether it follows the event start or was set manually. Compare the stored timestamp with server time during redemption. When saving a new event start, check each default link against its current expiration and disable status. Update only links that are still live, and apply the start time and expiration changes together. Store the disable timestamp separately on the invite record. A redemption ordered after disabling fails. Existing memberships, RSVPs, grants, and other links stay active under their usual rules.

Use the framework’s default page for 404 responses until the custom Taal page is in scope. [GitHub issue #8](https://github.com/Ackberry/taal/issues/8)

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
| Event invite | An event-scoped token with a readable URL path, an expiration, its default or manual setting, and an optional disable timestamp. Every link admits verified guests under the same membership and RSVP rules. |
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

Record notification work alongside the state change and send it after commit. Deliver email through Brevo’s transactional API from the server. Mark RSVP confirmations and attendee-facing event updates as higher priority than announcement emails. Select pending emails in priority order for the available daily quota. Key retries to the notification and recipient so retrying a job can skip completed sends. For a published announcement, record which guests were confirmed and had contact email at publication. Use the latest saved contact email for delivery. Use the ordinary event URL and the limited email content specified in the rules. [Notification rules](rules.md#rsvp-guest-confirmation-and-event-updates)

## First acceptance checks

- A signed-out visitor sees sign-in and account creation. Direct requests for event listings or host profiles return no protected content.
- A verified user without membership sees only the listing when opening the ordinary URL. Redeeming the invite twice establishes one membership and leaves any active RSVP untouched.
- Invalid, expired, and disabled invites open the unavailable page without prompting for sign-in. A link that expires during sign-in also fails the server check at redemption.
- A new invite defaults to expiring at the event start time. A host can set a different expiration for that link, including a later time, and redemption uses the saved time.
- When an event start is TBA, the host must enter an expiration before Taal creates a link. The selected expiration stays fixed when the event start is announced.
- If the host reschedules before a default link expires, the link’s expiration moves to the new start. A reschedule at or after expiration leaves the link expired. A manually set expiration stays fixed and a disabled link stays disabled.
- Two links for one event can be redeemed while both are live. When one expires, the other still works, and a guest who already redeemed the expired link can use their existing membership through the ordinary event URL.
- After the host disables a link, it cannot be redeemed even before expiration. Other live links still work, and prior redemptions retain their membership, RSVP status, and grants.
- A host can create multiple guest links with custom URL paths for one event. Each link includes its own random suffix. The readable path alone grants no membership. The full live path opens the standard guest invite flow and follows the same RSVP and waitlist rules.
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
- When capacity is limited and both kinds are pending, choose RSVP confirmations and attendee-facing event updates before announcement emails.
- Announcement notifications go to eligible recipients as of publication. The email carries the ordinary event URL and omits private details, announcement text, and invite tokens.
