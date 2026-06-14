/**
 * Webhook subscription service.
 *
 * Registers Gmail "watch" and Google Calendar "push channel" subscriptions
 * with Corsair so that incoming changes are POSTed to our single webhook
 * endpoint (/api/webhooks) in realtime — instead of polling.
 *
 * Callback URL format: ${NEXT_PUBLIC_APP_URL}/api/webhooks?tenantId=<corsairTenantId>
 * where corsairTenantId === "user_<googleSub>" (getTenantId(googleSub)) —
 * the SAME key used everywhere else (see corsair.ts, oauth-callback, SSE stream).
 *
 * Called from the NextAuth signIn callback right after linkCorsairTenant,
 * so every sign-in (re)registers subscriptions — Gmail watch expires after
 * 7 days and Calendar push channels expire too, so periodic re-registration
 * on login is a simple, durable renewal strategy without needing a cron job.
 *
 * DEFENSIVE BY DESIGN: Corsair plugin method names for watch/subscribe are
 * not 100% guaranteed across versions. This service feature-detects the
 * method before calling it, logs clearly what's available, and never
 * throws — webhook registration failure must NEVER block sign-in.
 */

import { corsair, getTenant, getTenantId } from "./corsair";
import { env } from "@/src/env";
import { logger } from "@/src/lib/logger";

function webhookCallbackUrl(tenantId: string): string {
  const base = (env.NEXT_PUBLIC_APP_URL ?? env.NEXTAUTH_URL).replace(/\/$/, "");
  return `${base}/api/webhooks?tenantId=${encodeURIComponent(tenantId)}`;
}

/**
 * Safely call a method on a Corsair plugin API if it exists.
 * Tries each candidate method name in order — different Corsair plugin
 * versions may expose watch/subscribe under slightly different names.
 */
async function callFirstAvailable(
  apiNamespace: Record<string, unknown> | undefined,
  candidates: Array<{ resource: string; method: string; args: unknown }>,
): Promise<{ called: string; result: unknown } | null> {
  if (!apiNamespace) return null;

  for (const candidate of candidates) {
    const resource = apiNamespace[candidate.resource] as
      | Record<string, unknown>
      | undefined;
    if (!resource) continue;

    const fn = resource[candidate.method];
    if (typeof fn !== "function") continue;

    try {
      const result = await (fn as (args: unknown) => Promise<unknown>).call(
        resource,
        candidate.args,
      );
      return { called: `${candidate.resource}.${candidate.method}`, result };
    } catch (err) {
      logger.warn("Webhook subscription call failed, trying next candidate", {
        attempted: `${candidate.resource}.${candidate.method}`,
        error: String(err),
      });
      // try next candidate
    }
  }

  return null;
}

/**
 * Register a Gmail "watch" subscription for this user.
 * Gmail's underlying API is users.watch — Corsair typically exposes this
 * as messages.watch or mailbox.watch under gmail.api.
 *
 * Watch subscriptions expire after 7 days (Gmail API limit) — re-call
 * this on every sign-in to keep it alive.
 */
export async function subscribeGmailWebhook(googleSub: string): Promise<boolean> {
  const tenantId = getTenantId(googleSub);
  const callbackUrl = webhookCallbackUrl(tenantId);

  try {
    const tenant = getTenant(googleSub);
    const gmailApi = tenant.gmail.api as unknown as Record<string, unknown>;

    const outcome = await callFirstAvailable(gmailApi, [
      {
        resource: "messages",
        method: "watch",
        args: { callbackUrl, labelIds: ["INBOX"] },
      },
      {
        resource: "mailbox",
        method: "watch",
        args: { callbackUrl, labelIds: ["INBOX"] },
      },
      {
        resource: "watch",
        method: "create",
        args: { callbackUrl, labelIds: ["INBOX"] },
      },
      {
        resource: "subscriptions",
        method: "create",
        args: { callbackUrl, topic: "messageChanged" },
      },
    ]);

    if (outcome) {
      logger.info("Gmail webhook subscription registered", {
        tenantId,
        method: outcome.called,
      });
      return true;
    }

    logger.warn(
      "Gmail webhook subscription skipped — no compatible watch/subscribe method found on tenant.gmail.api. " +
        "Realtime Gmail updates will not work; the app falls back to on-demand fetch. " +
        "Check @corsair-dev/gmail's exposed API surface for the correct method name and update subscribeGmailWebhook().",
      { tenantId },
    );
    return false;
  } catch (err) {
    logger.error("Gmail webhook subscription failed", {
      tenantId,
      error: String(err),
    });
    return false;
  }
}

/**
 * Register a Google Calendar "push channel" subscription for this user's
 * primary calendar. Underlying API is events.watch — Corsair typically
 * exposes this as events.watch or calendar.watch under googlecalendar.api.
 *
 * Push channels expire (max 1 month for events) — re-call on every sign-in.
 */
export async function subscribeCalendarWebhook(googleSub: string): Promise<boolean> {
  const tenantId = getTenantId(googleSub);
  const callbackUrl = webhookCallbackUrl(tenantId);

  try {
    const tenant = getTenant(googleSub);
    const calendarApi = tenant.googlecalendar.api as unknown as Record<string, unknown>;

    const outcome = await callFirstAvailable(calendarApi, [
      {
        resource: "events",
        method: "watch",
        args: { calendarId: "primary", callbackUrl },
      },
      {
        resource: "calendar",
        method: "watch",
        args: { calendarId: "primary", callbackUrl },
      },
      {
        resource: "channels",
        method: "create",
        args: { calendarId: "primary", callbackUrl },
      },
      {
        resource: "subscriptions",
        method: "create",
        args: { calendarId: "primary", callbackUrl, topic: "onEventChanged" },
      },
    ]);

    if (outcome) {
      logger.info("Calendar webhook subscription registered", {
        tenantId,
        method: outcome.called,
      });
      return true;
    }

    logger.warn(
      "Calendar webhook subscription skipped — no compatible watch/subscribe method found on tenant.googlecalendar.api. " +
        "Realtime Calendar updates will not work; the app falls back to on-demand fetch. " +
        "Check @corsair-dev/googlecalendar's exposed API surface for the correct method name and update subscribeCalendarWebhook().",
      { tenantId },
    );
    return false;
  } catch (err) {
    logger.error("Calendar webhook subscription failed", {
      tenantId,
      error: String(err),
    });
    return false;
  }
}

/**
 * Register both Gmail and Calendar webhook subscriptions for a user.
 * Fire-and-forget — never blocks sign-in. Call from the NextAuth signIn
 * callback right after linkCorsairTenant.
 */
export async function subscribeAllWebhooks(googleSub: string): Promise<void> {
  const [gmail, calendar] = await Promise.all([
    subscribeGmailWebhook(googleSub),
    subscribeCalendarWebhook(googleSub),
  ]);

  logger.info("Webhook subscription summary", {
    tenantId: getTenantId(googleSub),
    gmail,
    calendar,
  });
}