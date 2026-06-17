/**
 * scripts/renew-webhooks.ts
 *
 * Renews Gmail watch + Calendar push channel subscriptions for any user
 * whose subscription expires within the next 24 hours.
 *
 * Why this exists: subscribeAllWebhooks() already runs on every sign-in,
 * but a user who keeps a tab open for a week+ without re-authenticating
 * will silently stop getting webhooks once Gmail's 7-day watch (or
 * Calendar's ~1-month channel) lapses. Run this on a daily cron (Vercel
 * Cron, GitHub Actions, or a plain crontab hitting a protected route) so
 * nobody's webhooks go stale.
 *
 * Usage:
 *   pnpm tsx scripts/renew-webhooks.ts
 *
 * Vercel Cron (vercel.json):
 *   { "crons": [{ "path": "/api/cron/renew-webhooks", "schedule": "0 3 * * *" }] }
 *   (wrap this script's body in that route instead, protected by
 *   a CRON_SECRET header check.)
 */

import { db } from "../src/server/db";
import { users } from "../src/server/db/schema";
import { isNull, or, lt } from "drizzle-orm";
import { subscribeAllWebhooks } from "../src/server/lib/webhook-subscriptions";

const RENEW_WINDOW_MS = 24 * 60 * 60 * 1000; // renew if expiring within 24h

async function main() {
  const cutoff = new Date(Date.now() + RENEW_WINDOW_MS);

  const stale = await db
    .select({
      id: users.id,
      googleSub: users.googleSub,
      gmailWatchExpiration: users.gmailWatchExpiration,
      calendarWatchExpiration: users.calendarWatchExpiration,
    })
    .from(users)
    .where(
      or(
        isNull(users.gmailWatchExpiration),
        lt(users.gmailWatchExpiration, cutoff),
        isNull(users.calendarWatchExpiration),
        lt(users.calendarWatchExpiration, cutoff),
      ),
    );

  const candidates = stale.filter((u) => u.googleSub);

  console.log(`Found ${candidates.length} user(s) needing webhook renewal.`);

  for (const u of candidates) {
    try {
      await subscribeAllWebhooks(u.googleSub!, u.id);
      console.log(`Renewed webhooks for user ${u.id}`);
    } catch (err) {
      console.error(`Failed to renew webhooks for user ${u.id}:`, err);
    }
  }

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });