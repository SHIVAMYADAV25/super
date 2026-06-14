// import { ChatInput } from "@/src/schema";
// import { AgentAction } from "@/src/types";
// import Anthropic from "@anthropic-ai/sdk";
// import { AnthropicProvider } from "@corsair-dev/mcp";
// import { corsair } from "../lib/corsair";
// import { agentLogs } from "../db/schema";
// import { db } from "../db";
// import { logger } from "@/src/lib/logger";
// import { createExternalApiError } from "@/src/lib/errors";

// let anthropicClient : Anthropic | null = null;

// function getAnthropicClient() : Anthropic {
//     if(!anthropicClient){
//         anthropicClient = new Anthropic();
//     }

//     return anthropicClient;
// }

// // ─── MCP provider (builds Corsair tools for Anthropic) ────────────────────────

// let mcpProvider : AnthropicProvider | null = null

// function getMcpProvider() : AnthropicProvider{
//     if(!mcpProvider){
//         mcpProvider =  new AnthropicProvider();
//     }

//     return mcpProvider;
// }

// // ─── System prompt ────────────────────────────────────────────────────────────
 
// const SYSTEM_PROMPT = `You are an intelligent email and calendar assistant built into a Superhuman-style productivity app.
 
// You have access to the user's Gmail and Google Calendar through Corsair tools.
 
// Guidelines:
// - Always call corsair_setup first if you haven't confirmed credentials are ready
// - Use list_operations to discover available Gmail and Calendar endpoints
// - Use run_script to execute API calls with the corsair instance in scope
// - Be concise and action-oriented — users want things done, not explained
// - After completing actions, briefly summarise what you did
// - If you send an email or create a calendar event, confirm with the resource ID
// - Never make up information — if you don't know something, say so
// - Handle errors gracefully — if an action fails, explain why and suggest alternatives
 
// Example actions you can perform:
// - Send emails: corsair.withTenant(userId).gmail.api.messages.send({ raw: ... })
// - List emails: corsair.withTenant(userId).gmail.api.messages.list({ q: ... })
// - Create events: corsair.withTenant(userId).googlecalendar.api.events.create({ event: ... })
// - Check availability: corsair.withTenant(userId).googlecalendar.api.calendar.getAvailability({ ... })
// `;


// // ─── Parse actions from agent response ────────────────────────────────────────

// function extractActions(responseText:string):AgentAction[]{
//     const actions :AgentAction[] = [];

//     // Detect email sent
//   if (/email.*sent|sent.*email|message.*sent/i.test(responseText)) {
//     actions.push({ type: "email_sent", summary: "Email sent successfully" });
//   }

//   // Detect calendar event created
//   if (/event.*created|created.*event|meeting.*scheduled|scheduled.*meeting/i.test(responseText)) {
//     actions.push({ type: "event_created", summary: "Calendar event created" });
//   }

//   return actions;
// }

// // ─── Main chat handler ────────────────────────────────────────────────────────
 
// export interface ChatResponse {
//   reply: string;
//   actions: AgentAction[];
//   durationMs: number;
// }

// export async function processCommand(
//     userId : string,
//     input : ChatInput,
// ):Promise<ChatResponse>{
//     const startTime = Date.now();

//     try{
//         const client = getAnthropicClient();
//         const provider = getMcpProvider();
        
//         // Build Corsair tools scoped to this user's tenant
//         // AnthropicProvider.build() is synchronous per docs

//         const tenantCorsair = corsair.withTenant(userId);
//         const tools = provider.build({corsair : {tenantCorsair}});

//         // Build messages array with conversation history
//         const messages: Anthropic.MessageParam[] = [
//         ...input.conversationHistory.map((msg): Anthropic.MessageParam => ({
//             role: msg.role,
//             content: msg.content,
//         })),
//         { role: "user", content: input.prompt },
//         ];

//         // Run agent with tool loop via toolRunner
//         // toolRunner automatically handles multi-turn tool calls until final response

