// import { NextRequest } from "next/server";
// import { createRateLimitError } from "../lib/errors";

// interface RateLimitEntry {
//   count: number;
//   resetAt: number;
// }

// // In-memory store — use Redis for multi-instance deployments
// const store = new Map<string, RateLimitEntry>();

// // Cleanup old entries every 5 minutes
// setInterval(() => {
//   const now = Date.now();
//   for (const [key, entry] of store.entries()) {
//     if (entry.resetAt < now) store.delete(key);
//   }
// }, 5 * 60 * 1000);

// export interface RateLimitOptions {
//   /** Max requests per window */
//   limit: number;
//   /** Window duration in seconds */
//   windowSeconds: number;
// }

// // Default limits per route type
// export const RATE_LIMITS = {
//   default: { limit: 60, windowSeconds: 60 },
//   search: { limit: 60, windowSeconds: 60 },
//   send: { limit: 30, windowSeconds: 60 },
//   chat: { limit: 10, windowSeconds: 60 },
//   webhooks: { limit: 500, windowSeconds: 60 }, // high for webhook receivers
// } as const;

// /**
//  * Check rate limit for a key (typically userId + endpoint).
//  * Throws AppError if limit exceeded.
//  */
// export function checkRateLimit(
//   key: string,
//   options: RateLimitOptions = RATE_LIMITS.default,
// ): void {
//   const now = Date.now();
//   const windowMs = options.windowSeconds * 1000;

//   const entry = store.get(key);

//   if (!entry || entry.resetAt < now) {
//     // First request or window expired — reset
//     store.set(key, { count: 1, resetAt: now + windowMs });
//     return;
//   }

//   if (entry.count >= options.limit) {
//     throw createRateLimitError();
//   }

//   entry.count++;
// }

// /**
//  * Extract rate limit key from request (prefers userId, falls back to IP)
//  */
// export function getRateLimitKey(req: NextRequest, userId?: string): string {
//   const identifier =
//     userId ??
//     req.headers.get("x-forwarded-for") ??
//     req.headers.get("x-real-ip") ??
//     "anonymous";
//   const path = new URL(req.url).pathname;
//   return `${identifier}:${path}`;
// }

import { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "../lib/redis";
import { createRateLimitError } from "../lib/errors";

export interface RateLimitOptions {
  /** Max requests per window */
  limit: number;

  /** Window duration in seconds */
  windowSeconds: number;
}

export const RATE_LIMITS = {
  default: { limit: 60, windowSeconds: 60 },
  search: { limit: 60, windowSeconds: 60 },
  send: { limit: 30, windowSeconds: 60 },
  chat: { limit: 10, windowSeconds: 60 },
  webhooks: { limit: 500, windowSeconds: 60 },
} as const;

// Cache ratelimiter instances by config
const limiters = new Map<string, Ratelimit>();

function getLimiter(options: RateLimitOptions): Ratelimit {
  const cacheKey = `${options.limit}:${options.windowSeconds}`;

  const existing = limiters.get(cacheKey);

  if (existing) {
    return existing;
  }

  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(
      options.limit,
      `${options.windowSeconds} s`,
    ),
    analytics: true,
    prefix: "ratelimit",
  });

  limiters.set(cacheKey, limiter);

  return limiter;
}

/**
 * Same API as before.
 *
 * Before:
 * checkRateLimit(...)
 *
 * After:
 * await checkRateLimit(...)
 */
export async function checkRateLimit(
  key: string,
  options: RateLimitOptions = RATE_LIMITS.default,
): Promise<void> {
  const limiter = getLimiter(options);

  const result = await limiter.limit(key);

  if (!result.success) {
    throw createRateLimitError();
  }
}

/**
 * Extract rate limit key from request
 */
export function getRateLimitKey(
  req: NextRequest,
  userId?: string,
): string {
  const identifier =
    userId ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "anonymous";

  const path = new URL(req.url).pathname;

  return `${identifier}:${path}`;
}