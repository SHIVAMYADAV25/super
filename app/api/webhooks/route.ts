// import { logger } from "@/src/lib/logger";
// import { corsair } from "@/src/server/lib/corsair";
// import { handleCalendarWebhook, handleGmailWebhook } from "@/src/server/webhooks";
// import { processWebhook } from "corsair";
// import { NextRequest, NextResponse } from "next/server";

// /**
//  * POST /api/webhooks
//  *
//  * Single endpoint for ALL Corsair integration webhooks.
//  * Corsair automatically routes by inspecting headers + payload.
//  * Signature verification is handled inside processWebhook.
//  *
//  * This route is PUBLIC — no auth middleware — but Corsair
//  * verifies the webhook signature to prevent spoofing.
//  *
//  * For multi-tenant setup, pass tenantId as a query param:
//  *   /api/webhooks?tenantId=hashed_user_id
//  */

// export async function POST(request : NextRequest) {
//     try {
//         const url = new URL(request.url);
//         const tenantId = url.searchParams.get("tenantId");

//         const headers = Object.fromEntries(request.headers);
//         let body: Record<string, unknown> | string;

//         try{
//             body = await request.json();
//         }catch{
//             body = {};
//         }

//         // processWebhook: verifies signature, identifies plugin + action,
//         // updates corsair_entities, and returns structured result

//         const result = await processWebhook(corsair, headers, body, {
//                             tenantId: tenantId ?? undefined,
//                         });

//         logger.info("Webhook received", {
//                 plugin: result.plugin,
//                 action: result.action,
//                 tenantId,
//             });

//         if(result.plugin === "gmail" && tenantId){
//             await handleGmailWebhook(tenantId,body as Record<string, unknown>);
//         }

//         if (result.plugin === "googlecalendar" && tenantId) {
//             await handleCalendarWebhook(tenantId, body as Record<string, unknown>);
//         }

//         // Return Corsair's expected response (200 with its ack format)
//         return result.response;
//     } catch (err) {
//         logger.error("Webhook processing failed", { error: String(err) });
//         // Always return 200 to prevent retry storms from the provider
//         return NextResponse.json({ ok: true }, { status: 200 });
//     }
// }

/**
 * GET /api/events/stream
 *
 * Server-Sent Events stream per authenticated user.
 * The client holds one long-lived connection here; the server pushes
 * "email_enriched" and "new_email" events as they occur so the UI
 * can update individual rows without a full refetch.
 */

import { withAuth } from "@/src/middleware/auth";
import { subscribeToUser } from "@/src/server/lib/sse";
import { getTenantId } from "@/src/server/lib/corsair";
import { logger } from "@/src/lib/logger";
import type { SSEEvent } from "@/src/types";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (req) => {
  const tenantId = getTenantId(req.user.googleSub);

  const stream = new ReadableStream({
    start(controller) {
      // Send a heartbeat immediately so the connection is confirmed alive.
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

      // Clean up when the client disconnects
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
      "X-Accel-Buffering": "no", // disable nginx buffering
    },
  });
});