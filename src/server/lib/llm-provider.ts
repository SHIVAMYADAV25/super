/**
 * ─── LLM Provider Registry ────────────────────────────────────────────────────
 *
 * Single source of truth for all LLM calls in this codebase.
 *
 * TO SWITCH MODEL:  set LLM_CHAT_MODEL / LLM_EMBEDDING_MODEL in .env.local
 * TO ADD A MODEL:   add one entry to CHAT_MODELS or EMBEDDING_MODELS — nothing
 *                   else in the codebase needs to change.
 *
 * Chat model keys:
 *   claude-sonnet-4-6  (default — Anthropic, full MCP tool-loop support)
 *   nex-n2-pro         (OpenRouter free — strong agentic MoE)
 *   nemotron-3-ultra   (OpenRouter free — 550B reasoning, 1M ctx)
 *   nemotron-3-nano-omni (OpenRouter free — multimodal, fast)
 *   gpt-oss-120b       (OpenRouter free — OpenAI open-weight MoE)
 *
 * Embedding model keys:
 *   nemotron-embed-vl  (OpenRouter free — multimodal, text+image)
 *   gemini-embedding   (Google — 3072-dim, multilingual)
 *
 * NOTE ON DIMENSIONS:
 *   nemotron-embed-vl → 4096-dim  (confirmed from NVIDIA docs)
 *   gemini-embedding-001 → 768-dim (task-type: RETRIEVAL_DOCUMENT)
 *   The DB schema uses vector(4096) to accommodate the largest model.
 *   Gemini vectors are zero-padded when stored.
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/src/env";
import { logger } from "@/src/lib/logger";

// ─── Chat / tool-calling registry ─────────────────────────────────────────────

export type ChatProviderKind = "anthropic" | "openrouter";

export interface ChatModelConfig {
  kind: ChatProviderKind;
  model: string;
  /** Whether this model supports streaming tool calls (Anthropic only for now) */
  supportsTools: boolean;
  /** Max output tokens to request */
  maxTokens: number;
}

export const CHAT_MODELS = {
  "claude-sonnet-4-6": {
    kind: "anthropic",
    model: "claude-sonnet-4-6",
    supportsTools: true,
    maxTokens: 4096,
  },
  "nex-n2-pro": {
    kind: "openrouter",
    model: "nex-agi/nex-n2-pro:free",
    supportsTools: true,
    maxTokens: 4096,
  },
  "nemotron-3-ultra": {
    kind: "openrouter",
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    supportsTools: true,
    maxTokens: 4096,
  },
  "nemotron-3-nano-omni": {
    kind: "openrouter",
    model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    supportsTools: false, // reasoning model, no tool-calling
    maxTokens: 4096,
  },
  "gpt-oss-120b": {
    kind: "openrouter",
    model: "openai/gpt-oss-120b:free",
    supportsTools: true,
    maxTokens: 4096,
  },
} as const satisfies Record<string, ChatModelConfig>;

export type ChatModelKey = keyof typeof CHAT_MODELS;

export const ACTIVE_CHAT_MODEL: ChatModelKey =
  (env.LLM_CHAT_MODEL as ChatModelKey | undefined) ?? "claude-sonnet-4-6";

// ─── Embedding registry ────────────────────────────────────────────────────────

export type EmbeddingProviderKind = "openrouter" | "gemini" | "openai";

export interface EmbeddingModelConfig {
  kind: EmbeddingProviderKind;
  model: string;
  /** Output dimension — must match DB vector column size */
  dimensions: number;
}

export const EMBEDDING_MODELS = {
  "nemotron-embed-vl": {
    kind: "openrouter",
    model: "nvidia/llama-nemotron-embed-vl-1b-v2:free",
    dimensions: 4096,
  },
  "gemini-embedding": {
    kind: "gemini",
    model: "gemini-embedding-001",
    dimensions: 768,
  },
  "openai-3-small": {
    kind: "openai",
    model: "text-embedding-3-small",
    dimensions: 1536,
  },
} as const satisfies Record<string, EmbeddingModelConfig>;

export type EmbeddingModelKey = keyof typeof EMBEDDING_MODELS;

export const ACTIVE_EMBEDDING_MODEL: EmbeddingModelKey =
  (env.LLM_EMBEDDING_MODEL as EmbeddingModelKey | undefined) ?? "openai-3-small";

