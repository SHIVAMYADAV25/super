// import { NextRequest } from "next/server";
// import { Ratelimit } from "@upstash/ratelimit";
// import { redis } from "../lib/redis";
// import { createRateLimitError } from "../lib/errors";

// interface RateLimitEntry {
//   count: number;
//   resetAt: number;
// }

// const store = new Map<string, RateLimitEntry>();

// setInterval(() => {
//   const now = Date.now();

//   for (const [key, entry] of store.entries()) {
//     if (entry.resetAt < now) {
//       store.delete(key);
//     }
//   }
// }, 5 * 60 * 1000);

// export interface RateLimitOptions {
//   limit: number;
//   windowSeconds: number;
// }

// export const RATE_LIMITS = {
//   default: { limit: 60, windowSeconds: 60 },
//   search: { limit: 60, windowSeconds: 60 },
//   send: { limit: 30, windowSeconds: 60 },
//   chat: { limit: 10, windowSeconds: 60 },
//   webhooks: { limit: 500, windowSeconds: 60 },
// } as const;

// const limiters = new Map<string, Ratelimit>();

// function getLimiter(options: RateLimitOptions): Ratelimit {
//   const cacheKey = `${options.limit}:${options.windowSeconds}`;

//   const existing = limiters.get(cacheKey);

//   if (existing) {
//     return existing;
//   }

//   const limiter = new Ratelimit({
//     redis,
//     limiter: Ratelimit.slidingWindow(
//       options.limit,
//       `${options.windowSeconds} s`,
//     ),
//     analytics: true,
//     prefix: "ratelimit",
//   });

//   limiters.set(cacheKey, limiter);

//   return limiter;
// }

// export async function checkRateLimit(
//   key: string,
//   options: RateLimitOptions = RATE_LIMITS.default,
// ): Promise<void> {
//   if (process.env.NODE_ENV === "development") {
//     const now = Date.now();
//     const windowMs = options.windowSeconds * 1000;

//     const entry = store.get(key);

//     if (!entry || entry.resetAt < now) {
//       store.set(key, {
//         count: 1,
//         resetAt: now + windowMs,
//       });

//       return;
//     }

//     if (entry.count >= options.limit) {
//       throw createRateLimitError();
//     }

//     entry.count++;
//     return;
//   }

//   const limiter = getLimiter(options);

//   const result = await limiter.limit(key);

//   if (!result.success) {
//     throw createRateLimitError();
//   }
// }

// export function getRateLimitKey(
//   req: NextRequest,
//   userId?: string,
// ): string {
//   const identifier =
//     userId ??
//     req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
//     req.headers.get("x-real-ip") ??
//     "anonymous";

//   const path = new URL(req.url).pathname;

//   return `${identifier}:${path}`;
// }

import { NextRequest } from "next/server";
import { createRateLimitError } from "../lib/errors";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

setInterval(() => {
  const now = Date.now();

  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  default: { limit: 60, windowSeconds: 60 },
  search: { limit: 60, windowSeconds: 60 },
  send: { limit: 30, windowSeconds: 60 },
  chat: { limit: 10, windowSeconds: 60 },
  webhooks: { limit: 500, windowSeconds: 60 },
} as const;

export async function checkRateLimit(
  key: string,
  options: RateLimitOptions = RATE_LIMITS.default,
): Promise<void> {
  const now = Date.now();
  const windowMs = options.windowSeconds * 1000;

  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    store.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });

    return;
  }

  if (entry.count >= options.limit) {
    throw createRateLimitError();
  }

  entry.count++;
}

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