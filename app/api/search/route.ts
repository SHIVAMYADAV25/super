// import { handleRouteError, success } from "@/src/lib/api-response";
// import { withAuth } from "@/src/middleware/auth"
// import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from "@/src/middleware/rate-limit"
// import { searchSchema } from "@/src/schema";
// import { search } from "@/src/server/services/search.service";
// import { NextRequest } from "next/server"


// // GET /api/search?q=...&mode=both
// export const GET = withAuth(async (req) => {
//     try {
//         checkRateLimit(getRateLimitKey(req as NextRequest,req.user.id) , RATE_LIMITS.search);

//         const {searchParams} = new URL(req.url);
//         const input = searchSchema.parse({
//             q : searchParams.get("q"),
//             mode : searchParams.get("mode") ?? undefined,
//             Limit : searchParams.get("limit") ?? undefined
//         });

//         const results = await search(req.user.id,input);
//         return success({results , query : input.q, mode : input.mode});
//     } catch (error) {
//         return handleRouteError(error);
//     }
// })

import { handleRouteError, success } from "@/src/lib/api-response";
import { withAuth } from "@/src/middleware/auth";
import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from "@/src/middleware/rate-limit";
import { searchSchema } from "@/src/schema";
import { search } from "@/src/server/services/search.service";
import { NextRequest } from "next/server";

// GET /api/search?q=...&mode=both&limit=20
export const GET = withAuth(async (req) => {
  try {
    await checkRateLimit(getRateLimitKey(req as NextRequest, req.user.id), RATE_LIMITS.search);

    const { searchParams } = new URL(req.url);
    const input = searchSchema.parse({
      q: searchParams.get("q"),
      mode: searchParams.get("mode") ?? "both",
      limit: searchParams.get("limit") ?? undefined,
    });

    const results = await search(
      req.user.googleSub,  // tenantId → Corsair
      req.user.id,         // userId   → DB
      input,
    );

    return success({ results, query: input.q, mode: input.mode });
  } catch (error) {
    return handleRouteError(error);
  }
});