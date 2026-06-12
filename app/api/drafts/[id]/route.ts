import { handleRouteError, success } from "@/src/lib/api-response";
import { createNotFoundError } from "@/src/lib/errors";
import { withAuth } from "@/src/middleware/auth";
import { SaveDraftSchema } from "@/src/schema";
import { db } from "@/src/server/db";
import { drafts } from "@/src/server/db/schema";
import { buildRawMimeMessage } from "@/src/server/lib/gmail-parser";
import { updateDraft } from "@/src/server/services/email.service";
import { and, eq } from "drizzle-orm";

// PUT /api/drafts/[id] — update existing draft
export const PUT = withAuth(async (req, {params}) =>{
    try {
        const body = await req.json();
        const input = SaveDraftSchema.parse(body);

        // Find our local draft record
        const [draft] = await db
        .select()
        .from(drafts)
        .where(and(eq(drafts.id, params.id), eq(drafts.userId, req.user.id)))
        .limit(1);

        if(!draft) throw createNotFoundError("Draft");

        const raw = buildRawMimeMessage({
            from: req.user.email,
            to: input.to ?? [],
            cc: input.cc ?? [],
            subject: input.subject ?? "",
            body: input.body ?? "",
        })

        if(draft.gmailDraftId){
            await updateDraft(req.user.id,draft.gmailDraftId, raw);
        }


        // update our local record

        await db
        .update(drafts)
        .set({
        toAddrs: input.to ?? [],
        ccAddrs: input.cc ?? [],
        subject: input.subject ?? "",
        body: input.body ?? "",
        updatedAt: new Date(),
      })
      .where(eq(drafts.id, params.id));

      return success({ updated: true });
    } catch (err) {
        return handleRouteError(err);
    }
})

// DELETE /api/drafts/[id]

export const DELETE = withAuth(async (req , { params }) => {
    try {
        const [draft] = await db
        .select()
        .from(drafts)
        .where(and(eq(drafts.id, params.id), eq(drafts.userId, req.user.id)))
        .limit(1);

        if(!draft) throw createNotFoundError("Draft");

        // Delete from Gmail
        await db.delete(drafts).where(eq(drafts.id, params.id));

        return success({deleted : true});

    } catch (err) {
        return handleRouteError(err)
    }
})