//         const message = await client.beta.messages.toolRunner({
//             model: "claude-sonnet-4-6",
//             max_tokens: 2048,
//             system: SYSTEM_PROMPT,
//             tools,
//             messages,
//         })

//         const reply =
//         message.content
//             .filter((b): b is Anthropic.TextBlock => b.type === "text")
//             .map((b) => b.text)
//             .join("\n") || "I completed the task but had no text to return.";

//         const actions = extractActions(reply);
//         const durationMs = Date.now() - startTime;

//         // Log to DB for audit trail (non-blocking)
//         void db.insert(agentLogs).values({
//         userId,
//         prompt: input.prompt,
//         response: reply,
//         actions,
//         durationMs: String(durationMs),
//         });

//         logger.info("Agent command processed", { userId, durationMs, actionsCount: actions.length });

//         return { reply, actions, durationMs };
//     }catch(err){
//         logger.error("Agent processCommand failed", { userId, error: String(err) });
//         throw createExternalApiError("Claude/Corsair MCP", err);
//     }
// }

// /**
//  * Streaming version — yields text chunks for real-time UI updates.
//  * Uses Anthropic streaming API with Corsair tools.
//  */

// export async function* streamCommand(
//     userId : string,
//     input : ChatInput
// ):AsyncGenerator<string> {
//     try{
//         const client = getAnthropicClient();
//         const provider = getMcpProvider();
    
//         const tenantCorsair = corsair.withTenant(userId);
//         const tools = provider.build({ corsair: tenantCorsair });

//         const messages: Anthropic.MessageParam[] = [
//         ...input.conversationHistory.map((msg): Anthropic.MessageParam => ({
//             role: msg.role,
//             content: msg.content,
//         })),
//         { role: "user", content: input.prompt },
//         ];

//         // Stream response — tool calls are processed automatically
//         const stream = await client.messages.stream({
//         model: "claude-sonnet-4-6",
//         max_tokens: 2048,
//         system: SYSTEM_PROMPT,
//         tools,
//         messages,
//         });

//         for await (const chunk of stream) {
//         if (
//             chunk.type === "content_block_delta" &&
//             chunk.delta.type === "text_delta"
//         ) {
//             yield chunk.delta.text;
//         }
//         }
//     }catch (err) {
//     logger.error("Agent streamCommand failed", { userId, error: String(err) });
//     yield `\n\n[Error: ${err instanceof Error ? err.message : "Something went wrong"}]`;
//   }
// }

/**
 * Chat service — multi-LLM agent that acts on Gmail + Google Calendar.
 *
 * Pattern mirrors calendar.service.ts:
 *   - tenantId (googleSub)  → passed to getTenant() / Corsair
 *   - userId   (DB UUID)    → used for DB writes, logging, audit trail
 *
 * Provider dispatch:
 *   - Anthropic  → full Corsair MCP tool-loop via toolRunner / messages.stream
 *   - OpenRouter → OpenAI-compatible chat.completions with optional tools array
 */

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "@corsair-dev/mcp";
import { corsair } from "../lib/corsair";
import { agentLogs } from "../db/schema";
import { db } from "../db";
import { logger } from "@/src/lib/logger";
import { createExternalApiError } from "@/src/lib/errors";
import { getChatClient, type ChatModelKey } from "../lib/llm-provider";
import type { ChatInput } from "@/src/schema";
import type { AgentAction } from "@/src/types";
import { getTenantId } from "../lib/corsair";
import OpenAI from "openai";
import { getOpenAIMcpConfig } from "@corsair-dev/mcp";
// ─── MCP provider singleton ────────────────────────────────────────────────────

let _mcpProvider: AnthropicProvider | null = null;

function getMcpProvider(): AnthropicProvider {
  if (!_mcpProvider) _mcpProvider = new AnthropicProvider();
  return _mcpProvider;
}

