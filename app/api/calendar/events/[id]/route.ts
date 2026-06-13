import { handleRouteError, success } from "@/src/lib/api-response";
import { createValidationError } from "@/src/lib/errors";
import { withAuth } from "@/src/middleware/auth";
import { UpdateEventSchema } from "@/src/schema";
import { deleteEvent, getEvent, updateEvent } from "@/src/server/services/calendar.service";



// GET /api/calendar/events/[id]
export const GET = withAuth(async (req, {params} ) =>{
    try {

        const awaitedParams = await params
        if(!awaitedParams.id) throw createValidationError("Event ID required");

        const event = await getEvent(req.user.googleSub,req.user.id,awaitedParams.id);
        return success(event)
    } catch (error) {
        return handleRouteError(error)
    }
})


// PATCH /api/calendar/events/[id]

export const PATCH = withAuth(async (req , {params})=>{
    try {
        const awaitedParams = await params
        if (!awaitedParams.id) throw createValidationError("Event ID required");
        const body = await req.json();
        const input = UpdateEventSchema.parse(body);
        const event = await updateEvent(req.user.googleSub,req.user.id, awaitedParams.id, input);
        return success(event);
    } catch (error) {
        return handleRouteError(error);
    }
})

// DELETE /api/calendar/events/[id]
export const DELETE = withAuth(async (req, { params }) => {
  try {
    const awaitedParams = await params
    if (!awaitedParams.id) throw createValidationError("Event ID required");
    await deleteEvent(req.user.googleSub,req.user.id,  awaitedParams.id);
    return success({ deleted: true });
  } catch (err) {
    return handleRouteError(err);
  }
});