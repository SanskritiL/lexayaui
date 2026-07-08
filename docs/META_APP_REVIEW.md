# Meta app review guide

Current Instagram automation mode uses least-privilege Instagram Login permissions:

| Permission | Why it is needed |
| --- | --- |
| `instagram_business_basic` | Connect the Instagram professional account and list owned media for rule targeting. |
| `instagram_business_manage_comments` | Receive/comment-match events and post the public reply. |
| `instagram_business_manage_messages` | Send the private reply tied to a comment. |

Do not request these unless the feature is re-enabled:

| Permission | Why it is not needed by default |
| --- | --- |
| `instagram_business_content_publish` | Only needed for Instagram post/reel publishing. The UI and publish service currently disable Instagram publishing by default. |
| `instagram_business_manage_insights` | Only needed for analytics/insights. |
| Human Agent | Only needed for supported human-agent messaging flows. |

## Demo script for review

1. Log in to Lexaya.
2. Connect an Instagram professional account.
3. Open Instagram automations.
4. Pick one specific post/reel.
5. Add a keyword.
6. Add a public reply, for example: `Thanks, check your DMs.`
7. Add a DM message.
8. Comment the keyword from a different Instagram account.
9. Show that only the selected post/reel triggers the public reply and private reply.

## Webhook subscription

Subscribe only to Instagram comment events needed by the automation. Do not subscribe to message events unless the product starts processing inbound DMs.

## Re-enabling Instagram publishing

If you later submit publishing:

1. Add `instagram_business_content_publish` back to the OAuth scopes.
2. Set `INSTAGRAM_PUBLISHING_ENABLED=true`.
3. Restore Instagram in the publish target UI.
4. Update the Meta app review screencast to show the user-initiated publishing flow.
