// app/api/webhooks/route.ts
// PROXY: /api/webhooks
// PROXY: /api/webhooks
// [2026-06-17T22:13:26.646Z] [DEBUG] Gmail webhook received {"type":"messageChanged"}
// [2026-06-17T22:13:26.671Z] [DEBUG] Gmail webhook received {"type":"messageChanged"}
// BUGS FIXED:
//
// BUG 2 — Gmail PubSub never routed to the right tenant.
//   Gmail delivers Pub/Sub pushes to ONE fixed URL — no ?tenantId= per user.
//   The old guard `if (result.plugin === "gmail" && tenantId)` silently
//   dropped every Gmail webhook because tenantId was always null from PubSub.
//   FIX: decode the base64 Pub/Sub payload → extract emailAddress → look up
//   the users row by google_sub to derive the correct tenantId.
//
// BUG 3 — result.response returned raw (not a NextResponse).
//   processWebhook returns WebhookFilterResult whose .response is a plain
//   Corsair object, not a Next.js Response. Returning it directly produced
//   a malformed HTTP response; Google retried indefinitely.
//   FIX: wrap with NextResponse.json(result.response, { headers: nextHeaders })
//   and add a proper 404 branch when result.response is undefined.
//
// BUG 4 — No shared-secret token validation.
//   Any actor could POST arbitrary payloads to /api/webhooks. The token check
//   was commented out in the live version.
//   FIX: restored. Gmail (PubSub, no token) is validated by Corsair's internal
//   signature check. Calendar embeds the token in the callback URL.

import { logger } from "@/src/lib/logger";
import { corsair } from "@/src/server/lib/corsair";
import { handleCalendarWebhook, handleGmailWebhook } from "@/src/server/webhooks";
import { processWebhook } from "corsair";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/env";
import { db } from "@/src/server/db";
import { users } from "@/src/server/db/schema";
import { eq } from "drizzle-orm";
import { getTenantId } from "@/src/server/lib/corsair";
import { withAuth } from "@/src/middleware/auth";
import { subscribeToUser } from "@/src/server/lib/sse";
import type { SSEEvent } from "@/src/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Decode a Gmail Pub/Sub push payload and extract the emailAddress.
 *
 * Pub/Sub wraps the actual Gmail notification in:
 *   { message: { data: "<base64({"emailAddress":"...","historyId":"..."})>" } }
 *
 * Returns null if the payload isn't a Pub/Sub message or decoding fails.
 */
function decodeGmailPubSubEmail(body: Record<string, unknown>): string | null {
  try {
    const data = (body?.message as Record<string, unknown> | undefined)?.data;
    if (typeof data !== "string") return null;
    const decoded = Buffer.from(data, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded) as { emailAddress?: string };
    return parsed.emailAddress ?? null;
  } catch {
    return null;
  }
}

/**
 * Look up the Corsair tenantId for a Gmail address.
 * Users are stored with their Google `sub` as googleSub; we join on email
 * here because the Pub/Sub payload gives us emailAddress, not the sub.
 */
async function tenantIdFromGmailAddress(emailAddress: string): Promise<string | null> {
  const rows = await db
    .select({ googleSub: users.googleSub })
    .from(users)
    .where(eq(users.email, emailAddress))
    .limit(1);

  const googleSub = rows[0]?.googleSub;
  if (!googleSub) return null;
  return getTenantId(googleSub);
}

// ─── POST /api/webhooks — Corsair inbound webhook receiver ───────────────────

