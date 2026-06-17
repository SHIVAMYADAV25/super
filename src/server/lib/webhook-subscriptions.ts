// /**
//  * Webhook subscription service.
//  *
//  * Registers Gmail "watch" and Google Calendar "push channel" subscriptions
//  * with Corsair so that incoming changes are POSTed to our single webhook
//  * endpoint (/api/webhooks) in realtime — instead of polling.
//  *
//  * Callback URL format: ${NEXT_PUBLIC_APP_URL}/api/webhooks?tenantId=<corsairTenantId>
//  * where corsairTenantId === "user_<googleSub>" (getTenantId(googleSub)) —
//  * the SAME key used everywhere else (see corsair.ts, oauth-callback, SSE stream).
//  *
//  * Called from the NextAuth signIn callback right after linkCorsairTenant,
//  * so every sign-in (re)registers subscriptions — Gmail watch expires after
//  * 7 days and Calendar push channels expire too, so periodic re-registration
//  * on login is a simple, durable renewal strategy without needing a cron job.
//  *
//  * DEFENSIVE BY DESIGN: Corsair plugin method names for watch/subscribe are
//  * not 100% guaranteed across versions. This service feature-detects the
//  * method before calling it, logs clearly what's available, and never
//  * throws — webhook registration failure must NEVER block sign-in.
//  */

// import { corsair, getTenant, getTenantId } from "./corsair";
// import { env } from "@/src/env";
// import { logger } from "@/src/lib/logger";

// function webhookCallbackUrl(tenantId: string): string {
//   const base = (env.NEXT_PUBLIC_APP_URL ?? env.NEXTAUTH_URL).replace(/\/$/, "");
//   return `${base}/api/webhooks?tenantId=${encodeURIComponent(tenantId)}`;
// }

// /**
//  * Safely call a method on a Corsair plugin API if it exists.
//  * Tries each candidate method name in order — different Corsair plugin
//  * versions may expose watch/subscribe under slightly different names.
//  */
// async function callFirstAvailable(
//   apiNamespace: Record<string, unknown> | undefined,
//   candidates: Array<{ resource: string; method: string; args: unknown }>,
// ): Promise<{ called: string; result: unknown } | null> {
//   if (!apiNamespace) return null;

//   for (const candidate of candidates) {
//     const resource = apiNamespace[candidate.resource] as
//       | Record<string, unknown>
//       | undefined;
//     if (!resource) continue;

//     const fn = resource[candidate.method];
//     if (typeof fn !== "function") continue;

//     try {
//       const result = await (fn as (args: unknown) => Promise<unknown>).call(
//         resource,
//         candidate.args,
//       );
//       return { called: `${candidate.resource}.${candidate.method}`, result };
//     } catch (err) {
//       logger.warn("Webhook subscription call failed, trying next candidate", {
//         attempted: `${candidate.resource}.${candidate.method}`,
//         error: String(err),
//       });
//       // try next candidate
//     }
//   }

//   return null;
// }

// /**
//  * Register a Gmail "watch" subscription for this user.
//  * Gmail's underlying API is users.watch — Corsair typically exposes this
//  * as messages.watch or mailbox.watch under gmail.api.
//  *
//  * Watch subscriptions expire after 7 days (Gmail API limit) — re-call
//  * this on every sign-in to keep it alive.
//  */
// export async function subscribeGmailWebhook(googleSub: string): Promise<boolean> {
//   const tenantId = getTenantId(googleSub);
//   const callbackUrl = webhookCallbackUrl(tenantId);

//   try {
//     const tenant = getTenant(googleSub);
//     const gmailApi = tenant.gmail.api as unknown as Record<string, unknown>;

//     const outcome = await callFirstAvailable(gmailApi, [
//       {
//         resource: "messages",
//         method: "watch",
//         args: { callbackUrl, labelIds: ["INBOX"] },
//       },
//       {
//         resource: "mailbox",
//         method: "watch",
//         args: { callbackUrl, labelIds: ["INBOX"] },
//       },
//       {
//         resource: "watch",
//         method: "create",
//         args: { callbackUrl, labelIds: ["INBOX"] },
//       },
//       {
//         resource: "subscriptions",
//         method: "create",
//         args: { callbackUrl, topic: "messageChanged" },
//       },
//     ]);

//     if (outcome) {
//       logger.info("Gmail webhook subscription registered", {
//         tenantId,
//         method: outcome.called,
//       });
//       return true;
//     }

//     logger.warn(
//       "Gmail webhook subscription skipped — no compatible watch/subscribe method found on tenant.gmail.api. " +
//         "Realtime Gmail updates will not work; the app falls back to on-demand fetch. " +
//         "Check @corsair-dev/gmail's exposed API surface for the correct method name and update subscribeGmailWebhook().",
//       { tenantId },
//     );
//     return false;
//   } catch (err) {
//     logger.error("Gmail webhook subscription failed", {
//       tenantId,
//       error: String(err),
//     });
//     return false;
//   }
// }

// /**
//  * Register a Google Calendar "push channel" subscription for this user's
//  * primary calendar. Underlying API is events.watch — Corsair typically
//  * exposes this as events.watch or calendar.watch under googlecalendar.api.
//  *
//  * Push channels expire (max 1 month for events) — re-call on every sign-in.
//  */
// export async function subscribeCalendarWebhook(googleSub: string): Promise<boolean> {
//   const tenantId = getTenantId(googleSub);
//   const callbackUrl = webhookCallbackUrl(tenantId);

