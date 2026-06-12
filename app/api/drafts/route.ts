import { handleRouteError, success } from "@/src/lib/api-response";
import { withAuth } from "@/src/middleware/auth"
import { SaveDraftSchema } from "@/src/schema";
import { db } from "@/src/server/db";
import { drafts } from "@/src/server/db/schema";
import { buildRawMimeMessage } from "@/src/server/lib/gmail-parser";
import { createDraft } from "@/src/server/services/email.service";
import { eq } from "drizzle-orm";


// POST /api/drafts — create a new draft
export const POST = withAuth(async (req) => {
    try {
        const body = await req.json();
        const input = SaveDraftSchema.parse(body);

        // Save to Gmail via Corsair
        const raw = buildRawMimeMessage({
            from : req.user.email,
            to : input.to ?? [],
            cc : input.cc ?? [],
            subject : input.subject ?? "",
            body : input.body ?? "",
        })

        const {draftId : gmailDraftId} = await createDraft(req.user.id,raw);

        // Save to our DB for tracking
        const [draft] = await db
        .insert(drafts)
        .values({
            userId : req.user.id,
            gmailDraftId,
            toAddrs : input.to ?? [],
            ccAddrs : input.cc ?? [],
            subject : input.subject ?? "",
            body : input.body ?? "",
        })
        .returning();

        return success({draftId : draft.id , gmailDraftId} , 201);
    } catch (error) {
        return handleRouteError(error);
    }
})


// GET /api/drafts — list user drafts

export const GET = withAuth(async (req) => {
    try {
        const userDrafts = await db
        .select()
        .from(drafts)
        .where(eq(drafts.userId, req.user.id))
        .orderBy(drafts.updatedAt);


        return success(userDrafts)
    } catch (error) {
        return handleRouteError(error);
    }
})