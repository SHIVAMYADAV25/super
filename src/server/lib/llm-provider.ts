/**
 * Central LLM provider registry.
 *
 * Add a new model by adding one entry to CHAT_MODELS or EMBEDDING_MODELS.
 * Switch the active model by changing ACTIVE_CHAT_MODEL / ACTIVE_EMBEDDING_MODEL
 * (or set via env vars LLM_CHAT_MODEL / LLM_EMBEDDING_MODEL).
 *
 * Everything else in the codebase (chat.service.ts, priority.service.ts, etc.)
 * should call getChatClient() / getEmbedding() and never import a provider SDK directly.
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { env } from "@/src/env";

// ─── Chat / tool-calling model registry ───────────────────────────────────────

export type ChatProviderKind = "anthropic" | "openrouter";

export interface ChatModelConfig {
  kind: ChatProviderKind;
  /** Model slug passed to the provider */
  model: string;
}

export const CHAT_MODELS = {
  "claude-sonnet-4-6": {
    kind: "anthropic",
    model: "claude-sonnet-4-6",
  },
  "nex-n2-pro": {
    kind: "openrouter",
    model: "nex-agi/nex-n2-pro:free",
  },
  "nemotron-3-ultra": {
    kind: "openrouter",
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
  },
  "nemotron-3-nano-omni": {
    kind: "openrouter",
    model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  },
  "gpt-oss-120b": {
    kind: "openrouter",
    model: "openai/gpt-oss-120b:free",
  },
} as const satisfies Record<string, ChatModelConfig>;

export type ChatModelKey = keyof typeof CHAT_MODELS;

/** Default chat model — change this to switch models everywhere */
export const ACTIVE_CHAT_MODEL: ChatModelKey =
  (env.LLM_CHAT_MODEL as ChatModelKey | undefined) ?? "claude-sonnet-4-6";

// ─── Embedding model registry ─────────────────────────────────────────────────

export type EmbeddingProviderKind = "openrouter" | "gemini";

export interface EmbeddingModelConfig {
  kind: EmbeddingProviderKind;
  model: string;
}

export const EMBEDDING_MODELS = {
  "nemotron-embed-vl": {
    kind: "openrouter",
    model: "nvidia/llama-nemotron-embed-vl-1b-v2:free",
  },
  "gemini-embedding": {
    kind: "gemini",
    model: "gemini-embedding-001",
  },
} as const satisfies Record<string, EmbeddingModelConfig>;

export type EmbeddingModelKey = keyof typeof EMBEDDING_MODELS;

export const ACTIVE_EMBEDDING_MODEL: EmbeddingModelKey =
  (env.LLM_EMBEDDING_MODEL as EmbeddingModelKey | undefined) ?? "nemotron-embed-vl";

// ─── Client singletons ─────────────────────────────────────────────────────────

let _anthropic: Anthropic | null = null;
let _openrouter: OpenAI | null = null;
let _gemini: GoogleGenAI | null = null;

function getAnthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

function getOpenRouter(): OpenAI {
  if (!_openrouter) {
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

function getGemini(): GoogleGenAI {
  if (!_gemini) _gemini = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return _gemini;
}

// ─── Unified chat resolution ───────────────────────────────────────────────────

export interface ResolvedChatClient {
  kind: ChatProviderKind;
  model: string;
  /** Anthropic SDK client (only set when kind === "anthropic") */
  anthropic?: Anthropic;
  /** OpenAI-compatible client (only set when kind === "openrouter") */
  openai?: OpenAI;
}

/**
 * Resolve the active (or explicitly requested) chat model into a ready client.
 * Pass `key` to override the default, e.g. for A/B testing different models.
 */
export function getChatClient(key: ChatModelKey = ACTIVE_CHAT_MODEL): ResolvedChatClient {
  const config = CHAT_MODELS[key];

  if (config.kind === "anthropic") {
    return { kind: "anthropic", model: config.model, anthropic: getAnthropic() };
  }

  return { kind: "openrouter", model: config.model, openai: getOpenRouter() };
}

// ─── Unified embedding resolution ──────────────────────────────────────────────

export interface EmbedInput {
  text?: string;
  imageUrl?: string;
}

/**
 * Generate an embedding using the active (or explicitly requested) embedding model.
 * Returns a flat number[] regardless of provider.
 */
export async function getEmbedding(
  input: EmbedInput,
  key: EmbeddingModelKey = ACTIVE_EMBEDDING_MODEL,
): Promise<number[]> {
  const config = EMBEDDING_MODELS[key];

  if (config.kind === "openrouter") {
    const client = getOpenRouter();

    const content: Array<Record<string, unknown>> = [];
    if (input.text) content.push({ type: "text", text: input.text });
    if (input.imageUrl) content.push({ type: "image_url", image_url: { url: input.imageUrl } });

    const res = await client.embeddings.create({
      model: config.model,
      input: [{ content }] as unknown as string[],
      encoding_format: "float",
    });

    return res.data[0]!.embedding as unknown as number[];
  }

  // Gemini
  const ai = getGemini();
  const result = await ai.models.embedContent({
    model: config.model,
    contents: input.text ?? "",
  });
  return result.embeddings?.[0]?.values ?? [];
}
