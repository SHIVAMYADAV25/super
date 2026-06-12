import { handleRouteError, success } from "@/src/lib/api-response";
import { createValidationError } from "@/src/lib/errors";
import { withAuth } from "@/src/middleware/auth";
import { RSVPSchema } from "@/src/schema";
import { rsvpEvent } from "@/src/server/services/calendar.service";


// POST /api/calendar/events/[id]/rsvp
export const POST = withAuth(async (req, { params }) => {
  try {
    if (!params.id) throw createValidationError("Event ID required");
    const body = await req.json();
    const input = RSVPSchema.parse(body);
    const event = await rsvpEvent(req.user.id, params.id, req.user.email, input);
    return success(event);
  } catch (err) {
    return handleRouteError(err);
  }
});
 