/** Dimension of the currently active embedding model */
export const EMBEDDING_DIM =
  EMBEDDING_MODELS[ACTIVE_EMBEDDING_MODEL].dimensions;

// ─── Singleton clients ─────────────────────────────────────────────────────────

let _anthropic: Anthropic | null = null;
let _openrouter: OpenAI | null = null;
let _openai: OpenAI | null = null;

function getAnthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

function getOpenRouter(): OpenAI {
  if (!_openrouter) {
    if (!env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is not set — required for OpenRouter models");
    }
    _openrouter = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: env.OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": env.NEXTAUTH_URL ?? "http://localhost:3000",
        "X-Title": "Superhuman",
      },
    });
  }
  return _openrouter;
}

function getOpenAI(): OpenAI {
  if (!_openai) {
    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set — required for OpenAI embedding model");
    }
    _openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return _openai;
}

// ─── Resolved chat client ──────────────────────────────────────────────────────

export interface ResolvedChatClient {
  kind: ChatProviderKind;
  model: string;
  maxTokens: number;
  supportsTools: boolean;
  anthropic?: Anthropic;
  openai?: OpenAI;
}

/**
 * Resolve the active (or overridden) chat model into a ready client.
 *
 * @param key - Optional override. Defaults to ACTIVE_CHAT_MODEL.
 */
export function getChatClient(key: ChatModelKey = ACTIVE_CHAT_MODEL): ResolvedChatClient {

   const resolvedKey = key ?? ACTIVE_CHAT_MODEL;

  const config = CHAT_MODELS[resolvedKey];

  if (!config) {
    throw new Error(`Unknown model key: ${String(resolvedKey)}`);
  }

  logger.debug("Resolved chat client", {
    key: resolvedKey,
    model: config.model,
    kind: config.kind,
  });

  if (config.kind === "anthropic") {
    return {
      kind: "anthropic",
      model: config.model,
      maxTokens: config.maxTokens,
      supportsTools: config.supportsTools,
      anthropic: getAnthropic(),
    };
  }

  return {
    kind: "openrouter",
    model: config.model,
    maxTokens: config.maxTokens,
    supportsTools: config.supportsTools,
    openai: getOpenRouter(),
  };
}

// ─── Embedding ─────────────────────────────────────────────────────────────────

export interface EmbedInput {
  text?: string;
  imageUrl?: string;
}

/**
 * Generate an embedding vector using the active (or overridden) model.
 * Returns a flat number[] regardless of provider.
 * Returns null on failure so callers can gracefully degrade.
 */
export async function getEmbedding(
  input: EmbedInput,
  key: EmbeddingModelKey = ACTIVE_EMBEDDING_MODEL,
): Promise<number[] | null> {
  const config = EMBEDDING_MODELS[key];
  

  try {
    if (config.kind === "openai") {
      const client = getOpenAI();
      const text = input.text ?? "";
      const response = await client.embeddings.create({
        model: config.model,
        input: text.slice(0, 8000),
        encoding_format: "float",
        dimensions: config.dimensions,
      });
      return response.data[0]?.embedding ?? null;
    }

    if (config.kind === "openrouter") {
      const client = getOpenRouter();
      // nemotron-embed-vl accepts multimodal content array
      const content: Array<Record<string, unknown>> = [];
      if (input.text) content.push({ type: "text", text: input.text.slice(0, 8000) });
      if (input.imageUrl) {
        content.push({ type: "image_url", image_url: { url: input.imageUrl } });
      }
      if (content.length === 0) return null;

      const res = await client.embeddings.create({
        model: config.model,
        // OpenRouter multimodal embedding format
        input: [{ content }] as unknown as string[],
        encoding_format: "float",
      });
      return (res.data[0]?.embedding as unknown as number[]) ?? null;
    }

    if (config.kind === "gemini") {
      // Lazy import — only load if gemini model is actually used
      const { GoogleGenAI } = await import("@google/genai");
      if (!env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not set — required for Gemini embedding model");
      }
      logger.debug("embedding getting called");
      const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
      const result = await ai.models.embedContent({
        model: config.model,
        contents: input.text ?? "",
        config: {
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: config.dimensions,
        },
      });
      return result.embeddings?.[0]?.values ?? null;
    }
  } catch (err) {
    logger.warn("Embedding generation failed", {
      key,
      model: config.model,
      error: String(err),
    });
    return null;
  }

  return null;
}