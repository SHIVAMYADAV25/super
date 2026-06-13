import { handleRouteError, success } from "@/src/lib/api-response";
import { withAuth } from "@/src/middleware/auth"
import { EmailIdSchema } from "@/src/schema"
import { archiveEmail } from "@/src/server/services/email.service";

export const POST = withAuth(async (req , {params}) => {
    try {
        const resolvedParams = await params;
        const {id} = EmailIdSchema.parse(resolvedParams);
        await archiveEmail(req.user.googleSub,req.user.id,id);
        return success({archived : true})
    } catch (error) {
        return handleRouteError(error)
    }
})

