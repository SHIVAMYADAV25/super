import { ChatInput } from "@/src/schema";
import { AgentAction } from "@/src/types";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "@corsair-dev/mcp";
import { corsair } from "../lib/corsair";
import { agentLogs } from "../db/schema";
import { db } from "../db";
import { logger } from "@/src/lib/logger";
import { createExternalApiError } from "@/src/lib/errors";

let anthropicClient : Anthropic | null = null;

function getAnthropicClient() : Anthropic {
    if(!anthropicClient){
        anthropicClient = new Anthropic();
    }

    return anthropicClient;
}

// ─── MCP provider (builds Corsair tools for Anthropic) ────────────────────────

let mcpProvider : AnthropicProvider | null = null

function getMcpProvider() : AnthropicProvider{
    if(!mcpProvider){
        mcpProvider =  new AnthropicProvider();
    }

    return mcpProvider;
}

// ─── System prompt ────────────────────────────────────────────────────────────
 
const SYSTEM_PROMPT = `You are an intelligent email and calendar assistant built into a Superhuman-style productivity app.
 
You have access to the user's Gmail and Google Calendar through Corsair tools.
 
Guidelines:
- Always call corsair_setup first if you haven't confirmed credentials are ready
- Use list_operations to discover available Gmail and Calendar endpoints
- Use run_script to execute API calls with the corsair instance in scope
- Be concise and action-oriented — users want things done, not explained
- After completing actions, briefly summarise what you did
- If you send an email or create a calendar event, confirm with the resource ID
- Never make up information — if you don't know something, say so
- Handle errors gracefully — if an action fails, explain why and suggest alternatives
 
Example actions you can perform:
- Send emails: corsair.withTenant(userId).gmail.api.messages.send({ raw: ... })
- List emails: corsair.withTenant(userId).gmail.api.messages.list({ q: ... })
- Create events: corsair.withTenant(userId).googlecalendar.api.events.create({ event: ... })
- Check availability: corsair.withTenant(userId).googlecalendar.api.calendar.getAvailability({ ... })
`;


// ─── Parse actions from agent response ────────────────────────────────────────

function extractActions(responseText:string):AgentAction[]{
    const actions :AgentAction[] = [];

    // Detect email sent
  if (/email.*sent|sent.*email|message.*sent/i.test(responseText)) {
    actions.push({ type: "email_sent", summary: "Email sent successfully" });
  }

  // Detect calendar event created
  if (/event.*created|created.*event|meeting.*scheduled|scheduled.*meeting/i.test(responseText)) {
    actions.push({ type: "event_created", summary: "Calendar event created" });
  }

  return actions;
}

// ─── Main chat handler ────────────────────────────────────────────────────────
 
export interface ChatResponse {
  reply: string;
  actions: AgentAction[];
  durationMs: number;
}

export async function processCommand(
    userId : string,
    input : ChatInput,
):Promise<ChatResponse>{
    const startTime = Date.now();

    try{
        const client = getAnthropicClient();
        const provider = getMcpProvider();
        
        // Build Corsair tools scoped to this user's tenant
        // AnthropicProvider.build() is synchronous per docs

        const tenantCorsair = corsair.withTenant(userId);
        const tools = provider.build({corsair : {tenantCorsair}});

        // Build messages array with conversation history
        const messages: Anthropic.MessageParam[] = [
        ...input.conversationHistory.map((msg): Anthropic.MessageParam => ({
            role: msg.role,
            content: msg.content,
        })),
        { role: "user", content: input.prompt },
        ];

        // Run agent with tool loop via toolRunner
        // toolRunner automatically handles multi-turn tool calls until final response

        const message = await client.beta.messages.toolRunner({
            model: "claude-sonnet-4-6",
            max_tokens: 2048,
            system: SYSTEM_PROMPT,
            tools,
            messages,
        })

        const reply =
        message.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n") || "I completed the task but had no text to return.";

        const actions = extractActions(reply);
        const durationMs = Date.now() - startTime;

        // Log to DB for audit trail (non-blocking)
        void db.insert(agentLogs).values({
        userId,
        prompt: input.prompt,
        response: reply,
        actions,
        durationMs: String(durationMs),
        });

        logger.info("Agent command processed", { userId, durationMs, actionsCount: actions.length });

        return { reply, actions, durationMs };
    }catch(err){
        logger.error("Agent processCommand failed", { userId, error: String(err) });
        throw createExternalApiError("Claude/Corsair MCP", err);
    }
}

/**
 * Streaming version — yields text chunks for real-time UI updates.
 * Uses Anthropic streaming API with Corsair tools.
 */

export async function* stream(
    userId : string,
    input : ChatInput
):AsyncGenerator<string> {
    try{
        const client = getAnthropicClient();
        const provider = getMcpProvider();
    
        const tenantCorsair = corsair.withTenant(userId);
        const tools = provider.build({ corsair: tenantCorsair });

        const messages: Anthropic.MessageParam[] = [
        ...input.conversationHistory.map((msg): Anthropic.MessageParam => ({
            role: msg.role,
            content: msg.content,
        })),
        { role: "user", content: input.prompt },
        ];

        // Stream response — tool calls are processed automatically
        const stream = await client.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools,
        messages,
        });

        for await (const chunk of stream) {
        if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
        ) {
            yield chunk.delta.text;
        }
        }
    }catch (err) {
    logger.error("Agent streamCommand failed", { userId, error: String(err) });
    yield `\n\n[Error: ${err instanceof Error ? err.message : "Something went wrong"}]`;
  }
}