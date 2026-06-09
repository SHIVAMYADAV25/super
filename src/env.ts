import { createEnv } from "@t3-oss/env-nextjs";
import { CORSAIR_INTERNAL } from "corsair/core";
import {z} from "zod";

export const env = createEnv({
    server : {
        DATABASE_URL : z.string().url(),
        NEXTAUTH_SECRET : z.string().min(32),
        NEXTAUTH_URL : z.string().url(),
        GOOGLE_CLIENT_ID :z.string().min(1),
        GOOGLE_CLIENT_SECRET : z.string().min(1),
        CORSAIR_KEK : z.string().min(32),
        OPENAI_API_KEY : z.string().startsWith("sk-").optional(),
        NODE_ENV : z.
        enum(["development","production","test"])
        .default("development"),
    },
    client : {
        NEXT_PUBLIC_APP_URL : z.string().url(),
    },
    runtimeEnv:{
        DATABASE_URL : process.env.DATABASE_URL,
        NEXTAUTH_SECRET:process.env.NEXT_AUTH_SECRET,
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
        NEXTAUTH_URL : process.env.NEXTAUTH_URL,
        GOOGLE_CLIENT_ID:process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET : process.env.GOOGLE_CLIENT_SECRET,
        CORSAIR_KEK : process.env.CORSAIR_KEK,
        NODE_ENV : process.env.NODE_ENV,
        OPENAI_API_KEY:process.env.OPENAI_API_KEY
    },
    skipValidation : !!process.env.SKIP_ENV_VALIDATION
});