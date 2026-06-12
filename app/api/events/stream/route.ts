import { authConfig } from "@/src/auth/config";
import { logger } from "@/src/lib/logger";
import { subscribeToUser } from "@/src/server/lib/sse";
import { SSEEvent } from "@/src/types";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";


/**
 * GET /api/events/stream
 *
 * Server-Sent Events endpoint for real-time inbox/calendar updates.
 * Frontend connects with EventSource and listens for:
 * - "new_email" — triggers inbox refetch
 * - "new_event" — triggers calendar refetch
 * - "heartbeat" — keep-alive every 30s
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authConfig);
 
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }
 
  const userId = session.user.id;
  const encoder = new TextEncoder();
 
  logger.info("SSE client connected", { userId });
 
  let unsubscribe: (() => void) | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
 
  const stream = new ReadableStream({
    start(controller) {
      function send(event: SSEEvent) {
        try {
          const data = `event: ${event.type}\ndata: ${JSON.stringify(event.data ?? {})}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch {
          // Client disconnected
        }
      }
 
      // Subscribe to user-specific SSE events
      unsubscribe = subscribeToUser(userId, send);
 
      // Heartbeat every 30s to keep connection alive through proxies
      heartbeatInterval = setInterval(() => {
        send({ type: "heartbeat" });
      }, 30_000);
 
      // Send initial connection confirmation
      send({ type: "heartbeat" });
    },
 
    cancel() {
      logger.info("SSE client disconnected", { userId });
      if (unsubscribe) unsubscribe();
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    },
  });
 
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
 