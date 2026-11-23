# Taal rules

## Hosting

- Hosting is invite-only. The project owner decides who to invite as a host.
- Each invited host connects their own Spotify account, creates and manages their own events, and syncs event playlists to their own Spotify account.
- Send each invited host an invitation link by email.
- Hosts can publish host-level announcements on their profiles. People who can view the host profile can read those announcements. Event RSVP status does not affect access to host-profile announcements.

## Guest access and verification

- Verify each guest through Firebase Authentication before allowing them to redeem an event invite or submit song requests. The guest chooses either Google sign-in or phone verification by SMS.
- The event link opens a verification screen for signed-out guests. Verify the guest session on the server and enforce the event membership and RSVP rules below.
- Use the Firebase user ID to identify the guest independently of their verification method. Allow additional verification methods in the future.

## Private events

- Every event is private. The host can create multiple event-specific invite links that are active at the same time. Each link has its own expiration.
- Give the host one interface for creating event invite links. Selecting **Guest** disables all elevated permission options and creates a shareable invite that grants event membership under the normal RSVP rules.
- To delegate event permissions, the host selects the permissions and a specific recipient in the same interface. The server grants only the selected permissions for that event to the intended verified account. Permission invite recipients RSVP under the same capacity and waitlist rules as other guests and appear on the attendee list once confirmed. A current confirmed RSVP is required to use an announcement posting or event editing grant.
- Use a separate, unguessable token for each link. After Firebase verification, check the token, its expiration, and any recipient restriction on the server before redeeming the invite. Expiring a link leaves memberships and RSVPs already established through it in place.
- Check event membership and RSVP status on the server before returning invite-only information, searching Spotify for an event, or accepting a song request. Exact event details and new song requests require a current confirmed RSVP. Homepage listings do not grant membership.
- The homepage may list events a guest cannot access. Show a locked card with the event name, banner, and basic listing information. Serve these cards from a limited set of listing fields. Apply the event-detail access rule to the exact date and time, venue or address, and other private event information. Guests who have yet to RSVP or are waitlisted can access the event page and RSVP status after redeeming the invite.

## Guest song submissions

