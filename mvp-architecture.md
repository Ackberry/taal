# MVP architecture for event access

**Draft.** A verified guest redeems an event invite to become a member. The RSVP determines whether that member can see private details, read announcements, or request songs. Posting an announcement additionally requires an event-specific grant from the host. The server checks these conditions on each request. [Confirmed product rules](rules.md)

## Access by event state

Each guest row assumes a verified Firebase session. “Event page” means the RSVP and status view. The locked homepage card is available to anyone who can see the listing.

| Event relationship | Event page | Exact details and board | Request songs while open | Publish announcements |
| --- | --- | --- | --- | --- |
| Guest without membership | — | — | — | — |
| Member without an RSVP | Yes | — | — | — |
| Waitlisted member | Yes | — | — | — |
| Confirmed member | Yes | Yes | Yes | With a host grant |
| Canceled or removed guest | — | — | — | — |
| Event host | Yes | Yes | Manages requests | Yes |

Exact details include the time, location, and private reference images. The server requires a current confirmed RSVP for guest access to private media and announcement history. Full tracklist access for a confirmed guest also requires the host's tracklist sharing setting to include them. Host-profile announcements follow the host profile's visibility rules. [Event and announcement rules](rules.md#private-events)

## Proposed data and authorization model

| Record | What it represents |
| --- | --- |
| Host account | A Firebase user ID with the ability to host, assigned through the owner's separate host invite flow. |
| Event | The owning host, locked-card listing fields, private details, capacity, and song request settings. The event has a stable URL for normal navigation and notifications. |
| Event invite | An event-scoped token that the server validates during redemption. One shared link can admit multiple verified users. |
| Event participant | One record per event and Firebase user ID. It holds membership status, current RSVP status, and the waitlist position for an active waitlisted RSVP. A canceled or removed record retains enough state to enforce the re-entry policy. |
| Event posting grant | A host-managed grant tied to a confirmed RSVP for one event and one guest. The proposal is to end the grant when that RSVP ends. |
| Event announcement | The event, author, content, and publication time. Keep existing posts available to confirmed attendees after the author loses access. |

The invite flow sends signed-out guests through Google sign-in or SMS verification and resumes redemption afterward. The server verifies the Firebase session, then validates the token and creates or loads the participant record. Repeat redemption by an active member returns the existing membership and preserves the RSVP and queue position. Redirect to the ordinary event URL after redemption. Keep the invite token out of ordinary URLs, notification content, and application logs.

Build listing, RSVP, and private-detail responses from explicit field sets. Check event ownership for host actions. For guest actions, read current membership and RSVP state, plus the specific grant or setting required by the operation. Keep revocation-sensitive responses out of shared caches, and authorize private media requests when they arrive. Spotify search for an event follows the server-side event access checks. Song submission also checks whether the host has closed requests and whether the deadline has passed, using server time.

## RSVP and capacity changes

Use one transaction boundary per event for operations that change attendance. A new RSVP, a cancellation, a host add or removal, and a capacity edit all use the same capacity and waitlist logic. Assign a stable queue position when a guest joins the waitlist. The transaction checks current membership and active RSVP state, fills open spots in queue order, and confirms or waitlists the incoming RSVP. Removing the capacity limit confirms everyone waiting. A capacity decrease that needs removals saves the selected removals and the new limit together, or rejects the whole change.

Cancellation revokes access to the event and board, deletes the guest's requests, and removes their contributions to request counts. Tracks already on Spotify stay on the playlist. Host removal revokes access to that event and lets the next eligible guest move up if a confirmed spot opens. A proposed starting point for manual additions is to add an existing Firebase user as a confirmed participant through the same capacity transaction. Serialize song request creation and announcement publication with RSVP and posting-grant changes so an action ordered after revocation fails. [Deferred Spotify decision](https://github.com/Ackberry/taal/issues/1)

Record notification work alongside the state change and send it after commit, with retries keyed to the notification and recipient. For a published announcement, record which guests were confirmed and had contact email at publication. Use the latest saved contact email for delivery. Use the ordinary event URL and the limited email content specified in the rules. [Notification rules](rules.md#rsvp-guest-confirmation-and-event-updates)

## Decisions to confirm

- **Re-entry after cancellation or removal.** Proposed behavior gives canceled guests a fresh RSVP through the invite, with a new waitlist position if the event is full. Removed guests need the host to add them back. Opening an old event page link leaves access revoked in either case. [GitHub issue #6](https://github.com/Ackberry/taal/issues/6)
- **Posting grants after an RSVP ends.** Proposed behavior ends the grant on cancellation or removal. If the guest later confirms again, the host can grant permission again. [GitHub issue #5](https://github.com/Ackberry/taal/issues/5)

## First acceptance checks

- A verified user without membership sees only the listing when opening the ordinary URL. Redeeming the invite twice establishes one membership and leaves any active RSVP untouched.
- With one remaining spot and two simultaneous RSVP submissions, one is confirmed and the other is waitlisted. When the confirmed guest cancels, the longest-waiting guest is promoted and can read prior announcements.
- A confirmed guest without a grant can read the board. Once granted permission, they can publish for that event. After revocation, a direct publish request fails even from a page opened before the revocation.
- After a cancellation or host removal, direct requests for private event details and board content fail. A guest's canceled song requests no longer count toward event totals, and tracks already on Spotify remain on the playlist.
- Announcement notifications go to eligible recipients as of publication. The email carries the ordinary event URL and omits private details, announcement text, and invite tokens.
