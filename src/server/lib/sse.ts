// src/server/lib/sse.ts
// Replace the in-memory implementation with Redis pub/sub:

import { redis } from "@/src/lib/redis";
import { SSEEvent } from "@/src/types";
import Redis from "ioredis";

type SSEHandler = (event: SSEEvent) => void;
const localSubs = new Map<string, Set<SSEHandler>>();

// Subscriber instance (must be separate from the publisher)
const redisSub = new Redis(process.env.REDIS_URL!);

redisSub.on("message", (channel: string, message: string) => {
  try {
    const event = JSON.parse(message) as SSEEvent;
    localSubs.get(channel)?.forEach((h) => h(event));
  } catch { /* ignore */ }
});

export function subscribeToUser(tenantId: string, handler: SSEHandler): () => void {
  if (!localSubs.has(tenantId)) {
    localSubs.set(tenantId, new Set());
    void redisSub.subscribe(tenantId);
  }
  localSubs.get(tenantId)!.add(handler);

  return () => {
    localSubs.get(tenantId)?.delete(handler);
    if (localSubs.get(tenantId)?.size === 0) {
      localSubs.delete(tenantId);
      void redisSub.unsubscribe(tenantId);
    }
  };
}

export function emitToUser(tenantId: string, event: SSEEvent): void {
  // Publish to Redis — all instances receive it via redisSub
  void redis.publish(tenantId, JSON.stringify(event));
}