//   try {
//     const tenant = getTenant(googleSub);
//     const calendarApi = tenant.googlecalendar.api as unknown as Record<string, unknown>;

//     const outcome = await callFirstAvailable(calendarApi, [
//       {
//         resource: "events",
//         method: "watch",
//         args: { calendarId: "primary", callbackUrl },
//       },
//       {
//         resource: "calendar",
//         method: "watch",
//         args: { calendarId: "primary", callbackUrl },
//       },
//       {
//         resource: "channels",
//         method: "create",
//         args: { calendarId: "primary", callbackUrl },
//       },
//       {
//         resource: "subscriptions",
//         method: "create",
//         args: { calendarId: "primary", callbackUrl, topic: "onEventChanged" },
//       },
//     ]);

//     if (outcome) {
//       logger.info("Calendar webhook subscription registered", {
//         tenantId,
//         method: outcome.called,
//       });
//       return true;
//     }

//     logger.warn(
//       "Calendar webhook subscription skipped — no compatible watch/subscribe method found on tenant.googlecalendar.api. " +
//         "Realtime Calendar updates will not work; the app falls back to on-demand fetch. " +
//         "Check @corsair-dev/googlecalendar's exposed API surface for the correct method name and update subscribeCalendarWebhook().",
//       { tenantId },
//     );
//     return false;
//   } catch (err) {
//     logger.error("Calendar webhook subscription failed", {
//       tenantId,
//       error: String(err),
//     });
//     return false;
//   }
// }

// /**
//  * Register both Gmail and Calendar webhook subscriptions for a user.
//  * Fire-and-forget — never blocks sign-in. Call from the NextAuth signIn
//  * callback right after linkCorsairTenant.
//  */
// export async function subscribeAllWebhooks(googleSub: string): Promise<void> {
//   const [gmail, calendar] = await Promise.all([
//     subscribeGmailWebhook(googleSub),
//     subscribeCalendarWebhook(googleSub),
//   ]);

//   logger.info("Webhook subscription summary", {
//     tenantId: getTenantId(googleSub),
//     gmail,
//     calendar,
//   });
// }

/**
 * Webhook subscription service.
 *
 * Registers Gmail "watch" and Google Calendar "push channel" subscriptions
 * so that incoming changes are POSTed to our single webhook endpoint
 * (/api/webhooks) in realtime — instead of polling.
 *
 * IMPORTANT — Gmail vs Calendar use DIFFERENT delivery mechanisms:
 *
 *   • Gmail can only push to a Google Cloud Pub/Sub TOPIC. There is no way
 *     to give Gmail's users.watch a plain HTTPS callback URL. You create one
 *     Pub/Sub topic + push subscription ONCE per Google Cloud project (the
 *     push subscription's endpoint URL is what points at our /api/webhooks
 *     route). After that one-time setup, the app only ever needs the topic
 *     NAME (GOOGLE_PUBSUB_TOPIC env var), which is the same for every tenant.
 *
 *   • Google Calendar's events.watch DOES accept a direct HTTPS callback
 *     URL per subscription, so we pass our own /api/webhooks URL straight
 *     to it, with the tenantId baked into the query string.
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

/**
 * Register a Gmail "watch" subscription for this user's INBOX.
 *
 * Underlying call: Gmail users.watch, exposed by Corsair as
 * `tenant.gmail.api.messages.watch({ topicName, labelIds })`.
 * Response shape: { historyId: string, expiration: string (epoch ms) }.
 *
 * We store both on the `users` row:
 *  - gmailHistoryId: cursor for history.list when a webhook fires later
 *  - gmailWatchExpiration: so the renewal job knows who's stale
 *
 * @param googleSub - Google `sub`, used as the Corsair tenant key.
 * @param dbUserId  - DB `users.id` (UUID) — the row we persist tracking
 *   fields on, since `users` is keyed by UUID, not by googleSub.
 */
export async function subscribeGmailWebhook(
  googleSub: string,
  dbUserId: string,
): Promise<boolean> {
  const tenantId = getTenantId(googleSub);

  try {
    const tenant = getTenant(googleSub);

    const watch = await tenant.gmail.api.messages.({
      topicName: env.GOOGLE_PUBSUB_TOPIC,
      labelIds: ["INBOX"],
    });

    tenant.gmail.pluginWebhookMatcher

    await db
      .update(users)
      .set({
        gmailHistoryId: String(watch.historyId),
        gmailWatchExpiration: new Date(Number(watch.expiration)),
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
 * Underlying call: Calendar events.watch, exposed by Corsair as
 * `tenant.googlecalendar.api.events.watch({ calendarId, callbackUrl })`.
 * Response includes a channel id + resourceId (needed to stop the
 * channel later) and an expiration timestamp.
 */
export async function subscribeCalendarWebhook(
  googleSub: string,
  dbUserId: string,
): Promise<boolean> {
  const tenantId = getTenantId(googleSub);
  const callbackUrl = webhookCallbackUrl(tenantId);

  try {
    const tenant = getTenant(googleSub);

    const channel = await tenant.googlecalendar.api.events.watch({
      calendarId: "primary",
      callbackUrl,
    });

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
  const [gmail, calendar] = await Promise.all([
    subscribeGmailWebhook(googleSub, dbUserId),
    subscribeCalendarWebhook(googleSub, dbUserId),
  ]);

  logger.info("Webhook subscription summary", {
    tenantId: getTenantId(googleSub),
    gmail,
    calendar,
  });
}