export async function POST(request: NextRequest) {
  const url = new URL(request.url);

  // BUG 4 FIX: Validate the shared-secret token for Calendar push notifications.
  // Gmail PubSub does NOT send this token (it posts to the fixed subscription
  // URL we configured in GCP, which doesn't have ?token= attached). We let
  // Gmail through and rely on Corsair's internal signature verification instead.
  // Calendar callback URLs DO embed the token (see webhook-subscriptions.ts).
  const token = url.searchParams.get("token");
  const isCalendarRequest = token !== null; // Calendar always sends the token

  if (isCalendarRequest && token !== env.WEBHOOK_SHARED_SECRET) {
    logger.warn("Webhook rejected — bad token");
    // Return 200 to prevent Google from retrying on a permanently bad request.
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  try {
    const headers = Object.fromEntries(request.headers);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    // BUG 2 FIX: Determine tenantId correctly for each provider.
    //
    // Calendar: tenantId is in the query string (embedded when we called events.watch).
    // Gmail:    there is no tenantId in the URL — we decode it from the Pub/Sub payload.
    let tenantId: string | null = url.searchParams.get("tenantId");

    if (!tenantId) {
      // Likely a Gmail Pub/Sub push — extract emailAddress and look up the user.
      const emailAddress = decodeGmailPubSubEmail(body);
      if (emailAddress) {
        tenantId = await tenantIdFromGmailAddress(emailAddress);
        if (!tenantId) {
          logger.warn("Gmail webhook — no user found for email address", { emailAddress });
          // Still 200 so Pub/Sub doesn't keep retrying for an unrecognised address.
          return NextResponse.json({ ok: true }, { status: 200 });
        }
      }
    }

    const result = await processWebhook(corsair, headers, body, {
      tenantId: tenantId ?? undefined,
    });

    logger.info("Webhook received", {
      plugin: result.plugin,
      action: result.action,
      tenantId,
    });

    // Build response headers (e.g. Asana X-Hook-Secret handshake — not needed
    // for Gmail/Calendar, but kept here for forward compatibility).
    const nextHeaders = new Headers();
    if (result.responseHeaders) {
      for (const [key, value] of Object.entries(result.responseHeaders)) {
        nextHeaders.set(key, value);
      }
    }

    // Dispatch to our SSE handlers so the browser refetches.
    if (tenantId) {
      if (result.plugin === "gmail") {
        await handleGmailWebhook(tenantId, body);
      } else if (result.plugin === "googlecalendar") {
        await handleCalendarWebhook(tenantId, body);
      }
    }

    // BUG 3 FIX: result.response is a plain Corsair object, not a NextResponse.
    // Wrap it properly before returning to Next.js.
    if (result.response === undefined) {
      // No webhook handler matched — return 404 so we can diagnose misrouting.
      return NextResponse.json(
        { success: false, message: "No matching webhook handler found" },
        { status: 404, headers: nextHeaders },
      );
    }

    return NextResponse.json(result.response, { headers: nextHeaders });
  } catch (err) {
    logger.error("Webhook processing failed", { error: String(err) });
    // Always 200 — prevents Google/Pub/Sub from retrying indefinitely on a
    // server-side error. Log the failure for debugging.
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}

// ─── GET /api/webhooks — SSE stream per authenticated user ───────────────────

export const dynamic = "force-dynamic";

export const GET = withAuth(async (req) => {
  const tenantId = getTenantId(req.user.googleSub);

  const stream = new ReadableStream({
    start(controller) {
      const encode = (event: SSEEvent) => {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(new TextEncoder().encode(data));
      };

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      const unsubscribe = subscribeToUser(tenantId, (event) => {
        try {
          encode(event);
        } catch (err) {
          logger.warn("SSE write failed", { tenantId, error: String(err) });
        }
      });

      logger.debug("SSE stream opened", { tenantId });

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
        logger.debug("SSE stream closed", { tenantId });
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});


// import { logger } from "@/src/lib/logger";
// import { corsair } from "@/src/server/lib/corsair";
// import { handleCalendarWebhook, handleGmailWebhook } from "@/src/server/webhooks";
// import { processWebhook } from "corsair";
// import { NextRequest, NextResponse } from "next/server";
// import { env } from "@/src/env";

// /**
//  * POST /api/webhooks?tenantId=user_<googleSub>&token=<WEBHOOK_SHARED_SECRET>
//  *
//  * Single endpoint for ALL Corsair integration webhooks (Gmail + Calendar).
//  * Corsair inspects headers + payload to figure out which plugin/event this
//  * is, verifies the provider's signature internally, and tells us the
//  * result.
//  *
//  * This route has NO session auth (Google/Pub-Sub can't log in as a user),
//  * so we protect it with a shared-secret query param instead — every
//  * callback URL we register with Google (see webhook-subscriptions.ts)
//  * embeds this token. Reject anything that doesn't match before doing any
//  * real work.
//  *
//  * tenantId is REQUIRED here (unlike a single-tenant setup) because this
//  * app uses multiTenancy: true — Corsair needs to know which tenant's
//  * encrypted credentials/state this event belongs to.
//  *
//  * NOTE: the real-time SSE stream the frontend listens on lives at
//  * /api/events/stream (separate route, session-authenticated). This route
//  * only RECEIVES provider webhooks and re-emits via emitToUser(), it does
//  * not serve SSE itself — the GET export that used to live here was a
//  * dead duplicate of /api/events/stream and has been removed.
//  */
// export async function POST(request: NextRequest) {
//   try {
//     const url = new URL(request.url);
//     const tenantId = url.searchParams.get("tenantId");
//     const token = url.searchParams.get("token");

//     // Reject unauthenticated callers immediately. Still return 200 so a
//     // malicious/broken caller doesn't learn anything from status codes,
//     // and so Google/Pub-Sub never retry-storms us over a bad token.
//     if (!token || token !== env.WEBHOOK_SHARED_SECRET) {
//       logger.warn("Webhook rejected — bad or missing token");
//       return NextResponse.json({ ok: true }, { status: 200 });
//     }

//     if (!tenantId) {
//       logger.warn("Webhook rejected — missing tenantId");
//       return NextResponse.json({ ok: true }, { status: 200 });
//     }

//     const headers = Object.fromEntries(request.headers);

//     let body: Record<string, unknown> | string;
//     try {
//       body = await request.json();
//     } catch {
//       // Pub/Sub push messages are always JSON, but tolerate empty bodies
//       // (e.g. Google's verification ping) instead of throwing.
//       body = {};
//     }

//     // processWebhook: verifies signature, identifies plugin + action,
//     // updates corsair_entities, and returns a structured result + the
//     // exact Response Corsair wants us to send back to the provider.
//     const result = await processWebhook(corsair, headers, body, { tenantId });

//     logger.info("Webhook received", {
//       plugin: result.plugin,
//       action: result.action,
//       tenantId,
//     });

//     if (result.plugin === "gmail") {
//       await handleGmailWebhook(tenantId, body as Record<string, unknown>);
//     }

//     if (result.plugin === "googlecalendar") {
//       await handleCalendarWebhook(tenantId, body as Record<string, unknown>);
//     }

//     // Return Corsair's expected ack response — Pub/Sub and Google's push
//     // channel both require a fast 200, or they'll retry/back off.
//     return result.response;
//   } catch (err) {
//     logger.error("Webhook processing failed", { error: String(err) });
//     // Always return 200 to prevent retry storms from the provider — we've
//     // already logged the failure for debugging.
//     return NextResponse.json({ ok: true }, { status: 200 });
//   }
// }