// ─── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(userEmail: string): string {
  const now = new Date().toISOString();

  return `You are an elite AI assistant embedded inside a Superhuman-style email and calendar productivity app. You have FULL access to the user's Gmail inbox and Google Calendar through Corsair MCP tools.

## Identity & Context
- User email: ${userEmail}
- Current time (UTC): ${now}
- Your role: Execute email and calendar actions DIRECTLY — you are not a chatbot, you are an action engine.

## Execution Protocol
You MUST follow this exact sequence on every turn:

1. **corsair_setup** — always call this first to verify credentials are ready. If it returns an error, diagnose and report the specific issue.
2. **list_operations** — discover available endpoints for gmail and googlecalendar.
3. **get_schema** — inspect parameters for the specific endpoint you need before calling it.
4. **run_script** — execute the action using the corsair instance in scope.

## How to use run_script
The script has access to a \`corsair\` variable scoped to this user's tenant. Always use it directly:

\`\`\`javascript
// List emails
const messages = await corsair.gmail.api.messages.list({ maxResults: 20, q: 'is:unread' });
return messages;

// Send email (build RFC 2822 raw)
const raw = btoa(['From: ${userEmail}', 'To: target@example.com', 'Subject: Hello', '', 'Body text'].join('\\r\\n')).replace(/\\+/g,'-').replace(/\\//g,'_');
const sent = await corsair.gmail.api.messages.send({ raw });
return sent;

// Create calendar event
const event = await corsair.googlecalendar.api.events.create({
  event: { summary: 'Meeting', start: { dateTime: '2025-06-15T10:00:00Z' }, end: { dateTime: '2025-06-15T11:00:00Z' } },
  sendUpdates: 'all'
});
return event;

// Check calendar availability
const freebusy = await corsair.googlecalendar.api.calendar.getAvailability({
  timeMin: new Date().toISOString(),
  timeMax: new Date(Date.now() + 7*24*60*60*1000).toISOString(),
  items: [{ id: 'primary' }]
});
return freebusy;
\`\`\`

## Capabilities
**Gmail:**
- List/search emails (with Gmail search operators: is:unread, from:, to:, subject:, has:attachment, newer_than:, etc.)
- Read full email content and thread
- Send emails (build RFC 2822 base64url encoded raw)
- Create, update, delete drafts
- Archive emails (remove INBOX label)
- Mark as read/unread
- Apply/remove labels

**Google Calendar:**
- List events with time range
- Get single event details
- Create events with attendees, timezone, location
- Update events
- RSVP (accept/decline/tentative)
- Check free/busy availability
- Detect scheduling conflicts

## Behavioural Rules
- **ALWAYS execute** — never ask "shall I proceed?" for clear instructions. Just do it.
- **Be precise** — confirm with exact resource IDs after actions (message ID, event ID)
- **Handle errors** — if an action fails, explain the root cause and try an alternative
- **Thread awareness** — when replying to emails, fetch the thread first to maintain context
- **Timezone** — always use ISO 8601 with timezone offsets when creating events
- **Batch operations** — for multiple items (e.g. archive all unread), batch them efficiently
- **Never fabricate** — if you can't find something, say so. Don't invent email content or event details.
- **Concise output** — after completing tasks, give a 1-3 line summary. No verbose explanations.

## Complex Task Handling
For multi-step tasks (e.g. "schedule a meeting with everyone in this thread and send them a calendar invite"):
1. Extract all attendee emails from the thread
2. Check availability for each attendee
3. Find a common free slot
4. Create the event with all attendees
5. Confirm with event ID and invite status

For search-heavy tasks, use Gmail's powerful search operators:
- Unread from boss: \`from:boss@company.com is:unread\`
- This week's emails: \`newer_than:7d\`
- Large attachments: \`has:attachment larger:5M\`
`;
}

// ─── Action extraction ─────────────────────────────────────────────────────────

