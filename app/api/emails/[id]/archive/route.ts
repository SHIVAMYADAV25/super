import { handleRouteError, success } from "@/src/lib/api-response";
import { withAuth } from "@/src/middleware/auth"
import { EmailIdSchema } from "@/src/schema"
import { archiveEmail } from "@/src/server/services/email.service";

export const POST = withAuth(async (req , {params}) => {
    try {
        const {id} = EmailIdSchema.parse(params);
        await archiveEmail(req.user.id,id);
        return success({archived : true})
    } catch (error) {
        return handleRouteError(error)
    }
})