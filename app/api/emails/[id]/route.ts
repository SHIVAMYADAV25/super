import { handleRouteError, success } from "@/src/lib/api-response";
import { withAuth } from "@/src/middleware/auth";
import { EmailIdSchema, MarkEmailSchema } from "@/src/schema";
import { getEmail, modifyEmail } from "@/src/server/services/email.service";



// GET /api/emails/[id] — get full email
export const GET = withAuth(async (req , {params}) => {
    try {
        const resolvedParams = await params;

        const { id } = EmailIdSchema.parse(resolvedParams);

        const email = await getEmail(req.user.id,req.user.googleSub, id);
         console.log(email);

        return success(email);
    } catch (err) {
        console.dir(err, { depth: null });
        return handleRouteError(err);
    }
})


// PATCH /api/emails/[id] — mark read/unread, modify labels
export const PATCH = withAuth(async (req, { params }) => {
  try {
    const { id } = EmailIdSchema.parse(params);
    const body = await req.json();
    const input = MarkEmailSchema.parse(body);
 
    await modifyEmail(req.user.id, id, {
      isRead: input.isRead,
      addLabels: input.labels?.add,
      removeLabels: input.labels?.remove,
    });
 
    return success({ updated: true });
  } catch (err) {
    return handleRouteError(err);
  }
});
