import { NextRequest } from "next/server";
import { createRateLimitError } from "../lib/errors";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store — use Redis for multi-instance deployments
const store = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) store.delete(key);
  }
}, 5 * 60 * 1000);

export interface RateLimitOptions {
  /** Max requests per window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

// Default limits per route type
export const RATE_LIMITS = {
  default: { limit: 60, windowSeconds: 60 },
  search: { limit: 60, windowSeconds: 60 },
  send: { limit: 30, windowSeconds: 60 },
  chat: { limit: 10, windowSeconds: 60 },
  webhooks: { limit: 500, windowSeconds: 60 }, // high for webhook receivers
} as const;

/**
 * Check rate limit for a key (typically userId + endpoint).
 * Throws AppError if limit exceeded.
 */
export function checkRateLimit(
  key: string,
  options: RateLimitOptions = RATE_LIMITS.default,
): void {
  const now = Date.now();
  const windowMs = options.windowSeconds * 1000;

  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    // First request or window expired — reset
    store.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (entry.count >= options.limit) {
    throw createRateLimitError();
  }

  entry.count++;
}

/**
 * Extract rate limit key from request (prefers userId, falls back to IP)
 */
export function getRateLimitKey(req: NextRequest, userId?: string): string {
  const identifier =
    userId ??
    req.headers.get("x-forwarded-for") ??
    req.headers.get("x-real-ip") ??
    "anonymous";
  const path = new URL(req.url).pathname;
  return `${identifier}:${path}`;
}