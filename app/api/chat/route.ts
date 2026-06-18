

/**
 * POST /api/chat — streaming agent response via Server-Sent Events
 *
 * The chat service now handles routing internally:
 *   gpt-oss-120b router → chat (gpt-oss-120b) | agent (claude/openai/vercel)
 *
 * No modelKey override needed — provider is set via LLM_PROVIDER_FOR_AGENT env var.
 */

import { handleRouteError } from "@/src/lib/api-response";
import { withAuth } from "@/src/middleware/auth";
import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from "@/src/middleware/rate-limit";
import { ChatMessageSchema } from "@/src/schema";
import { streamCommand } from "@/src/server/services/chat.service";
import { NextRequest } from "next/server";

export const POST = withAuth(async (req) => {
  try {
    await checkRateLimit(getRateLimitKey(req as NextRequest, req.user.id), RATE_LIMITS.chat);

    const body = await req.json();
    const input = ChatMessageSchema.parse(body);

    const {
      id: userId,
      googleSub: tenantId,
      email: userEmail,
    } = req.user;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamCommand(tenantId, userId, userEmail, input)) {
            const data = `data: ${JSON.stringify({ type: "text", content: chunk })}\n\n`;
            controller.enqueue(encoder.encode(data));
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`),
          );
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
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
});