function extractActions(responseText: string): AgentAction[] {
  const actions: AgentAction[] = [];

  if (/email.*sent|sent.*email|message.*sent|draft.*sent/i.test(responseText)) {
    const idMatch = responseText.match(/message[_\s]?id[:\s]+([a-zA-Z0-9_-]+)/i);
    actions.push({
      type: "email_sent",
      summary: "Email sent successfully",
      resourceId: idMatch?.[1],
    });
  }

  if (/event.*created|created.*event|meeting.*scheduled|scheduled.*meeting|calendar.*added/i.test(responseText)) {
    const idMatch = responseText.match(/event[_\s]?id[:\s]+([a-zA-Z0-9_@.]+)/i);
    actions.push({
      type: "event_created",
      summary: "Calendar event created",
      resourceId: idMatch?.[1],
    });
  }

  if (/event.*updated|updated.*event|meeting.*rescheduled|rsvp.*updated/i.test(responseText)) {
    actions.push({
      type: "event_updated",
      summary: "Calendar event updated",
    });
  }

  return actions;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ChatResponse {
  reply: string;
  actions: AgentAction[];
  durationMs: number;
  model: string;
}

// ─── processCommand (non-streaming) ───────────────────────────────────────────

export async function processCommand(
  tenantId: string,   // googleSub — for Corsair tenant scoping
  userId: string,     // DB UUID  — for DB writes / audit logs
  userEmail: string,  // for prompt context
  input: ChatInput,
  modelKey?: ChatModelKey,
): Promise<ChatResponse> {
  
  const startTime = Date.now();
  const client = getChatClient(modelKey);

  console.log("MODEL USED:", {
    key: modelKey,
    model: client.model,
    kind: client.kind,
  });

  logger.info("processCommand start", { userId, model: client.model });

  try {
    const systemPrompt = buildSystemPrompt(userEmail);
    const corsairTenantId = getTenantId(tenantId);

    const userMessages = [
      ...input.conversationHistory.map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
      { role: "user" as const, content: input.prompt },
    ];

    let reply: string;

    if (client.kind === "anthropic") {
      // Full Corsair MCP tool-loop via Anthropic toolRunner
      const tenantCorsair = corsair.withTenant(corsairTenantId);
      const tools = getMcpProvider().build({ corsair: tenantCorsair });

      const message = await client.anthropic!.beta.messages.toolRunner({
        model: client.model,
        max_tokens: client.maxTokens,
        system: systemPrompt,
        tools,
        messages: userMessages as Anthropic.MessageParam[],
      });

      reply =
        message.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim() || "Task completed.";
    } else {
      // OpenRouter: OpenAI-compatible chat completion
      // For models that support tools, we pass OpenAI-format function definitions
      // For reasoning-only models we do plain chat
      const openai = client.openai!;

      if (client.supportsTools) {
        // Build simple tool definitions that describe what Corsair can do
        // const tools: OpenAI.Chat.ChatCompletionTool[] = [
        //   {
        //     type: "function",
        //     function: {
        //       name: "execute_gmail_action",
        //       description: "Execute a Gmail action: list, read, send, archive, label emails",
        //       parameters: {
        //         type: "object",
        //         properties: {
        //           action: { type: "string", enum: ["list", "read", "send", "archive", "label", "search"] },
        //           params: { type: "object", description: "Action-specific parameters" },
        //         },
        //         required: ["action", "params"],
        //       },
        //     },
        //   },
        //   {
        //     type: "function",
        //     function: {
        //       name: "execute_calendar_action",
        //       description: "Execute a Google Calendar action: list, create, update, delete events, check availability",
        //       parameters: {
        //         type: "object",
        //         properties: {
        //           action: { type: "string", enum: ["list", "create", "update", "delete", "availability", "rsvp"] },
        //           params: { type: "object", description: "Action-specific parameters" },
        //         },
        //         required: ["action", "params"],
        //       },
        //     },
        //   },
        // ];

        const client = new OpenAI({
          apiKey: process.env.OPENROUTER_API_KEY,
          baseURL: "https://openrouter.ai/api/v1",
        });
        

        // const completion = await openai.chat.completions.create({
        //   model: client.model,
        //   messages: [
        //     { role: "system", content: systemPrompt },
        //     ...userMessages,
        //   ],
        //   tools,
        //   tool_choice: "auto",
        // //   reasoning: { enabled: true } as Record<string, unknown>,
        // });

        const response = await client.responses.create({
  model: "openai/gpt-oss-120b:free",

  tools: [
  {
    type: "mcp",
    server_label: "corsair",
    server_url: `${process.env.NEXTAUTH_URL}/api/mcp`,
  },
],

  input: input.prompt,
});

reply = response.output_text || "Task completed.";

        // Handle tool calls if present
        // const choice = completion.choices[0]!;
        // const choice = completion.choices[0]!;
        // reply = choice.message.content ?? "Task completed.";
        // if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
//           const tenantCorsair = corsair.withTenant(corsairTenantId);
//           const toolResults: string[] = [];

//           for (const toolCall of choice.message.tool_calls) {
//   if (toolCall.type !== "function") {
//     continue;
//   }

//   try {
//     const args = JSON.parse(toolCall.function.arguments);
//     let result: unknown;

//     if (toolCall.function.name === "execute_gmail_action") {
//       result = await dispatchGmailAction(
//         tenantCorsair,
//         args.action,
//         args.params,
//       );
//     } else if (
//       toolCall.function.name === "execute_calendar_action"
//     ) {
//       result = await dispatchCalendarAction(
//         tenantCorsair,
//         args.action,
//         args.params,
//       );
//     }

//     toolResults.push(
//       `${toolCall.function.name}: ${JSON.stringify(result)}`
//     );
//   } catch (toolErr) {
//     toolResults.push(
//       `${toolCall.function.name} error: ${String(toolErr)}`
//     );
//   }
// }

//           // Second pass: summarize results
//           const followUp = await openai.chat.completions.create({
//             model: client.model,
//             messages: [
//               { role: "system", content: systemPrompt },
//               ...userMessages,
//               { role: "assistant", content: choice.message.content ?? "" },
//               { role: "user", content: `Tool results:\n${toolResults.join("\n")}\n\nSummarize what was accomplished.` },
//             ],
//           });

//           reply = followUp.choices[0]?.message?.content ?? "Task completed.";
        // } else {
        //   reply = choice.message.content ?? "Task completed.";
        // }
      } else {
        // Reasoning model — plain completion
        const completion = await openai.chat.completions.create({
          model: client.model,
          messages: [
            { role: "system", content: systemPrompt },
            ...userMessages,
          ],
        });
        reply = completion.choices[0]?.message?.content ?? "Task completed.";
      }
    }

    const actions = extractActions(reply);
    const durationMs = Date.now() - startTime;

    void db.insert(agentLogs).values({
      userId,
      prompt: input.prompt,
      response: reply,
      actions,
      durationMs: String(durationMs),
    }).catch((err) => logger.warn("agentLog insert failed", { error: String(err) }));

    logger.info("processCommand done", { userId, model: client.model, durationMs });

    return { reply, actions, durationMs, model: client.model };
  } catch (err) {
    logger.error("processCommand failed", { userId, model: client.model, error: String(err) });
    throw createExternalApiError("LLM Agent", err);
  }
}

// ─── streamCommand (SSE streaming) ────────────────────────────────────────────

export async function* streamCommand(
  tenantId: string,   // googleSub
  userId: string,     // DB UUID
  userEmail: string,
  input: ChatInput,
  modelKey?: ChatModelKey,
): AsyncGenerator<string> {
  const client = getChatClient(modelKey);
  logger.info("streamCommand start", { userId, model: client.model });

  const systemPrompt = buildSystemPrompt(userEmail);
  const corsairTenantId = getTenantId(tenantId);

  const userMessages = [
    ...input.conversationHistory.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    })),
    { role: "user" as const, content: input.prompt },
  ];

  try {
    if (client.kind === "anthropic") {
      const tenantCorsair = corsair.withTenant(corsairTenantId);
      const tools = getMcpProvider().build({ corsair: tenantCorsair });

      const stream = client.anthropic!.messages.stream({
        model: client.model,
        max_tokens: client.maxTokens,
        system: systemPrompt,
        tools,
        messages: userMessages as Anthropic.MessageParam[],
      });

      for await (const chunk of stream) {
        if (
          chunk.type === "content_block_delta" &&
          chunk.delta.type === "text_delta"
        ) {
          yield chunk.delta.text;
        }
      }
    } else {
      const openai = client.openai!;

      const stream = await openai.chat.completions.create({
        model: client.model,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          ...userMessages,
        ],
        // Enable reasoning for OpenRouter models that support it
        // reasoning: { enabled: true } as Record<string, unknown>,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
    }
  } catch (err) {
    logger.error("streamCommand failed", { userId, model: client.model, error: String(err) });
    yield `\n\n[Error: ${err instanceof Error ? err.message : "Something went wrong"}]`;
  }
}

