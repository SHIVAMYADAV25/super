import { handleRouteError, success } from "@/src/lib/api-response";
import { withAuth } from "@/src/middleware/auth";
import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from "@/src/middleware/rate-limit";
import { CreateEventSchema, ListEventSchema } from "@/src/schema";
import { checkConflicts, createEvent, listEvent } from "@/src/server/services/calendar.service";
import { NextRequest } from "next/server";


// GET /api/calendar/events
export const GET = withAuth(async (req)=>{
    try {
        const {searchParams} =  new URL(req.url);

        const input = ListEventSchema.parse({
            from : searchParams.get("from") ?? undefined,
            to : searchParams.get("to") ?? undefined,
            q : searchParams.get("q") ?? undefined,
            maxResult : searchParams.get("maxResult") ?? undefined
        });

        const events = await listEvent(req.user.id , input);
        return success(events);
    } catch (error) {
        return handleRouteError(error);
    }
})

// POST /api/calendar/events

export const POST = withAuth(async (req) => {
    try{
        checkRateLimit(getRateLimitKey(req as NextRequest, req.user.id), RATE_LIMITS.default);

        const body = await req.json();

        const input = CreateEventSchema.parse(body);

        // Check for conflicts before creating (non-blocking — returns warning not error)
        const conflicts = await checkConflicts(
            req.user.id,
            input.startTime,
            input.endTime
        );

        const event = await createEvent(req.user.id,input);

        return success({
            event,
            conflict : conflicts.hasConflict ? conflicts.conflictingEvents  : [],
        },201);
    }catch(err){
        return handleRouteError(err)
    }
})