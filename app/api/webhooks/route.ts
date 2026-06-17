import { logger } from "@/src/lib/logger";
import { corsair } from "@/src/server/lib/corsair";
import { handleCalendarWebhook, handleGmailWebhook } from "@/src/server/webhooks";
import { processWebhook } from "corsair";
import { NextRequest, NextResponse } from "next/server";

import { withAuth } from "@/src/middleware/auth";
import { subscribeToUser } from "@/src/server/lib/sse";
import { getTenantId } from "@/src/server/lib/corsair";
import type { SSEEvent } from "@/src/types";

// ─── POST /api/webhooks — Corsair inbound webhook receiver ───────────────────

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get("tenantId");

    const headers = Object.fromEntries(request.headers);
    let body: Record<string, unknown> | string;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const result = await processWebhook(corsair, headers, body, {
      tenantId: tenantId ?? undefined,
    });

    logger.info("Webhook received", {
      plugin: result.plugin,
      action: result.action,
      tenantId,
    });

    if (result.plugin === "gmail" && tenantId) {
      await handleGmailWebhook(tenantId, body as Record<string, unknown>);
    }

    if (result.plugin === "googlecalendar" && tenantId) {
      await handleCalendarWebhook(tenantId, body as Record<string, unknown>);
    }

    return result.response;
  } catch (err) {
    logger.error("Webhook processing failed", { error: String(err) });
    // Always 200 — prevents Google from retrying indefinitely
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