// ─── Corsair dispatch helpers (for OpenRouter tool-call path) ─────────────────

import type { CorsairTenant } from "../lib/corsair";
// type OpenAI = import("openai").default;

// async function dispatchGmailAction(
//   tenant: CorsairTenant,
//   action: string,
//   params: Record<string, unknown>,
// ): Promise<unknown> {
//   switch (action) {
//     case "list":
//     case "search":
//       return tenant.gmail.api.messages.list({
//         maxResults: (params.maxResults as number) ?? 20,
//         q: params.q as string | undefined,
//         labelIds: params.labelIds as string[] | undefined,
//       });
//     case "read":
//       return tenant.gmail.api.messages.get({ id: params.id as string });
//     case "send": {
//       const lines = [
//         `From: me`,
//         `To: ${params.to}`,
//         ...(params.cc ? [`Cc: ${params.cc}`] : []),
//         `Subject: ${params.subject}`,
//         `Content-Type: text/plain; charset=utf-8`,
//         ``,
//         params.body as string,
//       ];
//       const raw = Buffer.from(lines.join("\r\n"))
//         .toString("base64")
//         .replace(/\+/g, "-")
//         .replace(/\//g, "_")
//         .replace(/=+$/, "");
//       return tenant.gmail.api.messages.send({ raw });
//     }
//     default:
//       throw new Error(`Unknown gmail action: ${action}`);
//   }
// }

