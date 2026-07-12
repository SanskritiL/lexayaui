# Meta app review — submission copy

Paste-ready answers for the "How will this app use X?" fields. See `META_APP_REVIEW.md`
for the permission rationale and the demo script the screencast must follow.

Product one-liner used throughout: Lexaya is a social media management tool that lets a
business connect its own Instagram professional account and set up comment-to-DM
automations — when someone comments a keyword on a post the business selected, Lexaya
posts a public reply and sends that commenter a private reply.

---

## instagram_business_basic

Lexaya uses `instagram_business_basic` to let the business owner connect their own
Instagram professional account and choose which of their own posts an automation should
watch.

After the user completes Instagram Login, we call `GET /me` with the fields
`id, user_id, username, name, profile_picture_url, followers_count, follows_count,
media_count`. The username and profile picture are shown in the app's connected-accounts
list so the user can confirm which account is linked and can disconnect it; the follower,
following, and media counts are shown as read-only context on that same account card.

When the user creates a comment-to-DM automation, we call `GET /{ig-user-id}/media` with
the fields `id, caption, media_type, media_url, thumbnail_url, permalink, timestamp,
comments_count, like_count` to render a grid of the user's own recent posts and reels. The
user picks exactly one post; we store that media ID on the rule so the automation only
fires for comments on that post. Without this permission the user could not identify their
account or select a post, and no automation could be scoped.

We only ever read the connected user's own profile and own media. We do not read other
users' profiles or media, we do not use hashtag or public content search, and we do not
use this data for advertising, profiling, or resale.

---

## instagram_business_manage_comments

Lexaya uses `instagram_business_manage_comments` to detect the comment that triggers an
automation and to post the business's public reply to it.

The business owner creates a rule: one of their own posts, one or more trigger keywords,
an optional exclude-keyword list, a public reply message, and a DM message. We subscribe
to Instagram comment webhooks for the connected account. When a comment webhook arrives we
verify the `X-Hub-Signature-256` signature, match the event to the connected account, skip
comments authored by the account itself, and check the comment's media ID and text against
the user's active rules. If a rule matches, we post the business's configured public reply
as a reply to that comment.

Concretely: a bakery posts a reel and sets the keyword "RECIPE". A follower comments
"RECIPE". Lexaya replies publicly with "Thanks! Check your DMs." and then sends the recipe
link by private reply.

We only read comments on the connected business's own media, and only for media the user
explicitly selected for a rule. Comments that do not match an active rule are ignored and
not stored. We do not moderate, hide, or delete comments, and we do not read comments on
media we were not given a rule for.

---

## instagram_business_manage_messages

Lexaya uses `instagram_business_manage_messages` to send the private reply that the
business owner configured, to the person who commented the trigger keyword.

This is the core of the product. When a comment matches an active rule (see
`instagram_business_manage_comments` above), we send exactly one private reply to that
commenter containing the message the business author wrote — typically a link, discount
code, lead magnet, or booking page they promised in the post caption. The message is a
private reply tied to that specific comment, sent within the allowed window. We render the
business's own template, optionally substituting the commenter's `{username}` and their
`{comment}` text.

The user is always the initiator: the person commented on the business's post, and the
business's reply directly answers that comment. We send one DM per matched comment. We do
not send unsolicited messages, we do not broadcast, we do not message people who have not
commented, and we do not send promotional content outside the message the business owner
authored for that specific post. We do not read the business's Instagram inbox or any
message the business did not trigger through a rule.

---

## instagram_business_content_publish

> Only submit this if you flip `INSTAGRAM_PUBLISHING_ENABLED=true` and actually make the
> required API test calls. It currently ships disabled — see the caveat in chat.

Lexaya uses `instagram_business_content_publish` to publish a post or reel that the
business owner composed inside Lexaya to their own connected Instagram professional
account.

In the Lexaya composer the user uploads a video or image, writes a caption, selects
Instagram as a destination, and either publishes immediately or schedules it for a future
time. At publish time we create a media container via `POST /{ig-user-id}/media` with the
user's `video_url` or `image_url` and caption, poll until the container finishes
processing, then call `POST /{ig-user-id}/media_publish` to publish it.

Every publish is content the user created and explicitly chose to post to their own
account. We never publish on our own initiative, never publish content the user did not
compose and approve, and never publish to an account the user did not connect.

---

## Custom questions

**Are you a Tech Provider?** Yes. Lexaya is a SaaS product used by other businesses to
manage their own Instagram professional accounts. Each customer connects their own account
via Instagram Login and grants permissions to Lexaya; we act on their behalf, on their own
media and their own comments, at their explicit configuration. We are not requesting access
to any account we do not own on behalf of a customer who has connected it.

**Data handling.** Access tokens are stored server-side and are never exposed to the
browser. We store only what an automation needs: the connected account's ID and profile
fields, the media IDs the user selected for rules, and a log of triggered comments and sent
DMs so the user can see what their automation did. Users can disconnect an account at any
time, which stops all automations and removes the stored token. We do not sell data, share
it with data brokers, or use it for advertising or model training.

---

## Screencast checklist

One continuous recording, no cuts, showing:

1. Sign up / log in to Lexaya as a new user.
2. Click Connect Instagram; complete the Instagram Login consent screen with the
   permissions visible on screen.
3. Land back in Lexaya; show the connected account card with username, profile picture,
   and follower/post counts. *(instagram_business_basic)*
4. Open Instagram automations; show the grid of the user's own posts loading.
   *(instagram_business_basic)*
5. Select one post, enter the keyword, the public reply, and the DM message. Save.
6. Switch to a second, different Instagram account (a phone, screen-shared).
7. Comment the keyword on the selected post.
8. Show the public reply appearing on the comment. *(manage_comments)*
9. Show the private reply arriving in the second account's DMs. *(manage_messages)*
10. Comment the keyword on a *different* post to show it does not fire — proves scoping.
11. Show disconnecting the account.
