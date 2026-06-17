/**
 * Webhook subscription service.
 *
 * Registers Gmail "watch" and Google Calendar "push channel" subscriptions
 * so that incoming changes are POSTed to our single webhook endpoint
 * (/api/webhooks) in realtime — instead of polling.
 *
 * IMPORTANT — Gmail vs Calendar use DIFFERENT delivery mechanisms:
 *
 *   • Gmail can only push to a Google Cloud Pub/Sub TOPIC. There is no
 *     way to give Gmail's users.watch a plain HTTPS callback URL. You create
 *     one Pub/Sub topic + push subscription ONCE per Google Cloud project (the
 *     push subscription's endpoint URL points at our /api/webhooks route).
 *     After that one-time setup, the app only ever needs the topic NAME
 *     (GOOGLE_PUBSUB_TOPIC env var), which is the same for every tenant.
 *
 *   • Google Calendar's events.watch DOES accept a direct HTTPS callback
 *     URL per subscription, so we pass our own /api/webhooks URL straight
 *     to it, with the tenantId baked into the query string.
 *
 * WHY WE CALL GOOGLE REST APIS DIRECTLY:
 *   The Corsair packages (@corsair-dev/gmail, @corsair-dev/googlecalendar)
 *   expose CRUD endpoints for reading/writing data, but do NOT expose the
 *   watch/subscribe endpoints (users.watch for Gmail, events.watch for
 *   Calendar) — those are subscription-management calls, not data calls.
 *   We retrieve the user's OAuth access token from Corsair's key manager
 *   and call the Google REST APIs ourselves.
 *
 * Both subscriptions expire (Gmail: 7 days max, Calendar: ~1 month max) —
 * we persist the expiration on the `users` row and re-subscribe on every
 * sign-in. For long-lived sessions, also wire a daily cron that calls
 * subscribeAllWebhooks() for any user whose expiration is within 24h
 * (see scripts/renew-webhooks.ts).
 */

import { getTenant, getTenantId } from "./corsair";
import { env } from "@/src/env";
import { logger } from "@/src/lib/logger";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

function webhookCallbackUrl(tenantId: string): string {
  const base = (env.NEXT_PUBLIC_APP_URL ?? env.NEXTAUTH_URL).replace(/\/$/, "");
  const params = new URLSearchParams({
    tenantId,
    token: env.WEBHOOK_SHARED_SECRET,
  });
  return `${base}/api/webhooks?${params.toString()}`;
}

/** Shape returned by Gmail users.watch REST API */
interface GmailWatchResponse {
  historyId?: string;
  expiration?: string; // epoch milliseconds as a string
}

/** Shape returned by Google Calendar events.watch REST API */
interface CalendarWatchResponse {
  kind?: string;
  id?: string;          // channel ID (UUID we generated)
  resourceId?: string;  // opaque ID Google assigns — needed to stop the channel
  resourceUri?: string;
  expiration?: string;  // epoch milliseconds as a string
}

/**
 * Register a Gmail "watch" subscription for this user's INBOX.
 *
 * We call the Gmail REST API directly (POST /gmail/v1/users/me/watch)
 * because the @corsair-dev/gmail package does not expose the watch
 * endpoint — it's a subscription-management call, not a data call.
 *
 * The access token is fetched from Corsair's account-level key manager.
 *
 * Response shape: { historyId: string, expiration: string (epoch ms) }
 * We store both on the `users` row:
 *  - gmailHistoryId: cursor for history.list when a webhook fires later
 *  - gmailWatchExpiration: so the renewal job knows who's stale
 *
 * @param googleSub - Google `sub`, used as the Corsair tenant key.
 * @param dbUserId  - DB `users.id` (UUID) — the row we persist tracking
 *   fields on.
 */
