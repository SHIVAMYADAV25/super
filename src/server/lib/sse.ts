

// import { EventEmitter } from "events";
// import { logger } from "@/src/lib/logger";
// import type { SSEEvent } from "@/src/types";

// const isProd = process.env.NODE_ENV === "production";

// /* -------------------------------------------------------------------------- */
// /*                                DEVELOPMENT                                 */
// /* -------------------------------------------------------------------------- */

// const globalForSSE = globalThis as unknown as {
//   sseEmitter?: EventEmitter;
// };

// const emitter =
//   globalForSSE.sseEmitter ??
//   (() => {
//     const e = new EventEmitter();
//     e.setMaxListeners(1000);
//     return e;
//   })();

// if (!isProd) {
//   globalForSSE.sseEmitter = emitter;
// }

// /* -------------------------------------------------------------------------- */
// /*                                 PRODUCTION                                 */
// /* -------------------------------------------------------------------------- */

// let redisPub: any = null;
// let redisSub: any = null;

// if (isProd) {
//   const Redis = require("ioredis");

//   redisPub = new Redis(process.env.UPSTASH_REDIS_URL!);
//   redisSub = new Redis(process.env.UPSTASH_REDIS_URL!);
// }

// type SSEHandler = (event: SSEEvent) => void;

// const localSubs = new Map<string, Set<SSEHandler>>();

// if (isProd && redisSub) {
//   redisSub.on("message", (channel: string, message: string) => {
//     try {
//       const event = JSON.parse(message) as SSEEvent;

//       localSubs.get(channel)?.forEach((handler) => {
//         handler(event);
//       });
//     } catch (error) {
//       logger.error("Failed to process SSE Redis message", {
//         error: String(error),
//       });
//     }
//   });
// }

// /* -------------------------------------------------------------------------- */
// /*                                   PUBLIC                                   */
// /* -------------------------------------------------------------------------- */

// export function emitToUser(
//   channel: string,
//   event: SSEEvent,
// ): void {
//   if (!isProd) {
//     emitter.emit(`user:${channel}`, event);
//     return;
//   }

//   void redisPub.publish(
//     channel,
//     JSON.stringify(event),
//   );
// }

// export function subscribeToUser(
//   channel: string,
//   handler: SSEHandler,
// ): () => void {
//   if (!isProd) {
//     const eventName = `user:${channel}`;

//     emitter.on(eventName, handler);

//     return () => {
//       emitter.off(eventName, handler);
//     };
//   }

//   if (!localSubs.has(channel)) {
//     localSubs.set(channel, new Set());

//     void redisSub.subscribe(channel);
//   }

//   localSubs.get(channel)!.add(handler);

//   return () => {
//     const handlers = localSubs.get(channel);

//     if (!handlers) return;

//     handlers.delete(handler);

//     if (handlers.size === 0) {
//       localSubs.delete(channel);

//       void redisSub.unsubscribe(channel);
//     }
//   };
// }


import { EventEmitter } from "events";
import { logger } from "@/src/lib/logger";
import type { SSEEvent } from "@/src/types";

const g = globalThis as unknown as { _sseEmitter?: EventEmitter };
if (!g._sseEmitter) {
  const e = new EventEmitter();
  e.setMaxListeners(1000);
  g._sseEmitter = e;
}
const emitter = g._sseEmitter!;

type SSEHandler = (event: SSEEvent) => void;

function channelKey(channel: string): string {
  return `sse:${channel}`;
}

export function emitToUser(channel: string, event: SSEEvent): void {
  emitter.emit(channelKey(channel), event);
}

export function subscribeToUser(channel: string, handler: SSEHandler): () => void {
  const key = channelKey(channel);
  emitter.on(key, handler);
  return () => emitter.off(key, handler);
}