// async function dispatchCalendarAction(
//   tenant: CorsairTenant,
//   action: string,
//   params: Record<string, unknown>,
// ): Promise<unknown> {
//   switch (action) {
//     case "list":
//       return tenant.googlecalendar.api.events.getMany({
//         timeMin: (params.timeMin as string) ?? new Date().toISOString(),
//         timeMax: params.timeMax as string | undefined,
//         maxResults: (params.maxResults as number) ?? 20,
//         singleEvents: true,
//         orderBy: "startTime",
//       });
//     case "create":
//       return tenant.googlecalendar.api.events.create({
//         event: params.event as Record<string, unknown>,
//         sendUpdates: (params.sendUpdates as "all" | "externalOnly" | "none") ?? "all",
//       });
//     case "update":
//       return tenant.googlecalendar.api.events.update({
//         id: params.id as string,
//         event: params.event as Record<string, unknown>,
//         sendUpdates: (params.sendUpdates as "all" | "externalOnly" | "none") ?? "all",
//       });
//     case "availability":
//       return tenant.googlecalendar.api.calendar.getAvailability({
//         timeMin: params.timeMin as string,
//         timeMax: params.timeMax as string,
//         items: (params.items as Array<{ id: string }>) ?? [{ id: "primary" }],
//       });
//     default:
//       throw new Error(`Unknown calendar action: ${action}`);
//   }
// }