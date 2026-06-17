

// // Singleton in-process emitter
// // For multi-instance deployments, replace with Redis pub/sub

// import { logger } from "@/src/lib/logger";
// import { SSEEvent } from "@/src/types";
// import { EventEmitter } from "events";

// const globalForSSE = globalThis as unknown as {sseEmitter : EventEmitter | undefined};

// const emitter : EventEmitter =
// globalForSSE.sseEmitter ?? 
// (() => {
//     const e = new EventEmitter();
//     e.setMaxListeners(1000) //  support many concurrent users
//     return e;
// })();

// if(process.env.NODE_ENV !== "production"){
//     globalForSSE.sseEmitter = emitter;
// }

// /**
//  * Emit an SSE event to a specific user's stream.
//  */

// export function emitToUser(userId : string,event : SSEEvent):void{
//     emitter.emit(`user:${userId}`,event)
// };

// /**
//  * Subscribe to SSE events for a user.
//  * Returns an unsubscribe function.
//  */

// export function subscribeToUser(
//     userId: string,
//     handler : (event : SSEEvent) => void,
// ):()=>void{
//     const channel = `user:${userId}`;

//     emitter.on(channel,handler);
//     logger.debug("SSE subscriber added", { userId });

//     return () => {
//         emitter.off(channel,handler);
//         logger.debug("SSE subscriber removed", { userId });
//     }
// }

// // src/server/lib/sse.ts
// //
// // BUG FIXED: The old code used @upstash/redis (REST-over-HTTPS) to PUBLISH
// // but ioredis (raw TCP) to SUBSCRIBE. These are two completely different
// // connections — a REST publish never reaches a TCP subscriber.
// //
// // FIX: Use ioredis for BOTH publish and subscribe.
// // Upstash provides an ioredis-compatible rediss:// URL — add
// // UPSTASH_REDIS_URL to your .env (get it from Upstash dashboard →
// // your database → "Connect" → "ioredis").
// //
// // env.ts addition needed:
// //   UPSTASH_REDIS_URL: z.string().url(),
// // runtimeEnv addition needed:
// //   UPSTASH_REDIS_URL: process.env.UPSTASH_REDIS_URL,

// // import Redis from "ioredis";
// // import type { SSEEvent } from "@/src/types";

// // type SSEHandler = (event: SSEEvent) => void;
// // const localSubs = new Map<string, Set<SSEHandler>>();

// // // Two separate ioredis clients are required:
// // // - redisPub: for PUBLISH commands
// // // - redisSub: for SUBSCRIBE commands
// // // Redis protocol does not allow a subscribed client to issue other commands.
// // const redisPub = new Redis(process.env.UPSTASH_REDIS_URL!);
// // const redisSub = new Redis(process.env.UPSTASH_REDIS_URL!);
// // console.log("UPSTASH_REDIS_URL =", process.env.UPSTASH_REDIS_URL);

// // redisSub.on("message", (channel: string, message: string) => {
// //   try {
// //     const event = JSON.parse(message) as SSEEvent;
// //     localSubs.get(channel)?.forEach((h) => h(event));
// //   } catch {
// //     // ignore malformed messages
// //   }
// // });

// // export function subscribeToUser(tenantId: string, handler: SSEHandler): () => void {
// //   if (!localSubs.has(tenantId)) {
// //     localSubs.set(tenantId, new Set());
// //     void redisSub.subscribe(tenantId);
// //   }
// //   localSubs.get(tenantId)!.add(handler);

// //   return () => {
// //     localSubs.get(tenantId)?.delete(handler);
// //     if (localSubs.get(tenantId)?.size === 0) {
// //       localSubs.delete(tenantId);
// //       void redisSub.unsubscribe(tenantId);
// //     }
// //   };
// // }

// // export function emitToUser(tenantId: string, event: SSEEvent): void {
// //   // Now uses ioredis publish — reaches the ioredis subscriber above.
// //   void redisPub.publish(tenantId, JSON.stringify(event));
// // }

import { EventEmitter } from "events";
import { logger } from "@/src/lib/logger";
import type { SSEEvent } from "@/src/types";

const isProd = process.env.NODE_ENV === "production";

/* -------------------------------------------------------------------------- */
/*                                DEVELOPMENT                                 */
/* -------------------------------------------------------------------------- */

const globalForSSE = globalThis as unknown as {
  sseEmitter?: EventEmitter;
};

const emitter =
  globalForSSE.sseEmitter ??
  (() => {
    const e = new EventEmitter();
    e.setMaxListeners(1000);
    return e;
  })();

if (!isProd) {
  globalForSSE.sseEmitter = emitter;
}

/* -------------------------------------------------------------------------- */
/*                                 PRODUCTION                                 */
/* -------------------------------------------------------------------------- */

let redisPub: any = null;
let redisSub: any = null;

if (isProd) {
  const Redis = require("ioredis");

  redisPub = new Redis(process.env.UPSTASH_REDIS_URL!);
  redisSub = new Redis(process.env.UPSTASH_REDIS_URL!);
}

type SSEHandler = (event: SSEEvent) => void;

const localSubs = new Map<string, Set<SSEHandler>>();

if (isProd && redisSub) {
  redisSub.on("message", (channel: string, message: string) => {
    try {
      const event = JSON.parse(message) as SSEEvent;

      localSubs.get(channel)?.forEach((handler) => {
        handler(event);
      });
    } catch (error) {
      logger.error("Failed to process SSE Redis message", {
        error: String(error),
      });
    }
  });
}

/* -------------------------------------------------------------------------- */
/*                                   PUBLIC                                   */
/* -------------------------------------------------------------------------- */

export function emitToUser(
  channel: string,
  event: SSEEvent,
): void {
  if (!isProd) {
    emitter.emit(`user:${channel}`, event);
    return;
  }

  void redisPub.publish(
    channel,
    JSON.stringify(event),
  );
}

export function subscribeToUser(
  channel: string,
  handler: SSEHandler,
): () => void {
  if (!isProd) {
    const eventName = `user:${channel}`;

    emitter.on(eventName, handler);

    return () => {
      emitter.off(eventName, handler);
    };
  }

  if (!localSubs.has(channel)) {
    localSubs.set(channel, new Set());

    void redisSub.subscribe(channel);
  }

  localSubs.get(channel)!.add(handler);

  return () => {
    const handlers = localSubs.get(channel);

    if (!handlers) return;

    handlers.delete(handler);

    if (handlers.size === 0) {
      localSubs.delete(channel);

      void redisSub.unsubscribe(channel);
    }
  };
}