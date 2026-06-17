// src/server/services/agent.ts
// ─── CHANGES FROM ORIGINAL ────────────────────────────────────────────────────
// Only runNexAgent() emitter calls are changed — everything else identical.
// Added richer SSE payloads so frontend can show step-by-step tool cards:
//   { level, message, toolName?, toolStatus?, toolArgs?, toolResult? }
// The SSEEvent type in @/src/types must accept data: Record<string,unknown>
// which it already does (it's just { type: string; data: unknown }).
// ─────────────────────────────────────────────────────────────────────────────

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "@corsair-dev/mcp";
import { corsair, getTenantId } from "../lib/corsair";
import { agentLogs } from "../db/schema";
import { db } from "../db";
import { logger } from "@/src/lib/logger";
import { createExternalApiError } from "@/src/lib/errors";
import type { ChatInput } from "@/src/schema";
import type { AgentAction } from "@/src/types";
import { env } from "@/src/env";
import type { CorsairTenant } from "../lib/corsair";
import { emitToUser } from "../lib/sse";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type AgentProvider = "anthropic" | "openai_agents" | "nex";

export interface ChatResponse {
  reply: string;
  actions: AgentAction[];
  durationMs: number;
  model: string;
  routedTo: "chat" | "agent";
}

// ─── OpenRouter client ─────────────────────────────────────────────────────────

let _orClient: OpenAI | null = null;
function getOpenRouterClient(): OpenAI {
  if (!_orClient) {
    const key = env.OPENROUTER_API_KEY;
    if (!key) throw new Error("OPENROUTER_API_KEY is required");
    _orClient = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: key,
      defaultHeaders: {
        "HTTP-Referer": env.NEXTAUTH_URL ?? "http://localhost:3000",
        "X-Title": "Superhuman",
      },
    });
  }
  return _orClient;
}

// ─── Intent router ─────────────────────────────────────────────────────────────

const AGENT_KEYWORDS = [
  "send email","send an email","draft email","reply to","forward",
  "calendar invite","calendar event","schedule","reschedule","meeting",
  "create event","invite","rsvp","accept invite","decline invite",
  "check availability","free slot","archive","mark as read","mark read",
  "unread","label","search email","find email","trash","delete email",
  "list emails","show emails","read email","open email","get emails",
  "upcoming events","my calendar","what's on","today's events",
];

function quickKeywordCheck(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return AGENT_KEYWORDS.some((kw) => lower.includes(kw));
}

const ROUTER_SYSTEM = `You are an intent classifier. Decide if the user wants to perform a Gmail or Google Calendar action (agent) or is just having a conversation (chat).
Reply with EXACTLY one word — "agent" or "chat" — nothing else.`;

async function classifyIntent(prompt: string): Promise<"chat" | "agent"> {
  if (quickKeywordCheck(prompt)) {
    logger.debug("Router: keyword → agent");
    return "agent";
  }
  try {
    const client = getOpenRouterClient();
    const res = await client.chat.completions.create({
      model: "nex-agi/nex-n2-pro:free",
      max_tokens: 5,
      temperature: 0,
      messages: [
        { role: "system", content: ROUTER_SYSTEM },
        { role: "user", content: prompt.slice(0, 400) },
      ],
    });
    const raw = res.choices[0]?.message?.content?.trim().toLowerCase() ?? "";
    return raw.startsWith("agent") ? "agent" : "chat";
  } catch {
    return "chat";
  }
}

// ─── Chat path ─────────────────────────────────────────────────────────────────

const CHAT_SYSTEM = `You are a helpful assistant inside a Superhuman-style email and calendar app.
Answer concisely. If the user seems to want to perform an email or calendar action, remind them they can ask directly.`;

// ─── Tool Registry ──────────────────────────────────────────────────────────────

