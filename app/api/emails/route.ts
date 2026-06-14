import { handleRouteError, success } from "@/src/lib/api-response";
import { logger } from "@/src/lib/logger";
import { withAuth } from "@/src/middleware/auth"
import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from "@/src/middleware/rate-limit";
import { ListEmailsSchema, SendEmailSchema } from "@/src/schema";
import { db } from "@/src/server/db";
import { drafts } from "@/src/server/db/schema";
import { deleteDraft, listEmail, sendEmail } from "@/src/server/services/email.service";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";


// GET /api/emails — list inbox emails
export const GET = withAuth(async (req) => {
    try {
        const {searchParams} = new URL(req.url);
        const input = ListEmailsSchema.parse({
            folder : searchParams.get("folder") ?? undefined,
            q : searchParams.get("q") ?? undefined,
            limit : searchParams.get("limit") ?? undefined,
            pageToken: searchParams.get("pageToken") ?? undefined,
            priority: searchParams.get("priority") ?? undefined,
        });

        const result = await listEmail(req.user.googleSub,req.user.id,input);
        logger.warn("EMAIL LIST API CALLED");

        return success(result);
    } catch (error) {
        return handleRouteError(error);
    }
})

// POST /api/emails — send email
export const POST = withAuth(async (req) => {
    try {
        checkRateLimit(
            getRateLimitKey(req as NextRequest,req.user.id),
            RATE_LIMITS.send,
        )

        const body = await req.json();
        const input = SendEmailSchema.parse(body);

        const result = await sendEmail(req.user.googleSub,req.user.id,input,req.user.email);

        // Clean up local draft record if one was associated
        if(input.draftId){
            await db.
            delete(drafts)
            .where(and(eq(drafts.id, input.draftId), eq(drafts.userId, req.user.id)))

            // Also delete from Gmail if we have a gmail draft ID
            const [draft] = await db
            .select()
            .from(drafts)
            .where(and(eq(drafts.id, input.draftId), eq(drafts.userId, req.user.id)))
            .limit(1);

            if (draft?.gmailDraftId) {
                await deleteDraft(req.user.googleSub,req.user.id, draft.gmailDraftId);
            }
        }

        return success(result, 201);

    } catch (error) {
        return handleRouteError(error);
    }
})