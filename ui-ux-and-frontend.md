# How Taal should feel

Taal should feel like opening an invitation from a friend. On a phone, a guest should be able to open the link, verify who they are, RSVP and find the information they need for the event. Once their RSVP is confirmed, they can request a song if they want to. This guide proposes how the experience could work. [The product rules](rules.md) define the confirmed behaviour.

## What to learn from other invite apps

Partiful lets guests open an invite and respond in their browser. It asks for phone verification after they choose a response. Taal can make the same link-to-browser journey feel familiar while asking guests to verify when they first open the invite, as its privacy rules require. [Partiful’s RSVP flow](https://help.partiful.com/en-us/articles/15525505-how-do-i-rsvp-to-an-event-on-partiful)

Luma gives waitlisted guests a clear status and tells them when their spot is confirmed. Taal can use that same clarity. Its own waitlist moves automatically in order when spots open. [Luma’s waitlist](https://help.luma.com/p/waitlist)

## What guests should see

1. **Open the invite.** Give signed-out guests two clear choices, **Continue with Google** and **Get a code by text**. Explain that verification is needed to open the private invite. Return them to the same event when they finish.
2. **RSVP.** Once the invite is redeemed, put **RSVP** near the top of the event page. Show the result in words, such as **You’re going** or **You’re on the waitlist**. Explain that waitlisted guests get a spot automatically when their turn comes. Reveal the exact time and address once a guest is confirmed and keep those details visible if they cancel. Use **TBA** for details the host has yet to announce.
3. **Request a song.** When requests are open, offer confirmed guests **Request a song**. Let them search by song or artist, or paste a Spotify link. Their Taal sign-in should be all they need for either option. Show the title and artist so guests can check what they picked, and ask for a first name or nickname. After submission, show **Song requested** and repeat the event details. If the host has set a deadline, show the time left. When requests close, say so where the button would normally appear.

Use the event photo to give the page some personality. Show the RSVP status, address, directions and announcements as text, even if they also appear on a flyer. Use clear labels, strong contrast, visible keyboard focus and buttons that are easy to tap. Aim to meet level AA of the WCAG 2.2 accessibility guidelines. [W3C accessibility guidelines](https://www.w3.org/TR/WCAG22/)

## What hosts should see

Give hosts one page per event with clear ways to edit details, copy the invite link, manage guests, post an announcement and review song requests. In the review list, show each track once with its request count. Let hosts select several tracks and use **Add to Spotify**. Move each track to the event tracklist once Spotify confirms it was added. Keep failed tracks in the review list with a way to retry.

## Frontend recommendation

Start with a responsive website that works on phones and computers. Next.js is a good first choice because it can serve guest links and host pages from one project and run private access checks on the server. Use Firebase for Google and text-message verification, as the rules specify. The server should check who can see private details and whether they can request a song before sending data or accepting a request. [Next.js documentation](https://nextjs.org/docs/app/getting-started/server-and-client-components) · [Firebase verification documentation](https://firebase.google.com/docs/auth/admin/verify-id-tokens)

Try the invite on real phones with people who rarely use event tools. Ask them to RSVP, explain their status and find the address if confirmed. Try both sign-in options from a messaging app. Before relying on song search, test it with Taal’s Spotify integration using a confirmed guest with no Spotify session. [GOV.UK usability testing guide](https://www.gov.uk/service-manual/user-research/using-moderated-usability-testing) · [Spotify’s Development Mode guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
