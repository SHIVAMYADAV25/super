import { handleRouteError, success } from "@/src/lib/api-response";
import { withAuth } from "@/src/middleware/auth";
import { EmailIdSchema, MarkEmailSchema } from "@/src/schema";
import { getEmail, modifyEmail } from "@/src/server/services/email.service";

// GET /api/emails/[id] — get full email (marks read, queues enrichment)
export const GET = withAuth(async (req, { params }) => {
  try {
    const resolvedParams = await params;
    const { id } = EmailIdSchema.parse(resolvedParams);

    // getEmail(userId, tenantId/googleSub, gmailId)
    const email = await getEmail(req.user.id, req.user.googleSub, id);
    return success(email);
  } catch (err) {
    return handleRouteError(err);
  }
});

// PATCH /api/emails/[id] — mark read/unread, modify labels
export const PATCH = withAuth(async (req, { params }) => {
  try {
    const resolvedParams = await params;
    const { id } = EmailIdSchema.parse(resolvedParams);
    const body = await req.json();
    const input = MarkEmailSchema.parse(body);

    await modifyEmail(
      req.user.googleSub, // tenantId → Corsair
      req.user.id,        // userId   → DB
      id,
      {
        isRead: input.isRead,
        addLabels: input.labels?.add,
        removeLabels: input.labels?.remove,
      },
    );

    return success({ updated: true });
  } catch (err) {
    return handleRouteError(err);
  }
});