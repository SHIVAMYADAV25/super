// // import { authConfig } from "@/src/auth/config";
// // import { logger } from "@/src/lib/logger";
// // import { subscribeToUser } from "@/src/server/lib/sse";
// // import { SSEEvent } from "@/src/types";
// // import { getServerSession } from "next-auth";
// // import { NextRequest } from "next/server";


// // /**
// //  * GET /api/events/stream
// //  *
// //  * Server-Sent Events endpoint for real-time inbox/calendar updates.
// //  * Frontend connects with EventSource and listens for:
// //  * - "new_email" — triggers inbox refetch
// //  * - "new_event" — triggers calendar refetch
// //  * - "heartbeat" — keep-alive every 30s
// //  */
// // export async function GET(request: NextRequest) {
// //   const session = await getServerSession(authConfig);
 
// //   if (!session?.user?.id) {
// //     return new Response("Unauthorized", { status: 401 });
// //   }
 
// //   const userId = session.user.id;
// //   // conert string into bytes
// //   const encoder = new TextEncoder();
 
// //   logger.info("SSE client connected", { userId });
 
// //   let unsubscribe: (() => void) | null = null;
// //   let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
 
// //   //Infinite Response
// //   const stream = new ReadableStream({
// //     start(controller) { // Runs when browser connects.
// //       function send(event: SSEEvent) {  // Send Event To Browser
// // //         {
// // //   type:"new_email",
// // //   data:{
// // //     id:"123"
// // //   }
// // // }
        
// //         try {
// //           //This is actual SSE format.
// //           const data = `event: ${event.type}\ndata: ${JSON.stringify(event.data ?? {})}\n\n`;
// //           controller.enqueue(encoder.encode(data)); // push data into stream
// //         } catch {
// //           // Client disconnected
// //         }
// //       }
 
// //       // Subscribe to user-specific SSE events
// //       unsubscribe = subscribeToUser(userId, send);
 
// //       // Heartbeat every 30s to keep connection alive through proxies
// //       heartbeatInterval = setInterval(() => {
// //         send({ type: "heartbeat" });
// //       }, 30_000);
 
// //       // Send initial connection confirmation
// //       send({ type: "heartbeat" });
// //     },
 
// //     // Runs when connection closes.
// //     cancel() {
// //       logger.info("SSE client disconnected", { userId });
// //       if (unsubscribe) unsubscribe(); // === emitter.off(...)
// //       if (heartbeatInterval) clearInterval(heartbeatInterval); // Again prevents memory leaks.
// //     },
// //   });
 
// //   return new Response(stream, {
// //     headers: {
// //       "Content-Type": "text/event-stream",
// //       "Cache-Control": "no-cache, no-store, must-revalidate",
// //       Connection: "keep-alive",
// //       "X-Accel-Buffering": "no",
// //     },
// //   });
// // }
 

// import { authConfig } from "@/src/auth/config";
// import { logger } from "@/src/lib/logger";
// import { subscribeToUser } from "@/src/server/lib/sse";
// import { getTenantId } from "@/src/server/lib/corsair";
// import { SSEEvent } from "@/src/types";
// import { getServerSession } from "next-auth";
// import { NextRequest } from "next/server";


// /**
//  * GET /api/events/stream
//  *
//  * Server-Sent Events endpoint for real-time inbox/calendar updates.
//  * Frontend connects with EventSource and listens for:
//  * - "new_email" — triggers inbox refetch
//  * - "new_event" — triggers calendar refetch
//  * - "heartbeat" — keep-alive every 30s
//  */


// export async function GET(request: NextRequest) {
//   const session = await getServerSession(authConfig);
 
//   if (!session?.user?.id || !session.user.googleSub) {
//     return new Response("Unauthorized", { status: 401 });
//   }
 
//   // Subscribe by Corsair tenantId (user_<googleSub>) — webhooks emit to this
//   // same key via emitToUser(tenantId, ...), so SSE and webhooks stay in sync.
//   const channelKey = getTenantId(session.user.googleSub);
//   const userId = session.user.id; // for logging only
//   // conert string into bytes
//   const encoder = new TextEncoder();
 
//   logger.info("SSE client connected", { userId });
 
//   let unsubscribe: (() => void) | null = null;
//   let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
 
//   //Infinite Response
//   const stream = new ReadableStream({
//     start(controller) { // Runs when browser connects.
//       function send(event: SSEEvent) {  // Send Event To Browser
// //         {
// //   type:"new_email",
// //   data:{
// //     id:"123"
// //   }
// // }
        
//         try {
//           //This is actual SSE format.
//           const data = `event: ${event.type}\ndata: ${JSON.stringify(event.data ?? {})}\n\n`;
//           controller.enqueue(encoder.encode(data)); // push data into stream
//         } catch {
//           // Client disconnected
//         }
//       }
 
//       // Subscribe to user-specific SSE events
//       unsubscribe = subscribeToUser(channelKey, send);
 
//       // Heartbeat every 30s to keep connection alive through proxies
//       heartbeatInterval = setInterval(() => {
//         send({ type: "heartbeat" });
//       }, 30_000);
 
//       // Send initial connection confirmation
//       send({ type: "heartbeat" });
//     },
 
//     // Runs when connection closes.
//     cancel() {
//       logger.info("SSE client disconnected", { userId });
//       if (unsubscribe) unsubscribe(); // === emitter.off(...)
//       if (heartbeatInterval) clearInterval(heartbeatInterval); // Again prevents memory leaks.
//     },
//   });
 
//   return new Response(stream, {
//     headers: {
//       "Content-Type": "text/event-stream",
//       "Cache-Control": "no-cache, no-store, must-revalidate",
//       Connection: "keep-alive",
//       "X-Accel-Buffering": "no",
//     },
//   });
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