function buildToolRegistry(): OpenAI.Chat.ChatCompletionTool[] {
  return [
    { type: "function", function: { name: "gmail_messages_list", description: "List or search messages in the Gmail mailbox.", parameters: { type: "object", properties: { q: { type: "string" }, maxResults: { type: "number" }, labelIds: { type: "array", items: { type: "string" } }, pageToken: { type: "string" }, includeSpamTrash: { type: "boolean" } }, required: [] } } },
    { type: "function", function: { name: "gmail_messages_get", description: "Get a specific Gmail message by ID.", parameters: { type: "object", properties: { id: { type: "string" }, format: { type: "string", enum: ["minimal","full","raw","metadata"] } }, required: ["id"] } } },
    { type: "function", function: { name: "gmail_messages_send", description: "Send an email.", parameters: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, cc: { type: "string" }, bcc: { type: "string" }, fromEmail: { type: "string" }, threadId: { type: "string" } }, required: ["to","subject","body"] } } },
    { type: "function", function: { name: "gmail_messages_modify", description: "Add or remove labels from a message.", parameters: { type: "object", properties: { id: { type: "string" }, addLabelIds: { type: "array", items: { type: "string" } }, removeLabelIds: { type: "array", items: { type: "string" } } }, required: ["id"] } } },
    { type: "function", function: { name: "gmail_messages_trash", description: "Move a message to trash.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
    { type: "function", function: { name: "gmail_messages_untrash", description: "Restore a message from trash.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
    { type: "function", function: { name: "gmail_messages_batch_modify", description: "Bulk label operations on multiple messages.", parameters: { type: "object", properties: { ids: { type: "array", items: { type: "string" } }, addLabelIds: { type: "array", items: { type: "string" } }, removeLabelIds: { type: "array", items: { type: "string" } } }, required: ["ids"] } } },
    { type: "function", function: { name: "gmail_threads_list", description: "List email threads.", parameters: { type: "object", properties: { q: { type: "string" }, maxResults: { type: "number" }, labelIds: { type: "array", items: { type: "string" } }, pageToken: { type: "string" } }, required: [] } } },
    { type: "function", function: { name: "gmail_threads_get", description: "Get a full thread by ID.", parameters: { type: "object", properties: { id: { type: "string" }, format: { type: "string", enum: ["minimal","full","metadata"] } }, required: ["id"] } } },
    { type: "function", function: { name: "gmail_threads_modify", description: "Modify thread labels.", parameters: { type: "object", properties: { id: { type: "string" }, addLabelIds: { type: "array", items: { type: "string" } }, removeLabelIds: { type: "array", items: { type: "string" } } }, required: ["id"] } } },
    { type: "function", function: { name: "gmail_threads_trash", description: "Trash an entire thread.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
    { type: "function", function: { name: "gmail_drafts_create", description: "Create a draft.", parameters: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, cc: { type: "string" }, threadId: { type: "string" } }, required: ["to","subject","body"] } } },
    { type: "function", function: { name: "gmail_drafts_list", description: "List drafts.", parameters: { type: "object", properties: { maxResults: { type: "number" }, q: { type: "string" } }, required: [] } } },
    { type: "function", function: { name: "gmail_drafts_send", description: "Send an existing draft.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
    { type: "function", function: { name: "gmail_drafts_delete", description: "Delete a draft.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
    { type: "function", function: { name: "gmail_labels_list", description: "List all Gmail labels.", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "gmail_labels_create", description: "Create a label.", parameters: { type: "object", properties: { name: { type: "string" }, messageListVisibility: { type: "string", enum: ["show","hide"] }, labelListVisibility: { type: "string", enum: ["labelShow","labelShowIfUnread","labelHide"] } }, required: ["name"] } } },
    { type: "function", function: { name: "gmail_db_messages_search", description: "Search local Gmail cache.", parameters: { type: "object", properties: { subject: { type: "string" }, body: { type: "string" }, from: { type: "string" }, to: { type: "string" }, snippet: { type: "string" }, threadId: { type: "string" }, limit: { type: "number" }, offset: { type: "number" } }, required: [] } } },
    { type: "function", function: { name: "gmail_db_threads_search", description: "Search local thread cache.", parameters: { type: "object", properties: { snippet: { type: "string" }, limit: { type: "number" }, offset: { type: "number" } }, required: [] } } },
    { type: "function", function: { name: "gmail_db_drafts_search", description: "Search local drafts cache.", parameters: { type: "object", properties: { limit: { type: "number" }, offset: { type: "number" } }, required: [] } } },
    { type: "function", function: { name: "gmail_db_labels_search", description: "Search local labels cache.", parameters: { type: "object", properties: { name: { type: "string" }, limit: { type: "number" } }, required: [] } } },
    { type: "function", function: { name: "calendar_events_list", description: "List Google Calendar events.", parameters: { type: "object", properties: { timeMin: { type: "string" }, timeMax: { type: "string" }, q: { type: "string" }, maxResults: { type: "number" }, singleEvents: { type: "boolean" }, orderBy: { type: "string", enum: ["startTime","updated"] }, calendarId: { type: "string" }, showDeleted: { type: "boolean" } }, required: [] } } },
    { type: "function", function: { name: "calendar_events_get", description: "Get a calendar event by ID.", parameters: { type: "object", properties: { id: { type: "string" }, calendarId: { type: "string" } }, required: ["id"] } } },
    { type: "function", function: { name: "calendar_events_create", description: "Create a calendar event.", parameters: { type: "object", properties: { summary: { type: "string" }, description: { type: "string" }, location: { type: "string" }, startDateTime: { type: "string" }, endDateTime: { type: "string" }, timeZone: { type: "string" }, attendees: { type: "array", items: { type: "string" } }, sendUpdates: { type: "string", enum: ["all","externalOnly","none"] }, calendarId: { type: "string" }, recurrence: { type: "array", items: { type: "string" } } }, required: ["summary","startDateTime","endDateTime"] } } },
    { type: "function", function: { name: "calendar_events_update", description: "Update a calendar event.", parameters: { type: "object", properties: { id: { type: "string" }, summary: { type: "string" }, description: { type: "string" }, location: { type: "string" }, startDateTime: { type: "string" }, endDateTime: { type: "string" }, timeZone: { type: "string" }, attendees: { type: "array", items: { type: "string" } }, sendUpdates: { type: "string", enum: ["all","externalOnly","none"] }, calendarId: { type: "string" } }, required: ["id"] } } },
    { type: "function", function: { name: "calendar_events_delete", description: "Delete a calendar event.", parameters: { type: "object", properties: { id: { type: "string" }, calendarId: { type: "string" }, sendUpdates: { type: "string", enum: ["all","externalOnly","none"] } }, required: ["id"] } } },
    { type: "function", function: { name: "calendar_get_availability", description: "Check free/busy for calendars.", parameters: { type: "object", properties: { timeMin: { type: "string" }, timeMax: { type: "string" }, calendarIds: { type: "array", items: { type: "string" } }, timeZone: { type: "string" } }, required: ["timeMin","timeMax"] } } },
    { type: "function", function: { name: "calendar_db_events_search", description: "Search local calendar event cache.", parameters: { type: "object", properties: { summary: { type: "string" }, description: { type: "string" }, location: { type: "string" }, calendarId: { type: "string" }, recurringEventId: { type: "string" }, limit: { type: "number" }, offset: { type: "number" } }, required: [] } } },
    { type: "function", function: { name: "calendar_db_calendars_search", description: "Search local calendars cache.", parameters: { type: "object", properties: { summary: { type: "string" }, timeZone: { type: "string" }, limit: { type: "number" } }, required: [] } } },
  ];
}

// ─── Tool executor ──────────────────────────────────────────────────────────────

function buildRawEmail(opts: { from?: string; to: string; cc?: string; bcc?: string; subject: string; body: string; threadId?: string }): string {
  const lines = [
    opts.from ? `From: ${opts.from}` : null,
    `To: ${opts.to}`,
    opts.cc ? `Cc: ${opts.cc}` : null,
    opts.bcc ? `Bcc: ${opts.bcc}` : null,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    opts.body,
  ].filter((l): l is string => l !== null).join("\r\n");
  return Buffer.from(lines).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type ToolArgs = Record<string, unknown>;

async function executeTool(name: string, args: ToolArgs, tenant: CorsairTenant, userEmail: string): Promise<unknown> {
  switch (name) {
    case "gmail_messages_list":
      return tenant.gmail.api.messages.list({ q: args.q as string | undefined, maxResults: (args.maxResults as number | undefined) ?? 20, labelIds: args.labelIds as string[] | undefined, pageToken: args.pageToken as string | undefined, includeSpamTrash: args.includeSpamTrash as boolean | undefined });
    case "gmail_messages_get":
      return tenant.gmail.api.messages.get({ id: args.id as string, format: (args.format as "minimal" | "full" | "raw" | "metadata") ?? "full" });
    case "gmail_messages_send": {
      const raw = buildRawEmail({ from: userEmail, to: args.to as string, cc: args.cc as string | undefined, bcc: args.bcc as string | undefined, subject: args.subject as string, body: args.body as string, threadId: args.threadId as string | undefined });
      return tenant.gmail.api.messages.send({ raw, threadId: args.threadId as string | undefined });
    }
    case "gmail_messages_modify":
      return tenant.gmail.api.messages.modify({ id: args.id as string, addLabelIds: args.addLabelIds as string[] | undefined, removeLabelIds: args.removeLabelIds as string[] | undefined });
    case "gmail_messages_trash":
      return tenant.gmail.api.messages.trash({ id: args.id as string });
    case "gmail_messages_untrash":
      return tenant.gmail.api.messages.untrash({ id: args.id as string });
    case "gmail_messages_batch_modify":
      return tenant.gmail.api.messages.batchModify({ ids: args.ids as string[], addLabelIds: args.addLabelIds as string[] | undefined, removeLabelIds: args.removeLabelIds as string[] | undefined });
    case "gmail_threads_list":
      return tenant.gmail.api.threads.list({ q: args.q as string | undefined, maxResults: (args.maxResults as number | undefined) ?? 20, labelIds: args.labelIds as string[] | undefined, pageToken: args.pageToken as string | undefined });
    case "gmail_threads_get":
      return tenant.gmail.api.threads.get({ id: args.id as string, format: (args.format as "minimal" | "full" | "metadata") ?? "full" });
    case "gmail_threads_modify":
      return tenant.gmail.api.threads.modify({ id: args.id as string, addLabelIds: args.addLabelIds as string[] | undefined, removeLabelIds: args.removeLabelIds as string[] | undefined });
    case "gmail_threads_trash":
      return tenant.gmail.api.threads.trash({ id: args.id as string });
    case "gmail_drafts_create": {
      const raw = buildRawEmail({ from: userEmail, to: args.to as string, cc: args.cc as string | undefined, subject: args.subject as string, body: args.body as string, threadId: args.threadId as string | undefined });
      return tenant.gmail.api.drafts.create({ draft: { message: { raw, threadId: args.threadId as string | undefined } } });
    }
    case "gmail_drafts_list":
      return tenant.gmail.api.drafts.list({ maxResults: args.maxResults as number | undefined, q: args.q as string | undefined });
    case "gmail_drafts_send":
      return tenant.gmail.api.drafts.send({ id: args.id as string });
    case "gmail_drafts_delete":
      return tenant.gmail.api.drafts.delete({ id: args.id as string });
    case "gmail_labels_list":
      return tenant.gmail.api.labels.list({});
    case "gmail_labels_create":
      return tenant.gmail.api.labels.create({ label: { name: args.name as string, messageListVisibility: args.messageListVisibility as "show" | "hide" | undefined, labelListVisibility: args.labelListVisibility as "labelShow" | "labelShowIfUnread" | "labelHide" | undefined } });
    case "gmail_db_messages_search": {
      const data: Record<string, unknown> = {};
      if (args.subject) data.subject = { contains: args.subject };
      if (args.body) data.body = { contains: args.body };
      if (args.from) data.from = { contains: args.from };
      if (args.to) data.to = { contains: args.to };
      if (args.snippet) data.snippet = { contains: args.snippet };
      if (args.threadId) data.threadId = { equals: args.threadId };
      return tenant.gmail.db.messages.search({ data, limit: (args.limit as number | undefined) ?? 20, offset: (args.offset as number | undefined) ?? 0 });
    }
    case "gmail_db_threads_search": {
      const data: Record<string, unknown> = {};
      if (args.snippet) data.snippet = { contains: args.snippet };
      return tenant.gmail.db.threads.search({ data, limit: (args.limit as number | undefined) ?? 20, offset: (args.offset as number | undefined) ?? 0 });
    }
    case "gmail_db_drafts_search":
      return tenant.gmail.db.drafts.search({ data: {}, limit: (args.limit as number | undefined) ?? 20, offset: (args.offset as number | undefined) ?? 0 });
    case "gmail_db_labels_search": {
      const data: Record<string, unknown> = {};
      if (args.name) data.name = { contains: args.name };
      return tenant.gmail.db.labels.search({ data, limit: (args.limit as number | undefined) ?? 50 });
    }
    case "calendar_events_list":
      return tenant.googlecalendar.api.events.getMany({ calendarId: (args.calendarId as string | undefined) ?? "primary", timeMin: (args.timeMin as string | undefined) ?? new Date().toISOString(), timeMax: args.timeMax as string | undefined, q: args.q as string | undefined, maxResults: (args.maxResults as number | undefined) ?? 20, singleEvents: (args.singleEvents as boolean | undefined) ?? true, orderBy: (args.orderBy as "startTime" | "updated" | undefined) ?? "startTime", showDeleted: args.showDeleted as boolean | undefined });
    case "calendar_events_get":
      return tenant.googlecalendar.api.events.get({ id: args.id as string, calendarId: (args.calendarId as string | undefined) ?? "primary" });
    case "calendar_events_create": {
      const attendees = (args.attendees as string[] | undefined)?.map((email) => ({ email }));
      return tenant.googlecalendar.api.events.create({ calendarId: (args.calendarId as string | undefined) ?? "primary", event: { summary: args.summary as string, description: args.description as string | undefined, location: args.location as string | undefined, start: { dateTime: args.startDateTime as string, timeZone: args.timeZone as string | undefined }, end: { dateTime: args.endDateTime as string, timeZone: args.timeZone as string | undefined }, attendees, recurrence: args.recurrence as string[] | undefined }, sendUpdates: ((args.sendUpdates as string | undefined) ?? "all") as "all" | "externalOnly" | "none" });
    }
    case "calendar_events_update": {
      const attendees = (args.attendees as string[] | undefined)?.map((email) => ({ email }));
      const eventPatch: Record<string, unknown> = {};
      if (args.summary) eventPatch.summary = args.summary;
      if (args.description) eventPatch.description = args.description;
      if (args.location) eventPatch.location = args.location;
      if (args.startDateTime) eventPatch.start = { dateTime: args.startDateTime, timeZone: args.timeZone };
      if (args.endDateTime) eventPatch.end = { dateTime: args.endDateTime, timeZone: args.timeZone };
      if (attendees) eventPatch.attendees = attendees;
      return tenant.googlecalendar.api.events.update({ id: args.id as string, calendarId: (args.calendarId as string | undefined) ?? "primary", event: eventPatch, sendUpdates: ((args.sendUpdates as string | undefined) ?? "all") as "all" | "externalOnly" | "none" });
    }
    case "calendar_events_delete":
      return tenant.googlecalendar.api.events.delete({ id: args.id as string, calendarId: (args.calendarId as string | undefined) ?? "primary", sendUpdates: ((args.sendUpdates as string | undefined) ?? "all") as "all" | "externalOnly" | "none" });
    case "calendar_get_availability": {
      const calIds = (args.calendarIds as string[] | undefined) ?? ["primary"];
      return tenant.googlecalendar.api.calendar.getAvailability({ timeMin: args.timeMin as string, timeMax: args.timeMax as string, timeZone: args.timeZone as string | undefined, items: calIds.map((id) => ({ id })) });
    }
    case "calendar_db_events_search": {
      const data: Record<string, unknown> = {};
      if (args.summary) data.summary = { contains: args.summary };
      if (args.description) data.description = { contains: args.description };
      if (args.location) data.location = { contains: args.location };
      if (args.calendarId) data.calendarId = { equals: args.calendarId };
      if (args.recurringEventId) data.recurringEventId = { equals: args.recurringEventId };
      return tenant.googlecalendar.db.events.search({ data, limit: (args.limit as number | undefined) ?? 20, offset: (args.offset as number | undefined) ?? 0 });
    }
    case "calendar_db_calendars_search": {
      const data: Record<string, unknown> = {};
      if (args.summary) data.summary = { contains: args.summary };
      if (args.timeZone) data.timeZone = { equals: args.timeZone };
      return tenant.googlecalendar.db.calendars.search({ data, limit: (args.limit as number | undefined) ?? 20 });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── System prompt ─────────────────────────────────────────────────────────────

function buildAgentSystemPrompt(userEmail: string): string {
  return `You are an elite Gmail and Google Calendar assistant inside a Superhuman-style productivity app.

## Context
- User email: ${userEmail}
- Current time (UTC): ${new Date().toISOString()}

## Strategy
1. For search/lookup: try DB tools first (gmail_db_*, calendar_db_*) — instant, no API quota.
2. For actions (send, create, update, delete): use API tools directly.
3. For availability/scheduling: check calendar_get_availability before creating events.
4. Chain tool calls for complex tasks ("send invite + email").

## Rules
- ALWAYS execute — never ask "shall I proceed?" for clear instructions
- Confirm completed actions with resource IDs
- For calendar events: always include startDateTime + endDateTime in ISO 8601
- Batch operations when possible
- Keep final summary to 1-3 lines`;
}

// ─── nex-n2-pro agent — ENHANCED EMITTER CALLS ────────────────────────────────
// Each SSE event now carries:
//   { level, message, toolName?, toolStatus?, toolArgs?, toolResult? }
// The frontend parses these to render the step-by-step activity timeline.

async function runNexAgent(
  corsairTenantId: string,
  userEmail: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
  const client = getOpenRouterClient();
  const tenant = corsair.withTenant(corsairTenantId);
  const tools = buildToolRegistry();

  // ── Step 1: Understanding ──────────────────────────────────────────────────
  emitToUser(corsairTenantId, {
    type: "agent_status",
    data: { level: "info", message: "Understanding request..." },
  });

  const loopMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: buildAgentSystemPrompt(userEmail) },
    ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  // ── Step 2: Planning ───────────────────────────────────────────────────────
  emitToUser(corsairTenantId, {
    type: "agent_status",
    data: { level: "info", message: "Searching available tools..." },
  });

  const MAX_TOOL_ROUNDS = 8;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.chat.completions.create({
      model: "nex-agi/nex-n2-pro:free",
      max_tokens: 2048,
      tools,
      tool_choice: "auto",
      messages: loopMessages,
    });

    if (!response?.choices?.length) {
        logger.error("No choices returned from model", {
          response,
        });

        return "Task completed.";
      }

      const choice = response.choices[0];
    if (!choice) break;

    const assistantMsg = choice.message;
    loopMessages.push(assistantMsg as OpenAI.Chat.ChatCompletionMessageParam);

    // No more tool calls → final answer
    if (choice.finish_reason !== "tool_calls" || !assistantMsg.tool_calls?.length) {
      emitToUser(corsairTenantId, {
        type: "agent_status",
        data: { level: "info", message: "Generating response..." },
      });
      return assistantMsg.content ?? "Task completed.";
    }

    // Execute tool calls in parallel
    const toolResultMsgs: OpenAI.Chat.ChatCompletionToolMessageParam[] = await Promise.all(
      assistantMsg.tool_calls.map(async (tc) => {
        if (tc.type !== "function") {
          return { role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify({ error: "Unsupported tool type" }) };
        }

        const toolName = tc.function.name;
        let args: ToolArgs = {};
        try { args = JSON.parse(tc.function.arguments) as ToolArgs; } catch { /* ignore */ }

        // ── Emit: tool starting (pending) ────────────────────────────────
        // Send toolArgs so the frontend can preview what will be sent
        emitToUser(corsairTenantId, {
          type: "agent_status",
          data: {
            level: "info",
            message: `Executing ${toolName}...`,
            toolName,
            toolStatus: "pending",
            toolArgs: args,
          },
        });

        let result: unknown;

        try {
          result = await executeTool(toolName, args, tenant, userEmail);

          // ── Emit: tool succeeded ─────────────────────────────────────
          emitToUser(corsairTenantId, {
            type: "agent_status",
            data: {
              level: "success",
              message: `${toolName} completed successfully`,
              toolName,
              toolStatus: "success",
              toolArgs: args,
              toolResult: result,
            },
          });

          logger.debug("nex tool success", { tool: toolName });
        } catch (err) {
          result = { error: String(err) };

          // ── Emit: tool failed ────────────────────────────────────────
          emitToUser(corsairTenantId, {
            type: "agent_status",
            data: {
              level: "error",
              message: `Failed to execute ${toolName}`,
              toolName,
              toolStatus: "error",
              toolArgs: args,
              toolResult: result,
            },
          });

          logger.warn("nex tool error", { tool: toolName, error: String(err) });
        }

        return { role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify(result) };
      }),
    );

    loopMessages.push(...toolResultMsgs);
  }

  // Hit round limit
  emitToUser(corsairTenantId, {
    type: "agent_status",
    data: { level: "info", message: "Generating response..." },
  });

  loopMessages.push({ role: "user", content: "Summarize what was accomplished in 1-3 lines." });
  const summary = await client.chat.completions.create({
    model: "nex-agi/nex-n2-pro:free",
    max_tokens: 512,
    messages: loopMessages,
  });
  console.log(summary.choices);

  if (!summary?.choices?.length) {
  logger.warn("Summary call returned no choices");
  return "Task completed.";
}

return (
  summary.choices[0]?.message?.content ??
  "Task completed."
);
}

// ─── Anthropic agent ───────────────────────────────────────────────────────────

let _mcpProvider: AnthropicProvider | null = null;
function getMcpProvider(): AnthropicProvider {
  if (!_mcpProvider) _mcpProvider = new AnthropicProvider();
  return _mcpProvider;
}

async function runAnthropicAgent(
  corsairTenantId: string,
  userEmail: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
  const apiKey = env.LLM_PROVIDER_AGENT_KEY ?? env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Set LLM_PROVIDER_AGENT_KEY or ANTHROPIC_API_KEY for Anthropic agent");

  emitToUser(corsairTenantId, { type: "agent_status", data: { level: "info", message: "Understanding request..." } });

  const client = new Anthropic({ apiKey });
  const tenantCorsair = corsair.withTenant(corsairTenantId);
  const tools = getMcpProvider().build({ corsair: tenantCorsair });

  emitToUser(corsairTenantId, { type: "agent_status", data: { level: "info", message: "Executing with Claude..." } });

  const message = await client.beta.messages.toolRunner({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    system: buildAgentSystemPrompt(userEmail),
    tools,
    messages: messages as Anthropic.MessageParam[],
  });

  emitToUser(corsairTenantId, { type: "agent_status", data: { level: "success", message: "Generating response..." } });

  return (
    message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim() || "Task completed."
  );
}

// ─── OpenAI Agents ─────────────────────────────────────────────────────────────

async function runOpenAIAgent(
  corsairTenantId: string,
  userEmail: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
  const apiKey = env.LLM_PROVIDER_AGENT_KEY ?? env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Set LLM_PROVIDER_AGENT_KEY or OPENAI_API_KEY for OpenAI agent");

  emitToUser(corsairTenantId, { type: "agent_status", data: { level: "info", message: "Running with GPT-4o-mini..." } });

  const { Agent, run, tool } = await import("@openai/agents").catch(() => {
    throw new Error("@openai/agents not installed — run: npm install @openai/agents");
  });
  const { OpenAIAgentsProvider } = await import("@corsair-dev/mcp");

  const tenantCorsair = corsair.withTenant(corsairTenantId);
  const provider = new OpenAIAgentsProvider();
  const tools = await provider.build({ corsair: tenantCorsair, tool });

  const agent = new Agent({ name: "superhuman-agent", model: "gpt-4o-mini", instructions: buildAgentSystemPrompt(userEmail), tools });
  const lastMsg = messages.findLast((m) => m.role === "user")?.content ?? "";
  const result = await run(agent, lastMsg);

  emitToUser(corsairTenantId, { type: "agent_status", data: { level: "success", message: "Generating response..." } });

  return result.finalOutput ?? "Task completed.";
}


// ─── Agent dispatcher ──────────────────────────────────────────────────────────

function getAgentProvider(): AgentProvider {
  const raw = (env.LLM_PROVIDER_FOR_AGENT ?? "nex").toLowerCase().trim();
  if (raw === "anthropic") return "anthropic";
  if (raw === "openai_agents" || raw === "openai") return "openai_agents";
  return "nex";
}

async function runAgent(
  corsairTenantId: string,
  userEmail: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<{ reply: string; model: string; provider: AgentProvider }> {
  const provider = getAgentProvider();
  logger.info("Agent dispatch", { provider, corsairTenantId });

  switch (provider) {
    case "nex": {
      const reply = await runNexAgent(corsairTenantId, userEmail, messages);
      return { reply, model: "nex-agi/nex-n2-pro:free", provider };
    }
    case "anthropic": {
      const reply = await runAnthropicAgent(corsairTenantId, userEmail, messages);
      return { reply, model: "claude-haiku-4-5", provider };
    }
    case "openai_agents": {
      const reply = await runOpenAIAgent(corsairTenantId, userEmail, messages);
      return { reply, model: "gpt-4o-mini", provider };
    }
  }
}

// ─── Action extraction ─────────────────────────────────────────────────────────

function extractActions(text: string): AgentAction[] {
  const actions: AgentAction[] = [];
  if (/email.*sent|sent.*email|message.*sent|draft.*sent/i.test(text)) {
    const id = text.match(/message[_\s]?id[:\s]+([a-zA-Z0-9_-]+)/i)?.[1];
    actions.push({ type: "email_sent", summary: "Email sent", resourceId: id });
  }
  if (/event.*created|created.*event|meeting.*scheduled|calendar.*added/i.test(text)) {
    const id = text.match(/event[_\s]?id[:\s]+([a-zA-Z0-9_@.]+)/i)?.[1];
    actions.push({ type: "event_created", summary: "Calendar event created", resourceId: id });
  }
  if (/event.*updated|rsvp.*updated|meeting.*rescheduled/i.test(text)) {
    actions.push({ type: "event_updated", summary: "Calendar event updated" });
  }
  return actions;
}

// ─── processCommand ────────────────────────────────────────────────────────────

export async function processCommand(
  tenantId: string,
  userId: string,
  userEmail: string,
  input: ChatInput,
): Promise<ChatResponse> {
  const startTime = Date.now();
  const userMessages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...input.conversationHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: input.prompt },
  ];

  try {
    const intent = await classifyIntent(input.prompt);
    logger.info("Intent", { userId, intent });

    if (intent === "chat") {
      const client = getOpenRouterClient();
      const res = await client.chat.completions.create({ model: "nex-agi/nex-n2-pro:free", max_tokens: 1024, messages: [{ role: "system", content: CHAT_SYSTEM }, ...userMessages] });
      const reply = res.choices[0]?.message?.content ?? "How can I help?";
      return { reply, actions: [], durationMs: Date.now() - startTime, model: "nex-agi/nex-n2-pro:free", routedTo: "chat" };
    }

    const corsairTenantId = getTenantId(tenantId);
    const agentResult = await runAgent(corsairTenantId, userEmail, userMessages);
    const actions = extractActions(agentResult.reply);
    const durationMs = Date.now() - startTime;

    void db.insert(agentLogs).values({ userId, prompt: input.prompt, response: agentResult.reply, actions, durationMs: String(durationMs) }).catch((err: any) => logger.warn("agentLog insert failed", { error: String(err) }));

    logger.info("Agent done", { userId, provider: agentResult.provider, durationMs });
    return { reply: agentResult.reply, actions, durationMs, model: agentResult.model, routedTo: "agent" };
  } catch (err) {
    logger.error("processCommand failed", { userId, error: String(err) });
    throw createExternalApiError("LLM Agent", err);
  }
}

// ─── streamCommand ─────────────────────────────────────────────────────────────

export async function* streamCommand(
  tenantId: string,
  userId: string,
  userEmail: string,
  input: ChatInput,
): AsyncGenerator<string> {
  const userMessages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...input.conversationHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: input.prompt },
  ];

  try {
    const intent = await classifyIntent(input.prompt);
    const client = getOpenRouterClient();

    if (intent === "chat") {
      const stream = await client.chat.completions.create({ model: "nex-agi/nex-n2-pro:free", max_tokens: 1024, stream: true, messages: [{ role: "system", content: CHAT_SYSTEM }, ...userMessages] });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
      return;
    }

    const provider = getAgentProvider();
    const corsairTenantId = getTenantId(tenantId);

    if (provider === "anthropic") {
      const apiKey = env.LLM_PROVIDER_AGENT_KEY ?? env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("No Anthropic API key");
      const anthClient = new Anthropic({ apiKey });
      const tenantCorsair = corsair.withTenant(corsairTenantId);
      const tools = getMcpProvider().build({ corsair: tenantCorsair });
      const stream = anthClient.messages.stream({ model: "claude-haiku-4-5", max_tokens: 2048, system: buildAgentSystemPrompt(userEmail), tools, messages: userMessages as Anthropic.MessageParam[] });
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          yield chunk.delta.text;
        }
      }
    } else if (provider === "nex") {
      const agentResult = await runNexAgent(corsairTenantId, userEmail, userMessages);
      for (let i = 0; i < agentResult.length; i += 50) {
        yield agentResult.slice(i, i + 50);
        await new Promise((r) => setTimeout(r, 8));
      }
    } else {
      const agentResult = await runAgent(corsairTenantId, userEmail, userMessages);
      yield agentResult.reply;
    }
  } catch (err) {
    logger.error("streamCommand failed", { userId, error: String(err) });
    yield `\n\n[Error: ${err instanceof Error ? err.message : "Something went wrong"}]`;
  }
}