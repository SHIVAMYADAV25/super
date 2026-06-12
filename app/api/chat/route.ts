import { handleRouteError } from "@/src/lib/api-response";
import { withAuth } from "@/src/middleware/auth";
import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from "@/src/middleware/rate-limit";
import { ChatMessageSchema } from "@/src/schema";
import { streamCommand } from "@/src/server/services/chat.service";
import { NextRequest } from "next/server";


// POST /api/chat — streaming agent response
export const POST = withAuth(async (req) => {
  try {
    checkRateLimit(getRateLimitKey(req as NextRequest, req.user.id), RATE_LIMITS.chat);
 
    const body = await req.json();
    const input = ChatMessageSchema.parse(body);
 
    // Stream the agent response as Server-Sent Events
    const encoder = new TextEncoder();
 
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamCommand(req.user.id, input)) {
            // SSE format: "data: <text>\n\n"
            const data = `data: ${JSON.stringify({ type: "text", content: chunk })}\n\n`;
            controller.enqueue(encoder.encode(data));
          }
          // Signal completion
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Agent error";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", message: errMsg })}\n\n`),
          );
        } finally {
          controller.close();
        }
      },
    });
 
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // disable nginx buffering
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
});
 