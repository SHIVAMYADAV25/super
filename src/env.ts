// import { createEnv } from "@t3-oss/env-nextjs";
// import {z} from "zod";

// export const env = createEnv({
//     server : {
//         DATABASE_URL : z.string().url(),
//         NEXTAUTH_SECRET : z.string().min(32),
//         NEXTAUTH_URL : z.string().url(),
//         GOOGLE_CLIENT_ID :z.string().min(1),
//         GOOGLE_CLIENT_SECRET : z.string().min(1),
//         CORSAIR_KEK : z.string().min(32),
//         OPENAI_API_KEY : z.string().startsWith("sk-").optional(),
//         NODE_ENV : z.
//         enum(["development","production","test"])
//         .default("development"),
//     },
//     client : {
//         NEXT_PUBLIC_APP_URL : z.string().url(),
//     },
//     runtimeEnv:{
//         DATABASE_URL : process.env.DATABASE_URL,
//         NEXTAUTH_SECRET:process.env.NEXTAUTH_SECRET,
//         NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
//         NEXTAUTH_URL : process.env.NEXTAUTH_URL,
//         GOOGLE_CLIENT_ID:process.env.GOOGLE_CLIENT_ID,
//         GOOGLE_CLIENT_SECRET : process.env.GOOGLE_CLIENT_SECRET,
//         CORSAIR_KEK : process.env.CORSAIR_KEK,
//         NODE_ENV : process.env.NODE_ENV,
//         OPENAI_API_KEY:process.env.OPENAI_API_KEY
//     },
//     skipValidation : !!process.env.SKIP_ENV_VALIDATION
// });

import { createEnv } from "@t3-oss/env-nextjs";
import {z} from "zod";

export const env = createEnv({
    server : {
        DATABASE_URL : z.string().url(),
        NEXTAUTH_SECRET : z.string().min(32),
        NEXTAUTH_URL : z.string().url(),
        GOOGLE_CLIENT_ID :z.string().min(1),
        GOOGLE_CLIENT_SECRET : z.string().min(1),
        CORSAIR_KEK : z.string().min(32),
        // Legacy OpenAI key — optional, superseded by llm-provider.ts
        OPENAI_API_KEY : z.string().startsWith("sk-").optional(),
        // Multi-LLM provider keys
        OPENROUTER_API_KEY : z.string().optional(),
        GEMINI_API_KEY : z.string().optional(),
        // Model selection — see src/server/lib/llm-provider.ts for valid keys
        // Chat: claude-sonnet-4-6 | nex-n2-pro | nemotron-3-ultra | nemotron-3-nano-omni | gpt-oss-120b
        LLM_CHAT_MODEL : z.string().optional(),
        // Embedding: nemotron-embed-vl | gemini-embedding
        LLM_EMBEDDING_MODEL : z.string().optional(),
        NODE_ENV : z
            .enum(["development","production","test"])
            .default("development"),

        ANTHROPIC_API_KEY: z.string().optional(),

        LLM_PROVIDER_AGENT_KEY: z.string().optional(),

        LLM_PROVIDER_FOR_AGENT: z
        .enum([
            "nex",
            "anthropic",
            "openai_agents",
            "vercel_ai",
        ])
        .optional(),
    },
    client : {
        NEXT_PUBLIC_APP_URL : z.string().url(),
    },
    runtimeEnv:{
        DATABASE_URL: process.env.DATABASE_URL,
        NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
        NEXTAUTH_URL: process.env.NEXTAUTH_URL,
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
        CORSAIR_KEK: process.env.CORSAIR_KEK,
        NODE_ENV: process.env.NODE_ENV,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        LLM_CHAT_MODEL: process.env.LLM_CHAT_MODEL,
        LLM_EMBEDDING_MODEL: process.env.LLM_EMBEDDING_MODEL,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        LLM_PROVIDER_AGENT_KEY: process.env.LLM_PROVIDER_AGENT_KEY,
        LLM_PROVIDER_FOR_AGENT: process.env.LLM_PROVIDER_FOR_AGENT
    },
    skipValidation : !!process.env.SKIP_ENV_VALIDATION
});