export async function subscribeGmailWebhook(
  googleSub: string,
  dbUserId: string,
): Promise<boolean> {
  const tenantId = getTenantId(googleSub);

  try {
    const tenant = getTenant(googleSub);

    // Retrieve the user's OAuth access token from Corsair's key manager.
    // This is the same token Corsair uses internally for all Gmail API calls.
    const accessToken = await tenant.gmail.keys.get_access_token();
    if (!accessToken) {
      logger.warn("Gmail webhook subscription skipped — no access token", {
        tenantId,
      });
      return false;
    }

    // Call Gmail REST API: POST /gmail/v1/users/me/watch
    // This registers a Pub/Sub push notification for INBOX changes.
    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/watch",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topicName: env.GOOGLE_PUBSUB_TOPIC,
          labelIds: ["INBOX"],
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("Gmail watch API returned non-2xx", {
        tenantId,
        status: response.status,
        body: errorText,
      });
      return false;
    }

    const watch = (await response.json()) as GmailWatchResponse;

    if (!watch.historyId || !watch.expiration) {
      logger.warn("Gmail watch response missing expected fields", {
        tenantId,
        watch,
      });
    }

    await db
      .update(users)
      .set({
        gmailHistoryId: watch.historyId ? String(watch.historyId) : null,
        gmailWatchExpiration: watch.expiration
          ? new Date(Number(watch.expiration))
          : null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, dbUserId));

    logger.info("Gmail webhook (watch) registered", {
      tenantId,
      historyId: watch.historyId,
      expiration: watch.expiration,
    });
    return true;
  } catch (err) {
    logger.error("Gmail webhook subscription failed", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Register a Google Calendar push channel for this user's primary calendar.
 *
 * We call the Calendar REST API directly (POST /calendar/v3/calendars/primary/events/watch)
 * because the @corsair-dev/googlecalendar package does not expose the watch
 * endpoint — it's a subscription-management call, not a data call.
 *
 * Response includes a channel id + resourceId (needed to stop the channel
 * later) and an expiration timestamp.
 */
export async function subscribeCalendarWebhook(
  googleSub: string,
  dbUserId: string,
): Promise<boolean> {
  const tenantId = getTenantId(googleSub);
  const callbackUrl = webhookCallbackUrl(tenantId);

  try {
    const tenant = getTenant(googleSub);

    // Retrieve the user's OAuth access token from Corsair's key manager.
    const accessToken = await tenant.googlecalendar.keys.get_access_token();
    if (!accessToken) {
      logger.warn("Calendar webhook subscription skipped — no access token", {
        tenantId,
      });
      return false;
    }

    // Unique channel ID for this subscription — required by the API.
    // Using a timestamp + tenantId so it's unique per re-subscription.
    const channelId = `${tenantId}-${Date.now()}`;

    // Call Calendar REST API: POST /calendar/v3/calendars/primary/events/watch
    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events/watch",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: channelId,
          type: "web_hook",
          address: callbackUrl,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("Calendar watch API returned non-2xx", {
        tenantId,
        status: response.status,
        body: errorText,
      });
      return false;
    }

    const channel = (await response.json()) as CalendarWatchResponse;

    await db
      .update(users)
      .set({
        calendarChannelId: channel.id ?? null,
        calendarResourceId: channel.resourceId ?? null,
        calendarWatchExpiration: channel.expiration
          ? new Date(Number(channel.expiration))
          : null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, dbUserId));

    logger.info("Calendar webhook (push channel) registered", {
      tenantId,
      channelId: channel.id,
      resourceId: channel.resourceId,
      expiration: channel.expiration,
    });
    return true;
  } catch (err) {
    logger.error("Calendar webhook subscription failed", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Register both Gmail and Calendar webhook subscriptions for a user.
 * Fire-and-forget — never blocks sign-in. Call from:
 *  - the NextAuth signIn callback, right after linkCorsairTenant
 *  - the /api/connect OAuth callback, after a fresh plugin (re)connection
 *
 * @param googleSub - Google `sub`, NOT the DB UUID.
 * @param dbUserId  - DB `users.id` (UUID).
 */
export async function subscribeAllWebhooks(
  googleSub: string,
  dbUserId: string,
): Promise<void> {
  const [gmailOk, calendarOk] = await Promise.all([
    subscribeGmailWebhook(googleSub, dbUserId),
    subscribeCalendarWebhook(googleSub, dbUserId),
  ]);

  logger.info("Webhook subscription summary", {
    tenantId: getTenantId(googleSub),
    gmail: gmailOk,
    calendar: calendarOk,
  });
}