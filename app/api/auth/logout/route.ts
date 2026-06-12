import { revokeCorsairTenant } from "@/src/auth/auth.service";
import { authConfig } from "@/src/auth/config";
import { handleRouteError, success } from "@/src/lib/api-response";
import { getServerSession } from "next-auth";

export async  function POST(){
    try{
        const session = await getServerSession(authConfig);
        if(session?.user?.id){
            // Best-effort revocation — don't block logout if this fails
            await revokeCorsairTenant(session.user.id).catch(() => null);
        }

        // Clear the NextAuth session cookie
        const response = success({message : "Logout out"});

        response.cookies.delete("next-auth.session-token");
        response.cookies.delete("__Secure-next-auth.session-token")

        return response;
    }catch(err){
        return handleRouteError(err);
    }
}