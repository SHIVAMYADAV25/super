# Making Gmail + Calendar webhooks actually work — setup guide

This covers the one-time Google Cloud setup (replaces the ngrok step from
the video) and the env vars the new code needs. Code changes are already
applied; this is just the infrastructure + config side.

## Why Gmail and Calendar are different

- **Gmail** can only push to a Google Cloud **Pub/Sub topic**. There is no
  "give Gmail a URL" option — that's why the CLI screenshot asks for a
  "Pub/Sub topic name" instead of a URL. You point a Pub/Sub **push
  subscription** at your real HTTPS endpoint, and Gmail publishes to the
  topic, which forwards to your endpoint.
- **Calendar** accepts a direct HTTPS callback URL per subscription
  (`events.watch`) — no Pub/Sub needed, matches the CLI screenshot asking
  for "webhook URL" directly.

This means: Gmail setup happens **once per Google Cloud project** (a topic
+ subscription pointed at your domain). Calendar setup happens
**automatically, per user, in code** — already wired into sign-in.

## One-time GCP setup (do this once, for your whole app — not per user)

1. Go to console.cloud.google.com → select your project (the same one your
   OAuth client lives in).
2. Search "Pub/Sub" → **Topics** → **Create Topic**. Name it e.g.
   `corsair-webhooks`. Note the full path:
   `projects/<your-project-id>/topics/corsair-webhooks`.
3. Still on the topic, go to **Permissions** → **Add Principal** → enter
   `gmail-api-push@system.gserviceaccount.com` → role **Pub/Sub Publisher**.
   Without this, `watch()` succeeds but you'll never receive a notification.
4. Go to **Subscriptions** → **Create Subscription** → attach it to the
   topic above → Delivery type **Push** → Endpoint URL:
   `https://YOUR_REAL_DOMAIN/api/webhooks?tenantId=__placeholder__&token=YOUR_WEBHOOK_SHARED_SECRET`
   (the `tenantId` here doesn't matter for Gmail specifically — our code
   resolves the right user from the payload + `googleSub` lookup, not from
   this query param. Just make sure `token` matches `WEBHOOK_SHARED_SECRET`
   so the route doesn't reject it.)
5. Done — this never needs to be touched again per user. Every user's
   `gmail.api.messages.watch()` call references the *topic*, not this
   subscription.

In local dev, replace `YOUR_REAL_DOMAIN` with your ngrok URL, same as the
video — that part of the workflow is unchanged, it's just one-time infra
setup instead of something a script does per user.

## Env vars to add (.env / .env.local)

```
GOOGLE_PUBSUB_TOPIC=projects/<your-project-id>/topics/corsair-webhooks
WEBHOOK_SHARED_SECRET=<any random 32+ char string>
```

Generate a secret quickly:
```
openssl rand -hex 32
```

## Run the new migration

```
pnpm drizzle-kit push
# or, if you use migrate files directly:
psql "$DATABASE_URL" -f drizzle/0005_webhook_tracking.sql
```

This adds `google_sub`, `gmail_history_id`, `gmail_watch_expiration`,
`calendar_channel_id`, `calendar_resource_id`, `calendar_watch_expiration`
to `users`.

If you already have existing users in your DB from before this migration,
`google_sub` will be NULL for them until their next sign-in — the updated
`getOrCreateUser()` backfills it automatically the next time they log in.

## What happens now, end to end, per user (zero manual steps)

1. User signs in with Google → NextAuth `signIn` callback runs
   `linkCorsairTenant` (stores OAuth tokens) → then `subscribeAllWebhooks`
   fires in the background:
   - Gmail: calls `tenant.gmail.api.messages.watch({ topicName, labelIds: ["INBOX"] })`,
     stores the returned `historyId` + `expiration` on `users`.
   - Calendar: calls `tenant.googlecalendar.api.events.watch({ calendarId: "primary", callbackUrl })`
     where `callbackUrl` is `https://yourapp.com/api/webhooks?tenantId=user_<sub>&token=...`.
     Stores the returned channel id + expiration.
2. New email arrives → Gmail publishes to your Pub/Sub topic → the push
   subscription POSTs to `/api/webhooks` → `processWebhook()` identifies
   it as a Gmail event → `handleGmailWebhook()` calls `history.list` from
   the last stored `historyId` to find the actual message id(s) → runs
   each through `handleNewEmail()` (DB upsert, enrichment queue, SSE push)
   → advances the stored `historyId`.
3. Calendar event changes → Google POSTs directly to the `callbackUrl` from
   step 1 → `handleCalendarWebhook()` re-fetches upcoming events and
   upserts them via the new `syncEventsFromWebhook()` → SSE push tells the
   UI to refetch.
4. If a user reconnects just Gmail or just Calendar via the existing
   "Connect" button (`/api/connect` → OAuth → `/api/auth/oauth-callback`),
   that single plugin's webhook is re-subscribed right there too — no need
   to log out/in.

## Keeping subscriptions alive for long sessions

Gmail watch expires after 7 days max; Calendar channels expire after about
a month. Re-subscribing happens automatically on every sign-in, which
covers most users. For users who never re-authenticate, run
`scripts/renew-webhooks.ts` on a daily cron — it finds anyone expiring
within 24h and renews just them.

## Testing without waiting for a real cron / real domain

Same flow as the video: run ngrok locally, point the Pub/Sub push
subscription's endpoint at the ngrok URL, sign in, send yourself an email,
watch the dev server logs for `"Gmail webhook processed"`.

## Files touched in this pass

- `src/env.ts` — added `GOOGLE_PUBSUB_TOPIC`, `WEBHOOK_SHARED_SECRET`
- `src/server/db/schema/users.ts` + `drizzle/0005_webhook_tracking.sql` —
  added `google_sub`, `gmail_history_id`, `gmail_watch_expiration`,
  `calendar_channel_id`, `calendar_resource_id`, `calendar_watch_expiration`
- `src/auth/auth.service.ts` — `getOrCreateUser` now persists/backfills `googleSub`
- `app/api/auth/[...nextauth]/route.ts` — `subscribeAllWebhooks` call now
  passes `dbUser.id` as the second argument
- `src/server/lib/webhook-subscriptions.ts` — full rewrite with real
  Corsair API calls instead of guessed method names
- `app/api/webhooks/sub/route.ts` — passes `req.user.id` as second arg
- `app/api/auth/oauth-callback/route.ts` — re-subscribes the specific
  plugin's webhook right after a fresh `/api/connect` OAuth flow
- `app/api/webhooks/route.ts` — real `POST` handler with shared-secret
  auth; removed the dead duplicate `GET` SSE handler (the real one lives
  at `/api/events/stream`)
- `src/server/webhooks/index.ts` — real Gmail History API diffing and
  Calendar re-sync instead of empty SSE pings
- `src/server/services/calendar.service.ts` — added `syncEventsFromWebhook`
- `scripts/renew-webhooks.ts` — new, for the daily cron