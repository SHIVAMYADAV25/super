

// Singleton in-process emitter
// For multi-instance deployments, replace with Redis pub/sub

import { logger } from "@/src/lib/logger";
import { SSEEvent } from "@/src/types";
import { EventEmitter } from "events";

const globalForSSE = globalThis as unknown as {sseEmitter : EventEmitter | undefined};

const emitter : EventEmitter =
globalForSSE.sseEmitter ?? 
(() => {
    const e = new EventEmitter();
    e.setMaxListeners(1000) //  support many concurrent users
    return e;
})();

if(process.env.NODE_ENV !== "production"){
    globalForSSE.sseEmitter = emitter;
}

/**
 * Emit an SSE event to a specific user's stream.
 */

export function emitUser(userId : string,event : SSEEvent):void{
    emitter.emit(`user:${userId}`,event)
};

/**
 * Subscribe to SSE events for a user.
 * Returns an unsubscribe function.
 */

export function subscribeToUser(
    userId: string,
    handler : (event : SSEEvent) => void,
):()=>void{
    const channel = `user:${userId}`;

    emitter.on(channel,handler);
    logger.debug("SSE subscriber added", { userId });

    return () => {
        emitter.off(channel,handler);
        logger.debug("SSE subscriber removed", { userId });
    }
}