- Song requests are open as soon as the event invite link is shared. Guests can submit once they verify, redeem the invite, and have a confirmed RSVP. Guests on the waitlist can start submitting when their RSVP is confirmed, while requests are open.
- The host can close song requests manually or set an optional timer that closes them automatically. The host can close requests early while the timer is running.
- When a timer is active, show a countdown on the event details page, such as “Requests close in 3 hours.” Enforce the closing time on the server when accepting requests.
- The host can reopen song requests after a manual close or an automatic close.
- Guests can paste a Spotify track link or search for a song directly in Taal without signing into Spotify.
- Spotify documents track search via `GET /v1/search?type=track` for Development Mode, with up to 10 results per request. Test track search using Taal’s Spotify app with a verified guest who has no Spotify session. [Spotify Search API](https://developer.spotify.com/documentation/web-api/reference/search) · [Development Mode changes](https://developer.spotify.com/documentation/web-api/references/changes/february-2026)

## RSVP, guest confirmation, and event updates

- The host and attendees with an event editing grant can configure the event name, date and time, address, event photo, and description. They can also attach additional reference images, such as outfit examples, an entrance photo, or a flyer.
- Hosts can optionally add a theme or dress code, last entry time, student or photo ID requirements, and a plus-one policy. They can also add directions, the entrance to use, shuttle or rideshare drop-off information, step-free access information, and a contact for event or accessibility questions. Which event filters to support is still open.
- After a successful song request, show a confirmation with the event address and other details the host has provided. Show “TBA” for details the host has yet to announce, including the address.
- Email is the primary channel for guest communications. Email confirmed guests who have an email address when their RSVP is confirmed and when attendee-facing details change, such as the date, time, or address, including when a detail marked “TBA” is announced. Use SMS only for authentication and notifying guests who signed up by SMS when they are approved from the waitlist.
- RSVP confirmation, event update, and event announcement emails link directly to the event page using its ordinary URL. Exclude invite links, invite tokens, and sign-in links. Signed-out guests go through the normal sign-in flow, and Taal checks their event access before showing private content. Limit event information in emails to fields shown on the locked homepage card. Keep exact event details and announcement text on the event page.
- Event update emails identify the event by its listing name and show only the labels of the fields that changed, such as “Updated: Location.” Exclude previous and new field values from the update summary. Direct guests to Taal to see the current details.
- Guests who verified by SMS can join the waitlist when one is in use. Prompt them to add an email address for project information when their RSVP is confirmed, either after they are approved from the waitlist or when they are confirmed directly. Guests can skip the prompt. If they skip, show an alert saying they will receive no update notifications and should check the event page regularly for updates.
- Guests signed in by SMS can add or change their contact email in settings. The email address requires no verification. Use the latest saved address for future email communications, including after a guest corrects an address they entered at RSVP.
- RSVP is a separate step. Guests can RSVP without requesting a song. Enforce confirmed RSVP status on the server before accepting a song request. Waitlisted guests become eligible when their RSVP is confirmed.
- Hosts can set an optional RSVP capacity per event. A verified guest who has redeemed the event invite can submit a new RSVP if they have no active confirmed or waitlisted RSVP for that event. The server confirms an eligible RSVP when a spot is available after applying waitlist priority. If the event is full, the server adds the guest to the waitlist. With no capacity limit, all eligible RSVPs can be confirmed. Apply the active RSVP, capacity, and waitlist checks and record the outcome in one atomic operation to prevent duplicates and overbooking from concurrent submissions.
- When a spot opens because a confirmed guest cancels, the host removes a confirmed guest, or the host increases capacity, automatically confirm the longest-waiting guest. Fill open spots in waitlist order before confirming new RSVPs. If the host removes the capacity limit, confirm all waitlisted guests. Apply the same server-side capacity checks and send the usual confirmation notifications for each promotion.
- Hosts can send the event invite link directly to guests so they can verify and RSVP themselves. All guests who use an invite link follow the same first-come, first-served RSVP and waitlist rules. Sending or redeeming a link does not reserve a spot or grant priority.
- The event host can manually add or remove guests for their own event. Manual additions require an existing, verified Taal account. The host finds the account by entering the exact verified email address or phone number used for sign-in. Use any separately supplied contact email only for communications. Enforce capacity atomically on the server for manual additions too. When an event is full, the host must save a higher capacity before manually adding another guest.
- When the event host removes a guest, immediately revoke the guest’s access and permission grants and add the verified account to that event’s block list. Only the event host can restore the guest’s eligibility through the block list. Reject redemption of any guest or permission invite while the account is blocked. Apply server-side rate limits to invite redemption attempts and keep blocked rejoin attempts silent for the host.
- After the host clears an event block, the guest can redeem a live invite and submit a fresh RSVP under the usual capacity and waitlist rules. A shared guest link grants standard guest access. A permission invite grants its selected permissions to the intended verified account, including when the link was issued before the block and is still live. A current confirmed RSVP is required to use those permissions.
- To lower capacity below the confirmed guest count, the host must select enough confirmed guests to remove so the remaining count fits the new limit. Apply the selected removals and the new limit together in one atomic operation. If the remaining count would exceed the new limit, reject the change and show an error asking the host to select more guests.
- Guests can cancel their RSVP. Immediately revoke their access to the event and its announcement board, including through previously shared event page links. Delete their song requests for the event and remove their contributions to shared request counts. They can still read announcements on the host’s profile. A guest who cancels can redeem a live guest invite and start a fresh RSVP. Apply the usual capacity and waitlist rules, with a new place in line if they join the waitlist.
- When a guest cancels, remove their event permission grants immediately. Keep announcements they published, event changes they made, and the corresponding audit history. The same verified account can regain its selected permissions by redeeming the original permission invite while it is still live and confirming a fresh RSVP under the usual capacity and waitlist rules.
- Keep tracks already on the linked Spotify playlist when a guest cancels, even if a track’s request count drops to zero. Implement this behavior for now. The decision about automatically removing tracks added through Taal is deferred. [GitHub issue #1](https://github.com/Ackberry/taal/issues/1)

## Event announcements

- Each event has its own announcement board. The event host and guests the host authorizes to post can publish announcements for that event. Guest access to the board, including posting, requires a current confirmed RSVP. Waitlisted guests can read earlier announcements on the board after they are approved.
- When the host or an authorized guest publishes an event announcement, notify guests who have a confirmed RSVP and an email address at the time of publication. Send a generic email saying there is a new announcement, using the link and content rules under [RSVP, guest confirmation, and event updates](#rsvp-guest-confirmation-and-event-updates). Guests can read the announcement and catch up on earlier posts in Taal after approval.

## Host approval and playlist creation

- Guest submissions appear in a list for the host to review. The host selects one or more tracks and clicks **Add** to approve them and send them to Spotify.
- The host can select an existing Spotify playlist as the event’s default playlist. Tracks already on that playlist appear in Taal as part of the event tracklist. If the host selects no playlist, Taal creates a Spotify playlist named after the event when the host approves the first batch. Later approvals add tracks to the event’s linked playlist.
- The host can edit the linked playlist in Spotify. Sync those edits back to Taal so the event tracklist reflects the linked playlist.
- Once Spotify confirms a track was added, it leaves the host’s review list and appears in the event tracklist. Tracks that fail to sync stay in the review list for retry.
- Show each track once in the relevant Taal list with its request count. Requests from distinct verified guest accounts increase the count for that track, including when the track is already on the linked playlist. A request for a track already on the playlist increases its count without adding another copy to Spotify.
- Show a top-artists preview to everyone who can see the event listing, including on locked event cards. The host can view the full tracklist and choose to share it and the Spotify playlist link with selected guests who have confirmed RSVPs or with all guests who have confirmed RSVPs. Enforce that access on the server.

## Guest names

- Require a first name or nickname with each song request. Guests must enter a name to submit.
- Show guest names only to the event host. Screen for obvious slurs and prompt the guest to choose a different name when one is flagged.
- Limit submissions per browser over a short period. Count at most one request per verified guest account for each track in an event.
- Let the host remove an abusive submission and its contribution to the request count while preserving other guests’ requests for the same track.
