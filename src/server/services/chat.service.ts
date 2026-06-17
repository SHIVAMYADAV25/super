// /**
//  * Chat Service — Intent Router + Multi-Provider Agent
//  *
//  * ┌──────────────────────────────────────────────────────────────────────┐
//  * │  User message                                                        │
//  * │       ↓                                                              │
//  * │  [nex-n2-pro:free ROUTER] — via OpenRouter, zero cost               │
//  * │  keyword pre-check → if miss, LLM classifies "chat" | "agent"       │
//  * │       ↓                         ↓                                   │
//  * │     CHAT                    AGENT TASK                              │
//  * │  nex-n2-pro:free           dispatch by LLM_PROVIDER_FOR_AGENT       │
//  * │  answers directly           ↓            ↓           ↓              │
//  * │  (streaming)           anthropic   openai_agents                    │
//  * │                      claude-haiku   gpt-4o-mini                      │
//  * │                                                                      │
//  * │  nex-n2-pro path: full tool registry passed as OpenAI functions      │
//  * │  (nex-n2-pro doesn't support Corsair MCP natively — we wrap every   │
//  * │   Corsair API + DB operation as an OpenAI function and dispatch      │
//  * │   tool calls manually, then feed results back for a final summary)  │
//  * └──────────────────────────────────────────────────────────────────────┘
//  *
//  * Env vars:
//  *   OPENROUTER_API_KEY        — for router + nex-n2-pro + chat
//  *   LLM_PROVIDER_FOR_AGENT    — anthropic | openai_agents  | nex
//  *   LLM_PROVIDER_AGENT_KEY    — API key for the chosen agent provider
//  *   ANTHROPIC_API_KEY         — if using anthropic provider
//  *   OPENAI_API_KEY            — if using openai_agents provider
//  */

// import OpenAI from "openai";
// import Anthropic from "@anthropic-ai/sdk";
// import { AnthropicProvider } from "@corsair-dev/mcp";
// import { corsair, getTenantId } from "../lib/corsair";
// import { agentLogs } from "../db/schema";
// import { db } from "../db";
// import { logger } from "@/src/lib/logger";
// import { createExternalApiError } from "@/src/lib/errors";
// import type { ChatInput } from "@/src/schema";
// import type { AgentAction } from "@/src/types";
// import { env } from "@/src/env";
// import type { CorsairTenant } from "../lib/corsair";
// import { emitToUser } from "../lib/sse";

// // ─── Types ─────────────────────────────────────────────────────────────────────

// export type AgentProvider = "anthropic" | "openai_agents" |  | "nex";

// export interface ChatResponse {
//   reply: string;
//   actions: AgentAction[];
//   durationMs: number;
//   model: string;
//   routedTo: "chat" | "agent";
// }

// // ─── OpenRouter client (nex-n2-pro + router + chat) ───────────────────────────

// let _orClient: OpenAI | null = null;

// function getOpenRouterClient(): OpenAI {
//   if (!_orClient) {
//     const key = env.OPENROUTER_API_KEY;
//     if (!key) throw new Error("OPENROUTER_API_KEY is required");
//     _orClient = new OpenAI({
//       baseURL: "https://openrouter.ai/api/v1",
//       apiKey: key,
//       defaultHeaders: {
//         "HTTP-Referer": env.NEXTAUTH_URL ?? "http://localhost:3000",
//         "X-Title": "Superhuman",
//       },
//     });
//   }
//   return _orClient;
// }

// // ─── Intent router ─────────────────────────────────────────────────────────────

// const AGENT_KEYWORDS = [
//   "send email","send an email","draft email","reply to","forward",
//   "calendar invite","calendar event","schedule","reschedule","meeting",
//   "create event","invite","rsvp","accept invite","decline invite",
//   "check availability","free slot","archive","mark as read","mark read",
//   "unread","label","search email","find email","trash","delete email",
//   "list emails","show emails","read email","open email","get emails",
//   "upcoming events","my calendar","what's on","today's events",
// ];

// function quickKeywordCheck(prompt: string): boolean {
//   const lower = prompt.toLowerCase();
//   return AGENT_KEYWORDS.some((kw) => lower.includes(kw));
// }

// const ROUTER_SYSTEM = `You are an intent classifier. Decide if the user wants to perform a Gmail or Google Calendar action (agent) or is just having a conversation (chat).

// Reply with EXACTLY one word — "agent" or "chat" — nothing else.

// "agent" examples:
// - send/read/search/archive/label/trash emails
// - create/update/delete/list calendar events
// - check availability, RSVP, schedule meetings
// - find emails from someone, list unread emails
// - "what's on my calendar", "do I have emails from X"

// "chat" examples:
// - general questions, explanations, greetings
// - anything not related to Gmail or Google Calendar`;

// async function classifyIntent(prompt: string): Promise<"chat" | "agent"> {
//   if (quickKeywordCheck(prompt)) {
//     logger.debug("Router: keyword → agent");
//     return "agent";
//   }
//   try {
//     const client = getOpenRouterClient();
//     const res = await client.chat.completions.create({
//       model: "nex-agi/nex-n2-pro:free",
//       max_tokens: 5,
//       temperature: 0,
//       messages: [
//         { role: "system", content: ROUTER_SYSTEM },
//         { role: "user", content: prompt.slice(0, 400) },
//       ],
//     });
//     const raw = res.choices[0]?.message?.content?.trim().toLowerCase() ?? "";
//     const intent = raw.startsWith("agent") ? "agent" : "chat";
//     logger.debug("Router: nex classified", { intent, raw });
//     return intent;
//   } catch (err) {
//     logger.warn("Router failed — defaulting to agent", { error: String(err) });
//     return "agent";
//   }
// }

// // ─── Chat path (nex-n2-pro streaming) ─────────────────────────────────────────

// const CHAT_SYSTEM = `You are a helpful assistant inside a Superhuman-style email and calendar app.
// Answer concisely. If the user seems to want to perform an email or calendar action, remind them they can ask directly (e.g. "send email to...", "create a meeting...").`;

// // ═══════════════════════════════════════════════════════════════════════════════
// // TOOL REGISTRY — every Corsair Gmail + Calendar operation as an OpenAI function
// // Used by nex-n2-pro (manual dispatch) and can also be reused by openai_agents.
// // ═══════════════════════════════════════════════════════════════════════════════

// function buildToolRegistry(): OpenAI.Chat.ChatCompletionTool[] {
//   return [
//     // ── Gmail API ────────────────────────────────────────────────────────────

//     // messages.list
//     {
//       type: "function",
//       function: {
//         name: "gmail_messages_list",
//         description: "List or search messages in the Gmail mailbox. Use Gmail search operators in q (e.g. 'is:unread', 'from:boss@example.com', 'subject:invoice', 'newer_than:7d', 'has:attachment').",
//         parameters: {
//           type: "object",
//           properties: {
//             q: { type: "string", description: "Gmail search query" },
//             maxResults: { type: "number", description: "Max messages to return (default 20)" },
//             labelIds: { type: "array", items: { type: "string" }, description: "Filter by label IDs e.g. ['INBOX','UNREAD']" },
//             pageToken: { type: "string", description: "Page token for pagination" },
//             includeSpamTrash: { type: "boolean", description: "Include spam/trash (default false)" },
//           },
//           required: [],
//         },
//       },
//     },

//     // messages.get
//     {
//       type: "function",
//       function: {
//         name: "gmail_messages_get",
//         description: "Get a specific Gmail message by ID. Use format='full' to get the complete body.",
//         parameters: {
//           type: "object",
//           properties: {
//             id: { type: "string", description: "Gmail message ID" },
//             format: { type: "string", enum: ["minimal", "full", "raw", "metadata"], description: "Response format (default: full)" },
//           },
//           required: ["id"],
//         },
//       },
//     },

//     // messages.send
//     {
//       type: "function",
//       function: {
//         name: "gmail_messages_send",
//         description: "Send an email. Provide to, subject, body and optional cc/bcc — the tool builds the RFC 2822 message and base64url-encodes it automatically.",
//         parameters: {
//           type: "object",
//           properties: {
//             to: { type: "string", description: "Recipient email address (or comma-separated list)" },
//             subject: { type: "string", description: "Email subject line" },
//             body: { type: "string", description: "Plain text email body" },
//             cc: { type: "string", description: "CC addresses (optional)" },
//             bcc: { type: "string", description: "BCC addresses (optional)" },
//             fromEmail: { type: "string", description: "Sender address (defaults to authenticated user)" },
//             threadId: { type: "string", description: "Thread ID if replying to a thread" },
//           },
//           required: ["to", "subject", "body"],
//         },
//       },
//     },

//     // messages.modify (read/unread/labels)
//     {
//       type: "function",
//       function: {
//         name: "gmail_messages_modify",
//         description: "Add or remove labels from a message. To mark read: removeLabelIds=['UNREAD']. To mark unread: addLabelIds=['UNREAD']. To archive: removeLabelIds=['INBOX'].",
//         parameters: {
//           type: "object",
//           properties: {
//             id: { type: "string", description: "Gmail message ID" },
//             addLabelIds: { type: "array", items: { type: "string" }, description: "Label IDs to add" },
//             removeLabelIds: { type: "array", items: { type: "string" }, description: "Label IDs to remove" },
//           },
//           required: ["id"],
//         },
//       },
//     },

//     // messages.trash
//     {
//       type: "function",
//       function: {
//         name: "gmail_messages_trash",
//         description: "Move a Gmail message to the trash.",
//         parameters: {
//           type: "object",
//           properties: {
//             id: { type: "string", description: "Gmail message ID" },
//           },
//           required: ["id"],
//         },
//       },
//     },

//     // messages.untrash
//     {
//       type: "function",
//       function: {
//         name: "gmail_messages_untrash",
//         description: "Restore a Gmail message from the trash.",
//         parameters: {
//           type: "object",
//           properties: {
//             id: { type: "string", description: "Gmail message ID" },
//           },
//           required: ["id"],
//         },
//       },
//     },

//     // messages.batchModify
//     {
//       type: "function",
//       function: {
//         name: "gmail_messages_batch_modify",
//         description: "Add or remove labels from multiple messages at once. Useful for bulk archive, bulk mark-read, etc.",
//         parameters: {
//           type: "object",
//           properties: {
//             ids: { type: "array", items: { type: "string" }, description: "Array of Gmail message IDs" },
//             addLabelIds: { type: "array", items: { type: "string" }, description: "Label IDs to add to all messages" },
//             removeLabelIds: { type: "array", items: { type: "string" }, description: "Label IDs to remove from all messages" },
//           },
//           required: ["ids"],
//         },
//       },
//     },

//     // threads.list
//     {
//       type: "function",
//       function: {
//         name: "gmail_threads_list",
//         description: "List email threads. Supports same Gmail search operators as messages.list.",
//         parameters: {
//           type: "object",
//           properties: {
//             q: { type: "string", description: "Gmail search query" },
//             maxResults: { type: "number", description: "Max threads to return" },
//             labelIds: { type: "array", items: { type: "string" }, description: "Filter by label IDs" },
//             pageToken: { type: "string" },
//           },
//           required: [],
//         },
//       },
//     },

//     // threads.get
//     {
//       type: "function",
//       function: {
//         name: "gmail_threads_get",
//         description: "Get a full email thread by ID, including all messages in the thread.",
//         parameters: {
//           type: "object",
//           properties: {
//             id: { type: "string", description: "Thread ID" },
//             format: { type: "string", enum: ["minimal", "full", "metadata"] },
//           },
//           required: ["id"],
//         },
//       },
//     },

//     // threads.modify
//     {
//       type: "function",
//       function: {
//         name: "gmail_threads_modify",
//         description: "Add or remove labels from an entire thread.",
//         parameters: {
//           type: "object",
//           properties: {
//             id: { type: "string", description: "Thread ID" },
//             addLabelIds: { type: "array", items: { type: "string" } },
//             removeLabelIds: { type: "array", items: { type: "string" } },
//           },
//           required: ["id"],
//         },
//       },
//     },

//     // threads.trash
//     {
//       type: "function",
//       function: {
//         name: "gmail_threads_trash",
//         description: "Move an entire email thread to the trash.",
//         parameters: {
//           type: "object",
//           properties: {
//             id: { type: "string", description: "Thread ID" },
//           },
//           required: ["id"],
//         },
//       },
//     },

//     // drafts.create
//     {
//       type: "function",
//       function: {
//         name: "gmail_drafts_create",
//         description: "Create a new Gmail draft. Provide to, subject, body — the tool handles encoding.",
//         parameters: {
//           type: "object",
//           properties: {
//             to: { type: "string", description: "Recipient email" },
//             subject: { type: "string", description: "Subject line" },
//             body: { type: "string", description: "Draft body text" },
//             cc: { type: "string", description: "CC (optional)" },
//             threadId: { type: "string", description: "Thread to reply to (optional)" },
//           },
//           required: ["to", "subject", "body"],
//         },
//       },
//     },

//     // drafts.list
//     {
//       type: "function",
//       function: {
//         name: "gmail_drafts_list",
//         description: "List saved Gmail drafts.",
//         parameters: {
//           type: "object",
//           properties: {
//             maxResults: { type: "number" },
//             q: { type: "string", description: "Search query within drafts" },
//           },
//           required: [],
//         },
//       },
//     },

//     // drafts.send
//     {
//       type: "function",
//       function: {
//         name: "gmail_drafts_send",
//         description: "Send an existing draft by its draft ID.",
//         parameters: {
//           type: "object",
//           properties: {
//             id: { type: "string", description: "Draft ID to send" },
//           },
//           required: ["id"],
//         },
//       },
//     },

//     // drafts.delete
//     {
//       type: "function",
//       function: {
//         name: "gmail_drafts_delete",
//         description: "Delete a Gmail draft by ID.",
//         parameters: {
//           type: "object",
//           properties: {
//             id: { type: "string", description: "Draft ID" },
//           },
//           required: ["id"],
//         },
//       },
//     },

//     // labels.list
//     {
//       type: "function",
//       function: {
//         name: "gmail_labels_list",
//         description: "List all Gmail labels in the mailbox (system labels like INBOX, UNREAD and user-created labels).",
//         parameters: {
//           type: "object",
//           properties: {},
//           required: [],
//         },
//       },
//     },

//     // labels.create
//     {
//       type: "function",
//       function: {
//         name: "gmail_labels_create",
//         description: "Create a new Gmail label.",
//         parameters: {
//           type: "object",
//           properties: {
//             name: { type: "string", description: "Label name" },
//             messageListVisibility: { type: "string", enum: ["show", "hide"] },
//             labelListVisibility: { type: "string", enum: ["labelShow", "labelShowIfUnread", "labelHide"] },
//           },
//           required: ["name"],
//         },
//       },
//     },

//     // ── Gmail DB search (Corsair local cache — instant, no API quota) ─────────

//     // gmail_db_messages_search
//     {
//       type: "function",
//       function: {
//         name: "gmail_db_messages_search",
//         description: "Search the LOCAL Corsair-synced Gmail message cache. Instant — no API quota used. Use this FIRST before gmail_messages_list. Supports full-text search on subject, body, from, to, snippet.",
//         parameters: {
//           type: "object",
//           properties: {
//             subject: { type: "string", description: "Search within subject" },
//             body: { type: "string", description: "Search within body" },
//             from: { type: "string", description: "Filter by sender email/name" },
//             to: { type: "string", description: "Filter by recipient" },
//             snippet: { type: "string", description: "Search within snippet" },
//             threadId: { type: "string", description: "Filter by thread ID" },
//             limit: { type: "number", description: "Max results (default 20)" },
//             offset: { type: "number", description: "Pagination offset" },
//           },
//           required: [],
//         },
//       },
//     },

//     // gmail_db_threads_search
//     {
//       type: "function",
//       function: {
//         name: "gmail_db_threads_search",
//         description: "Search the LOCAL Corsair-synced Gmail thread cache.",
//         parameters: {
//           type: "object",
//           properties: {
//             snippet: { type: "string", description: "Search within thread snippet" },
//             limit: { type: "number" },
//             offset: { type: "number" },
//           },
//           required: [],
//         },
//       },
//     },

//     // gmail_db_drafts_search
//     {
//       type: "function",
//       function: {
//         name: "gmail_db_drafts_search",
//         description: "Search locally cached Gmail drafts.",
//         parameters: {
//           type: "object",
//           properties: {
//             limit: { type: "number" },
//             offset: { type: "number" },
//           },
//           required: [],
//         },
//       },
//     },

//     // gmail_db_labels_search
//     {
//       type: "function",
//       function: {
//         name: "gmail_db_labels_search",
//         description: "Search locally cached Gmail labels. Useful for finding label IDs before applying them.",
//         parameters: {
//           type: "object",
//           properties: {
//             name: { type: "string", description: "Filter by label name" },
//             limit: { type: "number" },
//           },
//           required: [],
//         },
//       },
//     },

//     // ── Google Calendar API ───────────────────────────────────────────────────

//     // events.getMany
//     {
//       type: "function",
//       function: {
//         name: "calendar_events_list",
//         description: "List Google Calendar events in a time range. Defaults to primary calendar.",
//         parameters: {
//           type: "object",
//           properties: {
//             timeMin: { type: "string", description: "ISO 8601 start of range (default: now)" },
//             timeMax: { type: "string", description: "ISO 8601 end of range" },
//             q: { type: "string", description: "Free-text search in event fields" },
//             maxResults: { type: "number", description: "Max events (default 20)" },
//             singleEvents: { type: "boolean", description: "Expand recurring events (default true)" },
//             orderBy: { type: "string", enum: ["startTime", "updated"] },
//             calendarId: { type: "string", description: "Calendar ID (default: primary)" },
//             showDeleted: { type: "boolean" },
//           },
//           required: [],
//         },
//       },
//     },

//     // events.get
//     {
//       type: "function",
//       function: {
//         name: "calendar_events_get",
//         description: "Get a specific Google Calendar event by ID.",
//         parameters: {
//           type: "object",
//           properties: {
//             id: { type: "string", description: "Event ID" },
//             calendarId: { type: "string", description: "Calendar ID (default: primary)" },
//           },
//           required: ["id"],
//         },
//       },
//     },

//     // events.create
//     {
//       type: "function",
//       function: {
//         name: "calendar_events_create",
//         description: "Create a new Google Calendar event. Always include start and end as ISO 8601 with timezone. Set sendUpdates='all' to email attendees their invites.",
//         parameters: {
//           type: "object",
//           properties: {
//             summary: { type: "string", description: "Event title" },
//             description: { type: "string", description: "Event description (optional)" },
//             location: { type: "string", description: "Physical or virtual location (optional)" },
//             startDateTime: { type: "string", description: "Start time ISO 8601 e.g. '2025-06-20T09:00:00+05:30'" },
//             endDateTime: { type: "string", description: "End time ISO 8601 e.g. '2025-06-20T10:00:00+05:30'" },
//             timeZone: { type: "string", description: "IANA timezone e.g. 'Asia/Kolkata'" },
//             attendees: {
//               type: "array",
//               items: { type: "string" },
//               description: "Array of attendee email addresses",
//             },
//             sendUpdates: {
//               type: "string",
//               enum: ["all", "externalOnly", "none"],
//               description: "Who gets invite emails (default: 'all')",
//             },
//             calendarId: { type: "string", description: "Calendar ID (default: primary)" },
//             recurrence: {
//               type: "array",
//               items: { type: "string" },
//               description: "RRULE strings for recurring events e.g. ['RRULE:FREQ=WEEKLY;COUNT=4']",
//             },
//           },
//           required: ["summary", "startDateTime", "endDateTime"],
//         },
//       },
//     },

//     // events.update
//     {
//       type: "function",
//       function: {
//         name: "calendar_events_update",
//         description: "Update an existing Google Calendar event. Only provide fields you want to change.",
//         parameters: {
//           type: "object",
//           properties: {
//             id: { type: "string", description: "Event ID to update" },
//             summary: { type: "string" },
//             description: { type: "string" },
//             location: { type: "string" },
//             startDateTime: { type: "string", description: "New start time ISO 8601" },
//             endDateTime: { type: "string", description: "New end time ISO 8601" },
//             timeZone: { type: "string" },
//             attendees: { type: "array", items: { type: "string" }, description: "Updated attendee list (emails)" },
//             sendUpdates: { type: "string", enum: ["all", "externalOnly", "none"] },
//             calendarId: { type: "string", description: "Calendar ID (default: primary)" },
//           },
//           required: ["id"],
//         },
//       },
//     },

//     // events.delete
//     {
//       type: "function",
//       function: {
//         name: "calendar_events_delete",
//         description: "Delete a Google Calendar event.",
//         parameters: {
//           type: "object",
//           properties: {
//             id: { type: "string", description: "Event ID" },
//             calendarId: { type: "string" },
//             sendUpdates: { type: "string", enum: ["all", "externalOnly", "none"] },
//           },
//           required: ["id"],
//         },
//       },
//     },

//     // calendar.getAvailability
//     {
//       type: "function",
//       function: {
//         name: "calendar_get_availability",
//         description: "Check free/busy availability for one or more calendars. Use this before scheduling to avoid conflicts.",
//         parameters: {
//           type: "object",
//           properties: {
//             timeMin: { type: "string", description: "Start of check window ISO 8601" },
//             timeMax: { type: "string", description: "End of check window ISO 8601" },
//             calendarIds: {
//               type: "array",
//               items: { type: "string" },
//               description: "Calendar IDs to check (default: ['primary'])",
//             },
//             timeZone: { type: "string", description: "IANA timezone for results" },
//           },
//           required: ["timeMin", "timeMax"],
//         },
//       },
//     },

//     // ── Google Calendar DB search (local cache) ───────────────────────────────

//     // calendar_db_events_search
//     {
//       type: "function",
//       function: {
//         name: "calendar_db_events_search",
//         description: "Search the LOCAL Corsair-synced Calendar event cache. Instant — no API quota. Use this before calendar_events_list for keyword/title lookups.",
//         parameters: {
//           type: "object",
//           properties: {
//             summary: { type: "string", description: "Search event title" },
//             description: { type: "string", description: "Search event description" },
//             location: { type: "string", description: "Search by location" },
//             calendarId: { type: "string", description: "Filter by calendar ID" },
//             recurringEventId: { type: "string", description: "Filter by recurring event parent ID" },
//             limit: { type: "number" },
//             offset: { type: "number" },
//           },
//           required: [],
//         },
//       },
//     },

//     // calendar_db_calendars_search
//     {
//       type: "function",
//       function: {
//         name: "calendar_db_calendars_search",
//         description: "Search locally cached Google Calendars. Useful for finding calendar IDs.",
//         parameters: {
//           type: "object",
//           properties: {
//             summary: { type: "string", description: "Filter by calendar name" },
//             timeZone: { type: "string" },
//             limit: { type: "number" },
//           },
//           required: [],
//         },
//       },
//     },
//   ];
// }

// // ─── Tool executor — maps nex tool call → actual Corsair API/DB call ──────────

// function buildRawEmail(opts: {
//   from?: string;
//   to: string;
//   cc?: string;
//   bcc?: string;
//   subject: string;
//   body: string;
//   threadId?: string;
// }): string {
//   const lines = [
//     opts.from ? `From: ${opts.from}` : null,
//     `To: ${opts.to}`,
//     opts.cc ? `Cc: ${opts.cc}` : null,
//     opts.bcc ? `Bcc: ${opts.bcc}` : null,
//     `Subject: ${opts.subject}`,
//     "MIME-Version: 1.0",
//     "Content-Type: text/plain; charset=UTF-8",
//     "",
//     opts.body,
//   ]
//     .filter((l): l is string => l !== null)
//     .join("\r\n");

//   return Buffer.from(lines)
//     .toString("base64")
//     .replace(/\+/g, "-")
//     .replace(/\//g, "_")
//     .replace(/=+$/, "");
// }

// type ToolArgs = Record<string, unknown>;

// async function executeTool(
//   name: string,
//   args: ToolArgs,
//   tenant: CorsairTenant,
//   userEmail: string,
// ): Promise<unknown> {
//   switch (name) {

//     // ── Gmail Messages ────────────────────────────────────────────────────────

//     case "gmail_messages_list":
//       return tenant.gmail.api.messages.list({
//         q: args.q as string | undefined,
//         maxResults: (args.maxResults as number | undefined) ?? 20,
//         labelIds: args.labelIds as string[] | undefined,
//         pageToken: args.pageToken as string | undefined,
//         includeSpamTrash: args.includeSpamTrash as boolean | undefined,
//       });

//     case "gmail_messages_get":
//       return tenant.gmail.api.messages.get({
//         id: args.id as string,
//         format: (args.format as "minimal" | "full" | "raw" | "metadata") ?? "full",
//       });

//     case "gmail_messages_send": {
//       const raw = buildRawEmail({
//         from: userEmail,
//         to: args.to as string,
//         cc: args.cc as string | undefined,
//         bcc: args.bcc as string | undefined,
//         subject: args.subject as string,
//         body: args.body as string,
//         threadId: args.threadId as string | undefined,
//       });
//       return tenant.gmail.api.messages.send({
//         raw,
//         threadId: args.threadId as string | undefined,
//       });
//     }

//     case "gmail_messages_modify":
//       return tenant.gmail.api.messages.modify({
//         id: args.id as string,
//         addLabelIds: args.addLabelIds as string[] | undefined,
//         removeLabelIds: args.removeLabelIds as string[] | undefined,
//       });

//     case "gmail_messages_trash":
//       return tenant.gmail.api.messages.trash({ id: args.id as string });

//     case "gmail_messages_untrash":
//       return tenant.gmail.api.messages.untrash({ id: args.id as string });

//     case "gmail_messages_batch_modify":
//       return tenant.gmail.api.messages.batchModify({
//         ids: args.ids as string[],
//         addLabelIds: args.addLabelIds as string[] | undefined,
//         removeLabelIds: args.removeLabelIds as string[] | undefined,
//       });

//     // ── Gmail Threads ─────────────────────────────────────────────────────────

//     case "gmail_threads_list":
//       return tenant.gmail.api.threads.list({
//         q: args.q as string | undefined,
//         maxResults: (args.maxResults as number | undefined) ?? 20,
//         labelIds: args.labelIds as string[] | undefined,
//         pageToken: args.pageToken as string | undefined,
//       });

//     case "gmail_threads_get":
//       return tenant.gmail.api.threads.get({
//         id: args.id as string,
//         format: (args.format as "minimal" | "full" | "metadata") ?? "full",
//       });

//     case "gmail_threads_modify":
//       return tenant.gmail.api.threads.modify({
//         id: args.id as string,
//         addLabelIds: args.addLabelIds as string[] | undefined,
//         removeLabelIds: args.removeLabelIds as string[] | undefined,
//       });

//     case "gmail_threads_trash":
//       return tenant.gmail.api.threads.trash({ id: args.id as string });

//     // ── Gmail Drafts ──────────────────────────────────────────────────────────

//     case "gmail_drafts_create": {
//       const raw = buildRawEmail({
//         from: userEmail,
//         to: args.to as string,
//         cc: args.cc as string | undefined,
//         subject: args.subject as string,
//         body: args.body as string,
//         threadId: args.threadId as string | undefined,
//       });
//       return tenant.gmail.api.drafts.create({
//         draft: { message: { raw, threadId: args.threadId as string | undefined } },
//       });
//     }

//     case "gmail_drafts_list":
//       return tenant.gmail.api.drafts.list({
//         maxResults: args.maxResults as number | undefined,
//         q: args.q as string | undefined,
//       });

//     case "gmail_drafts_send":
//       return tenant.gmail.api.drafts.send({ id: args.id as string });

//     case "gmail_drafts_delete":
//       return tenant.gmail.api.drafts.delete({ id: args.id as string });

//     // ── Gmail Labels ──────────────────────────────────────────────────────────

//     case "gmail_labels_list":
//       return tenant.gmail.api.labels.list({});

//     case "gmail_labels_create":
//       return tenant.gmail.api.labels.create({
//         label: {
//           name: args.name as string,
//           messageListVisibility: args.messageListVisibility as "show" | "hide" | undefined,
//           labelListVisibility: args.labelListVisibility as
//             | "labelShow"
//             | "labelShowIfUnread"
//             | "labelHide"
//             | undefined,
//         },
//       });

//     // ── Gmail DB (local Corsair cache) ────────────────────────────────────────

//     case "gmail_db_messages_search": {
//       const data: Record<string, unknown> = {};
//       if (args.subject) data.subject = { contains: args.subject };
//       if (args.body) data.body = { contains: args.body };
//       if (args.from) data.from = { contains: args.from };
//       if (args.to) data.to = { contains: args.to };
//       if (args.snippet) data.snippet = { contains: args.snippet };
//       if (args.threadId) data.threadId = { equals: args.threadId };
//       return tenant.gmail.db.messages.search({
//         data,
//         limit: (args.limit as number | undefined) ?? 20,
//         offset: (args.offset as number | undefined) ?? 0,
//       });
//     }

//     case "gmail_db_threads_search": {
//       const data: Record<string, unknown> = {};
//       if (args.snippet) data.snippet = { contains: args.snippet };
//       return tenant.gmail.db.threads.search({
//         data,
//         limit: (args.limit as number | undefined) ?? 20,
//         offset: (args.offset as number | undefined) ?? 0,
//       });
//     }

//     case "gmail_db_drafts_search":
//       return tenant.gmail.db.drafts.search({
//         data: {},
//         limit: (args.limit as number | undefined) ?? 20,
//         offset: (args.offset as number | undefined) ?? 0,
//       });

//     case "gmail_db_labels_search": {
//       const data: Record<string, unknown> = {};
//       if (args.name) data.name = { contains: args.name };
//       return tenant.gmail.db.labels.search({
//         data,
//         limit: (args.limit as number | undefined) ?? 50,
//       });
//     }

//     // ── Google Calendar API ───────────────────────────────────────────────────

//     case "calendar_events_list":
//       return tenant.googlecalendar.api.events.getMany({
//         calendarId: (args.calendarId as string | undefined) ?? "primary",
//         timeMin: (args.timeMin as string | undefined) ?? new Date().toISOString(),
//         timeMax: args.timeMax as string | undefined,
//         q: args.q as string | undefined,
//         maxResults: (args.maxResults as number | undefined) ?? 20,
//         singleEvents: (args.singleEvents as boolean | undefined) ?? true,
//         orderBy: (args.orderBy as "startTime" | "updated" | undefined) ?? "startTime",
//         showDeleted: args.showDeleted as boolean | undefined,
//       });

//     case "calendar_events_get":
//       return tenant.googlecalendar.api.events.get({
//         id: args.id as string,
//         calendarId: (args.calendarId as string | undefined) ?? "primary",
//       });

//     case "calendar_events_create": {
//       const attendees = (args.attendees as string[] | undefined)?.map((email) => ({ email }));
//       return tenant.googlecalendar.api.events.create({
//         calendarId: (args.calendarId as string | undefined) ?? "primary",
//         event: {
//           summary: args.summary as string,
//           description: args.description as string | undefined,
//           location: args.location as string | undefined,
//           start: {
//             dateTime: args.startDateTime as string,
//             timeZone: args.timeZone as string | undefined,
//           },
//           end: {
//             dateTime: args.endDateTime as string,
//             timeZone: args.timeZone as string | undefined,
//           },
//           attendees,
//           recurrence: args.recurrence as string[] | undefined,
//         },
//         sendUpdates: ((args.sendUpdates as string | undefined) ?? "all") as
//           | "all"
//           | "externalOnly"
//           | "none",
//       });
//     }

//     case "calendar_events_update": {
//       const attendees = (args.attendees as string[] | undefined)?.map((email) => ({ email }));
//       const eventPatch: Record<string, unknown> = {};
//       if (args.summary) eventPatch.summary = args.summary;
//       if (args.description) eventPatch.description = args.description;
//       if (args.location) eventPatch.location = args.location;
//       if (args.startDateTime)
//         eventPatch.start = { dateTime: args.startDateTime, timeZone: args.timeZone };
//       if (args.endDateTime)
//         eventPatch.end = { dateTime: args.endDateTime, timeZone: args.timeZone };
//       if (attendees) eventPatch.attendees = attendees;

//       return tenant.googlecalendar.api.events.update({
//         id: args.id as string,
//         calendarId: (args.calendarId as string | undefined) ?? "primary",
//         event: eventPatch,
//         sendUpdates: ((args.sendUpdates as string | undefined) ?? "all") as
//           | "all"
//           | "externalOnly"
//           | "none",
//       });
//     }

//     case "calendar_events_delete":
//       return tenant.googlecalendar.api.events.delete({
//         id: args.id as string,
//         calendarId: (args.calendarId as string | undefined) ?? "primary",
//         sendUpdates: ((args.sendUpdates as string | undefined) ?? "all") as
//           | "all"
//           | "externalOnly"
//           | "none",
//       });

//     case "calendar_get_availability": {
//       const calIds = (args.calendarIds as string[] | undefined) ?? ["primary"];
//       return tenant.googlecalendar.api.calendar.getAvailability({
//         timeMin: args.timeMin as string,
//         timeMax: args.timeMax as string,
//         timeZone: args.timeZone as string | undefined,
//         items: calIds.map((id) => ({ id })),
//       });
//     }

//     // ── Google Calendar DB ────────────────────────────────────────────────────

//     case "calendar_db_events_search": {
//       const data: Record<string, unknown> = {};
//       if (args.summary) data.summary = { contains: args.summary };
//       if (args.description) data.description = { contains: args.description };
//       if (args.location) data.location = { contains: args.location };
//       if (args.calendarId) data.calendarId = { equals: args.calendarId };
//       if (args.recurringEventId) data.recurringEventId = { equals: args.recurringEventId };
//       return tenant.googlecalendar.db.events.search({
//         data,
//         limit: (args.limit as number | undefined) ?? 20,
//         offset: (args.offset as number | undefined) ?? 0,
//       });
//     }

//     case "calendar_db_calendars_search": {
//       const data: Record<string, unknown> = {};
//       if (args.summary) data.summary = { contains: args.summary };
//       if (args.timeZone) data.timeZone = { equals: args.timeZone };
//       return tenant.googlecalendar.db.calendars.search({
//         data,
//         limit: (args.limit as number | undefined) ?? 20,
//       });
//     }

//     default:
//       throw new Error(`Unknown tool: ${name}`);
//   }
// }

// // ─── System prompt for all agent providers ─────────────────────────────────────

// function buildAgentSystemPrompt(userEmail: string): string {
//   const now = new Date().toISOString();
//   return `You are an elite Gmail and Google Calendar assistant inside a Superhuman-style productivity app.

// ## Context
// - User email: ${userEmail}
// - Current time (UTC): ${now}

// ## Your job
// Execute Gmail and Google Calendar actions directly using the tools provided. Do NOT explain — just do it.

// ## Strategy
// 1. For search/lookup tasks: try DB tools first (gmail_db_*, calendar_db_*) — they are instant and use no API quota.
// 2. For actions (send, create, update, delete): use the API tools directly.
// 3. For availability/scheduling: use calendar_get_availability before creating events.
// 4. For complex tasks ("send invite + email"): chain tool calls in the right order.

// ## Rules
// - ALWAYS execute — never ask "shall I proceed?" for clear instructions
// - Confirm completed actions with resource IDs (message ID, event ID)
// - For sending emails: build proper To/Subject/Body fields — never pass raw MIME
// - For calendar events: always include startDateTime + endDateTime in ISO 8601
// - Batch operations when possible (gmail_messages_batch_modify for bulk actions)
// - Keep final summary to 1-3 lines`;
// }

// // ─── nex-n2-pro agent (manual tool loop) ──────────────────────────────────────

// async function runNexAgent(
//   corsairTenantId: string,
//   userEmail: string,
//   messages: Array<{ role: "user" | "assistant"; content: string }>,
// ): Promise<string> {
//     emitToUser(corsairTenantId, {
//   type: "agent_status",
//   data: {
//     level: "info",
//     message: "Understanding request...",
//   },
// });
//   const client = getOpenRouterClient();
//   const tenant = corsair.withTenant(corsairTenantId);
//   const tools = buildToolRegistry();

//   const systemMsg: OpenAI.Chat.ChatCompletionMessageParam = {
//     role: "system",
//     content: buildAgentSystemPrompt(userEmail),
//   };

//   // Maintain a mutable message array for the tool loop
//   const loopMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
//     systemMsg,
//     ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
//   ];

//   const MAX_TOOL_ROUNDS = 8;

//   for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {

//     if (round === 0) {
//       emitToUser(corsairTenantId, {
//   type: "agent_status",
//   data: {
//     level: "info",
//     message: "Searching available tools...",
//   },
// });
//     }

//     const response = await client.chat.completions.create({
//       model: "nex-agi/nex-n2-pro:free",
//       max_tokens: 2048,
//       tools,
//       tool_choice: "auto",
//       messages: loopMessages,
//     });

//     const choice = response.choices[0];
//     if (!choice) break;

//     const assistantMsg = choice.message;
//     loopMessages.push(assistantMsg as OpenAI.Chat.ChatCompletionMessageParam);

    
//     // No tool calls → model gave final answer
//     if (choice.finish_reason !== "tool_calls" || !assistantMsg.tool_calls?.length) {

//       emitToUser(corsairTenantId, {
//         type: "agent_status",
//         data: {
//           message: "Generating response...",
//         },
//       });

//       return assistantMsg.content ?? "Task completed.";
//     }

//     // Execute all tool calls in parallel
//     const toolResultMsgs: OpenAI.Chat.ChatCompletionToolMessageParam[] = await Promise.all(
//       assistantMsg.tool_calls.map(async (tc) => {
//   let result: unknown;

//   if (tc.type !== "function") {
//     return {
//       role: "tool" as const,
//       tool_call_id: tc.id,
//       content: JSON.stringify({
//         error: "Unsupported tool call type",
//       }),
//     };
//   }

//   try {
//     const toolName = tc.function.name;
//     const args = JSON.parse(tc.function.arguments) as ToolArgs;

//     logger.debug("nex tool call", {
//       tool: toolName,
//       args,
//     });

//     emitToUser(corsairTenantId, {
//       type: "agent_status",
//       data: {
//         message: `Preparing: ${toolName}`,
//       },
//     });

//     emitToUser(corsairTenantId, {
//       type: "agent_status",
//       data: {
//         level: "info",
//         message: `Executing ${toolName}...`,
//       },
//     });

//     result = await executeTool(
//       toolName,
//       args,
//       tenant,
//       userEmail,
//     );

//     logger.debug("nex tool result", {
//       tool: toolName,
//       ok: true,
//     });

//     emitToUser(corsairTenantId, {
//       type: "agent_status",
//       data: {
//         message: `${toolName} completed successfully`,
//       },
//     });

//   } catch (err) {
//     result = {
//       error: String(err),
//     };

//      const toolName =
//       tc.type === "function"
//         ? tc.function.name
//         : "unknown";

//     emitToUser(corsairTenantId, {
//       type: "agent_status",
//       data: {
//         level: "error",
//         message: `Failed to execute ${toolName}`,
//       },
//     });

//     logger.warn("nex tool error", {
//       tool:
//         tc.type === "function"
//           ? tc.function.name
//           : "unknown",
//       error: String(err),
//     });
//   }

//   return {
//     role: "tool" as const,
//     tool_call_id: tc.id,
//     content: JSON.stringify(result),
//   };
// })
//     );

//     loopMessages.push(...toolResultMsgs);
//   }

//   // Hit round limit — ask for a summary
//   loopMessages.push({
//     role: "user",
//     content: "Summarize what was accomplished in 1-3 lines.",
//   });

//   const summary = await client.chat.completions.create({
//     model: "nex-agi/nex-n2-pro:free",
//     max_tokens: 512,
//     messages: loopMessages,
//   });


//   return summary.choices[0]?.message?.content ?? "Task completed.";
// }

// // ─── Anthropic agent (AnthropicProvider + Corsair MCP toolRunner) ─────────────

// let _mcpProvider: AnthropicProvider | null = null;
// function getMcpProvider(): AnthropicProvider {
//   if (!_mcpProvider) _mcpProvider = new AnthropicProvider();
//   return _mcpProvider;
// }

// async function runAnthropicAgent(
//   corsairTenantId: string,
//   userEmail: string,
//   messages: Array<{ role: "user" | "assistant"; content: string }>,
// ): Promise<string> {
//   const apiKey = env.LLM_PROVIDER_AGENT_KEY ?? env.ANTHROPIC_API_KEY;
//   if (!apiKey) throw new Error("Set LLM_PROVIDER_AGENT_KEY or ANTHROPIC_API_KEY for Anthropic agent");

//   const client = new Anthropic({ apiKey });
//   const tenantCorsair = corsair.withTenant(corsairTenantId);
//   const tools = getMcpProvider().build({ corsair: tenantCorsair });

//   const message = await client.beta.messages.toolRunner({
//     model: "claude-haiku-4-5",
//     max_tokens: 2048,
//     system: buildAgentSystemPrompt(userEmail),
//     tools,
//     messages: messages as Anthropic.MessageParam[],
//   });

//   return (
//     message.content
//       .filter((b): b is Anthropic.TextBlock => b.type === "text")
//       .map((b) => b.text)
//       .join("\n")
//       .trim() || "Task completed."
//   );
// }

// // ─── OpenAI Agents (gpt-4o-mini + Corsair MCP via OpenAIAgentsProvider) ───────

// async function runOpenAIAgent(
//   corsairTenantId: string,
//   userEmail: string,
//   messages: Array<{ role: "user" | "assistant"; content: string }>,
// ): Promise<string> {
//   const apiKey = env.LLM_PROVIDER_AGENT_KEY ?? env.OPENAI_API_KEY;
//   if (!apiKey) throw new Error("Set LLM_PROVIDER_AGENT_KEY or OPENAI_API_KEY for OpenAI agent");

//   const { Agent, run, tool } = await import("@openai/agents").catch(() => {
//     throw new Error("@openai/agents not installed — run: npm install @openai/agents");
//   });
//   const { OpenAIAgentsProvider } = await import("@corsair-dev/mcp");

//   const tenantCorsair = corsair.withTenant(corsairTenantId);
//   const provider = new OpenAIAgentsProvider();
//   const tools = await provider.build({ corsair: tenantCorsair, tool });

//   const agent = new Agent({
//     name: "superhuman-agent",
//     model: "gpt-4o-mini",
//     instructions: buildAgentSystemPrompt(userEmail),
//     tools,
//   });

//   const lastMsg = messages.findLast((m) => m.role === "user")?.content ?? "";
//   const result = await run(agent, lastMsg);
//   return result.finalOutput ?? "Task completed.";
// }

// // ─── Vercel AI (claude-haiku-4-5 via HTTP MCP endpoint) ───────────────────────

// async function runVercelAiAgent(
//   userEmail: string,
//   messages: Array<{ role: "user" | "assistant"; content: string }>,
// ): Promise<string> {
//   // const { generateText } = await import("ai").catch(() => {
//   //   throw new Error("'ai' package not installed — run: npm install ai");
//   // });
//   // const { anthropic } = await import("@ai-sdk/anthropic").catch(() => {
//   //   throw new Error("@ai-sdk/anthropic not installed — run: npm install @ai-sdk/anthropic");
//   // });
//   // const { createVercelAiMcpClient } = await import("@corsair-dev/mcp");

//   // const mcpUrl = `${env.NEXTAUTH_URL ?? "http://localhost:3000"}/api/mcp`;
//   // const mcpClient = await createVercelAiMcpClient({ url: mcpUrl });

//   // try {
//   //   const tools = await mcpClient.tools();
//   //   const { text } = await generateText({
//   //     model: anthropic("claude-haiku-4-5"),
//   //     tools,
//   //     system: buildAgentSystemPrompt(userEmail),
//   //     messages: messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
//   //     maxSteps: 10,
//   //   });
//   //   return text || "Task completed.";
//   // } finally {
//   //   await mcpClient.close().catch(() => {});
//   // }

//   return "task completed";
// }

// // ─── Agent dispatcher ──────────────────────────────────────────────────────────

// function getAgentProvider(): AgentProvider {
//   const raw = (env.LLM_PROVIDER_FOR_AGENT ?? "nex").toLowerCase().trim();
//   if (raw === "anthropic") return "anthropic";
//   if (raw === "openai_agents" || raw === "openai") return "openai_agents";
//   if (raw === "vercel_ai" || raw === "vercel") return "vercel_ai";
//   return "nex"; // default — free, no extra key needed
// }

// async function runAgent(
//   corsairTenantId: string,
//   userEmail: string,
//   messages: Array<{ role: "user" | "assistant"; content: string }>,
// ): Promise<{ reply: string; model: string; provider: AgentProvider }> {

//   const provider = getAgentProvider();
//   logger.info("Agent dispatch", { provider, corsairTenantId });

//   switch (provider) {
//     case "nex": {
      
//       const reply = await runNexAgent(corsairTenantId, userEmail, messages);
//       return { reply, model: "nex-agi/nex-n2-pro:free", provider };
//     }
//     case "anthropic": {
//       const reply = await runAnthropicAgent(corsairTenantId, userEmail, messages);
//       return { reply, model: "claude-haiku-4-5", provider };
//     }
//     case "openai_agents": {
//       const reply = await runOpenAIAgent(corsairTenantId, userEmail, messages);
//       return { reply, model: "gpt-4o-mini", provider };
//     }
//     case "vercel_ai": {
//       const reply = await runVercelAiAgent(userEmail, messages);
//       return { reply, model: "claude-haiku-4-5 (vercel-ai)", provider };
//     }
//   }
// }

// // ─── Action extraction ─────────────────────────────────────────────────────────

// function extractActions(text: string): AgentAction[] {
//   const actions: AgentAction[] = [];
//   if (/email.*sent|sent.*email|message.*sent|draft.*sent/i.test(text)) {
//     const id = text.match(/message[_\s]?id[:\s]+([a-zA-Z0-9_-]+)/i)?.[1];
//     actions.push({ type: "email_sent", summary: "Email sent", resourceId: id });
//   }
//   if (/event.*created|created.*event|meeting.*scheduled|calendar.*added/i.test(text)) {
//     const id = text.match(/event[_\s]?id[:\s]+([a-zA-Z0-9_@.]+)/i)?.[1];
//     actions.push({ type: "event_created", summary: "Calendar event created", resourceId: id });
//   }
//   if (/event.*updated|rsvp.*updated|meeting.*rescheduled/i.test(text)) {
//     actions.push({ type: "event_updated", summary: "Calendar event updated" });
//   }
//   return actions;
// }

// // ─── processCommand ────────────────────────────────────────────────────────────

// export async function processCommand(
//   tenantId: string,
//   userId: string,
//   userEmail: string,
//   input: ChatInput,
// ): Promise<ChatResponse> {
//   const startTime = Date.now();

//   const userMessages: Array<{ role: "user" | "assistant"; content: string }> = [
//     ...input.conversationHistory.map((m) => ({
//       role: m.role as "user" | "assistant",
//       content: m.content,
//     })),
//     { role: "user", content: input.prompt },
//   ];

//   try {
//     const intent = await classifyIntent(input.prompt);
//     logger.info("Intent", { userId, intent });

//     if (intent === "chat") {
//       const client = getOpenRouterClient();
//       const res = await client.chat.completions.create({
//         model: "nex-agi/nex-n2-pro:free",
//         max_tokens: 1024,
//         messages: [{ role: "system", content: CHAT_SYSTEM }, ...userMessages],
//       });
//       const reply = res.choices[0]?.message?.content ?? "How can I help?";
//       return { reply, actions: [], durationMs: Date.now() - startTime, model: "nex-agi/nex-n2-pro:free", routedTo: "chat" };
//     }

//     const corsairTenantId = getTenantId(tenantId);
//     const agentResult = await runAgent(corsairTenantId, userEmail, userMessages);

//     const actions = extractActions(agentResult.reply);
//     const durationMs = Date.now() - startTime;

//     void db.insert(agentLogs).values({
//       userId,
//       prompt: input.prompt,
//       response: agentResult.reply,
//       actions,
//       durationMs: String(durationMs),
//     }).catch((err: any) => logger.warn("agentLog insert failed", { error: String(err) }));

//     logger.info("Agent done", { userId, provider: agentResult.provider, durationMs });
//     return { reply: agentResult.reply, actions, durationMs, model: agentResult.model, routedTo: "agent" };
//   } catch (err) {
//     logger.error("processCommand failed", { userId, error: String(err) });
//     throw createExternalApiError("LLM Agent", err);
//   }
// }

// // ─── streamCommand ─────────────────────────────────────────────────────────────

// export async function* streamCommand(
//   tenantId: string,
//   userId: string,
//   userEmail: string,
//   input: ChatInput,
// ): AsyncGenerator<string> {
//   const userMessages: Array<{ role: "user" | "assistant"; content: string }> = [
//     ...input.conversationHistory.map((m) => ({
//       role: m.role as "user" | "assistant",
//       content: m.content,
//     })),
//     { role: "user", content: input.prompt },
//   ];

//   try {
//     const intent = await classifyIntent(input.prompt);
//     const client = getOpenRouterClient();

//     // ── Chat path: stream nex-n2-pro directly ──────────────────────────────
//     if (intent === "chat") {
//       const stream = await client.chat.completions.create({
//         model: "nex-agi/nex-n2-pro:free",
//         max_tokens: 1024,
//         stream: true,
//         messages: [{ role: "system", content: CHAT_SYSTEM }, ...userMessages],
//       });
//       for await (const chunk of stream) {
//         const delta = chunk.choices[0]?.delta?.content;
//         if (delta) yield delta;
//       }
//       return;
//     }

//     // ── Agent path ─────────────────────────────────────────────────────────
//     const provider = getAgentProvider();
//     const corsairTenantId = getTenantId(tenantId);

//     if (provider === "anthropic") {
//       // Anthropic supports real streaming with tool calls
//       const apiKey = env.LLM_PROVIDER_AGENT_KEY ?? env.ANTHROPIC_API_KEY;
//       if (!apiKey) throw new Error("No Anthropic API key");

//       const anthClient = new Anthropic({ apiKey });
//       const tenantCorsair = corsair.withTenant(corsairTenantId);
//       const tools = getMcpProvider().build({ corsair: tenantCorsair });

//       const stream = anthClient.messages.stream({
//         model: "claude-haiku-4-5",
//         max_tokens: 2048,
//         system: buildAgentSystemPrompt(userEmail),
//         tools,
//         messages: userMessages as Anthropic.MessageParam[],
//       });

//       for await (const chunk of stream) {
//         if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
//           yield chunk.delta.text;
//         }
//       }
//     } else if (provider === "nex") {
//       // nex: run full tool loop, then stream the final reply word-by-word
//       // (nex tool loop is non-streaming — yield progress indicators while working)
//       yield "⏳ Working on it...\n\n";
//       const agentResult = await runNexAgent(corsairTenantId, userEmail, userMessages);
//       // Stream the result in ~50-char chunks so the UI renders progressively
//       for (let i = 0; i < agentResult.length; i += 50) {
//         yield agentResult.slice(i, i + 50);
//         await new Promise((r) => setTimeout(r, 10));
//       }
//     } else {
//       // openai_agents / vercel_ai — non-streaming, emit full reply
//       yield "⏳ Working on it...\n\n";
//       const agentResult = await runAgent(corsairTenantId, userEmail, userMessages);
//       yield agentResult.reply;
//     }
//   } catch (err) {
//     logger.error("streamCommand failed", { userId, error: String(err) });
//     yield `\n\n[Error: ${err instanceof Error ? err.message : "Something went wrong"}]`;
//   }
// }

// /**
//  * Chat Service — Intent Router + Multi-Provider Agent
//  * (Updated with rich SSE emitters for tool calls + metadata)
//  */

// // import OpenAI from "openai";
// // import Anthropic from "@anthropic-ai/sdk";
// // import { AnthropicProvider } from "@corsair-dev/mcp";
// // import { corsair, getTenantId } from "../lib/corsair";
// // import { agentLogs } from "../db/schema";
// // import { db } from "../db";
// // import { logger } from "@/src/lib/logger";
// // import { createExternalApiError } from "@/src/lib/errors";
// // import type { ChatInput } from "@/src/schema";
// // import type { AgentAction } from "@/src/types";
// // import { env } from "@/src/env";
// // import type { CorsairTenant } from "../lib/corsair";
// // import { emitToUser } from "../lib/sse";

// // // ─── Types ─────────────────────────────────────────────────────────────────────

// // export type AgentProvider = "anthropic" | "openai_agents" | "vercel_ai" | "nex";

// // export interface ChatResponse {
// //   reply: string;
// //   actions: AgentAction[];
// //   durationMs: number;
// //   model: string;
// //   routedTo: "chat" | "agent";
// // }

// // // Last-action metadata emitted after tool execution for the meta panel in the UI
// // interface LastActionMeta {
// //   toolName: string;
// //   status: "success" | "error";
// //   timestamp: string;
// //   details?: Record<string, string>;
// //   preview?: {
// //     type: "email" | "calendar";
// //     fields: Array<{ label: string; value: string }>;
// //   };
// //   summary?: string;
// // }

// // // ─── Helpers ────────────────────────────────────────────────────────────────────

// // function fmtTime(): string {
// //   return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
// // }

// // /** Build a human-friendly label for a tool call to show as the activity step heading. */
// // const TOOL_STEP_LABEL: Record<string, string> = {
// //   gmail_messages_send: "Sending email",
// //   gmail_messages_list: "Searching inbox",
// //   gmail_messages_get: "Reading message",
// //   gmail_messages_modify: "Updating labels",
// //   gmail_messages_trash: "Moving to trash",
// //   gmail_messages_untrash: "Restoring from trash",
// //   gmail_messages_batch_modify: "Bulk updating messages",
// //   gmail_threads_list: "Listing threads",
// //   gmail_threads_get: "Reading thread",
// //   gmail_threads_modify: "Updating thread",
// //   gmail_threads_trash: "Trashing thread",
// //   gmail_drafts_create: "Creating draft",
// //   gmail_drafts_list: "Listing drafts",
// //   gmail_drafts_send: "Sending draft",
// //   gmail_drafts_delete: "Deleting draft",
// //   gmail_labels_list: "Fetching labels",
// //   gmail_labels_create: "Creating label",
// //   gmail_db_messages_search: "Searching local cache",
// //   gmail_db_threads_search: "Searching threads cache",
// //   gmail_db_drafts_search: "Searching drafts cache",
// //   gmail_db_labels_search: "Searching labels cache",
// //   calendar_events_list: "Fetching calendar events",
// //   calendar_events_get: "Reading event",
// //   calendar_events_create: "Creating calendar event",
// //   calendar_events_update: "Updating event",
// //   calendar_events_delete: "Deleting event",
// //   calendar_get_availability: "Checking availability",
// //   calendar_db_events_search: "Searching events cache",
// //   calendar_db_calendars_search: "Searching calendars cache",
// // };

// // function toolStepLabel(name: string): string {
// //   return TOOL_STEP_LABEL[name] ?? name;
// // }

// // /** Build the LastActionMeta panel payload from tool result. */
// // function buildMeta(
// //   toolName: string,
// //   args: ToolArgs,
// //   result: unknown,
// //   status: "success" | "error",
// // ): LastActionMeta {
// //   const r = (result ?? {}) as Record<string, unknown>;
// //   const details: Record<string, string> = {};

// //   // Shared fields
// //   if (r.id) details["Message ID"] = String(r.id);
// //   if (r.threadId) details["Thread ID"] = String(r.threadId);
// //   if (r.labelIds) details["Labels"] = (r.labelIds as string[]).join(", ");

// //   let preview: LastActionMeta["preview"] | undefined;

// //   // Email-specific
// //   if (toolName === "gmail_messages_send") {
// //     if (args.to) details["To"] = String(args.to);
// //     if (args.subject) details["Subject"] = String(args.subject);
// //     if (r.id) details["Message ID"] = String(r.id);
// //     details["Provider"] = "Gmail";
// //     details["Status"] = status === "success" ? "Sent" : "Failed";

// //     preview = {
// //       type: "email",
// //       fields: [
// //         { label: "To:", value: String(args.to ?? "") },
// //         { label: "Subject:", value: String(args.subject ?? "") },
// //         { label: "Body", value: String(args.body ?? "").slice(0, 300) },
// //       ],
// //     };
// //   }

// //   // Calendar create
// //   if (toolName === "calendar_events_create") {
// //     if (args.summary) details["Title"] = String(args.summary);
// //     if (args.startDateTime) details["Start"] = String(args.startDateTime);
// //     if (args.endDateTime) details["End"] = String(args.endDateTime);
// //     if (r.id) details["Event ID"] = String(r.id);
// //     details["Status"] = status === "success" ? "Created" : "Failed";

// //     preview = {
// //       type: "calendar",
// //       fields: [
// //         { label: "Title:", value: String(args.summary ?? "") },
// //         { label: "Start:", value: String(args.startDateTime ?? "") },
// //         { label: "End:", value: String(args.endDateTime ?? "") },
// //         ...(args.attendees ? [{ label: "Attendees:", value: (args.attendees as string[]).join(", ") }] : []),
// //       ],
// //     };
// //   }

// //   // Calendar update
// //   if (toolName === "calendar_events_update") {
// //     if (args.summary) details["Title"] = String(args.summary);
// //     if (args.startDateTime) details["New Start"] = String(args.startDateTime);
// //     details["Status"] = status === "success" ? "Updated" : "Failed";
// //   }

// //   return {
// //     toolName,
// //     status,
// //     timestamp: fmtTime(),
// //     details: Object.keys(details).length ? details : undefined,
// //     preview,
// //     summary: undefined, // filled in after runAgent completes
// //   };
// // }

// // // ─── OpenRouter client ─────────────────────────────────────────────────────────

// // let _orClient: OpenAI | null = null;
// // function getOpenRouterClient(): OpenAI {
// //   if (!_orClient) {
// //     const key = env.OPENROUTER_API_KEY;
// //     if (!key) throw new Error("OPENROUTER_API_KEY is required");
// //     _orClient = new OpenAI({
// //       baseURL: "https://openrouter.ai/api/v1",
// //       apiKey: key,
// //       defaultHeaders: {
// //         "HTTP-Referer": env.NEXTAUTH_URL ?? "http://localhost:3000",
// //         "X-Title": "Superhuman",
// //       },
// //     });
// //   }
// //   return _orClient;
// // }

// // // ─── Intent router ─────────────────────────────────────────────────────────────

// // const AGENT_KEYWORDS = [
// //   "send email","send an email","draft email","reply to","forward",
// //   "calendar invite","calendar event","schedule","reschedule","meeting",
// //   "create event","invite","rsvp","accept invite","decline invite",
// //   "check availability","free slot","archive","mark as read","mark read",
// //   "unread","label","search email","find email","trash","delete email",
// //   "list emails","show emails","read email","open email","get emails",
// //   "upcoming events","my calendar","what's on","today's events",
// // ];

// // function quickKeywordCheck(prompt: string): boolean {
// //   const lower = prompt.toLowerCase();
// //   return AGENT_KEYWORDS.some((kw) => lower.includes(kw));
// // }

// // const ROUTER_SYSTEM = `You are an intent classifier. Decide if the user wants to perform a Gmail or Google Calendar action (agent) or is just having a conversation (chat).

// // Reply with EXACTLY one word — "agent" or "chat" — nothing else.`;

// // async function classifyIntent(prompt: string): Promise<"chat" | "agent"> {
// //   if (quickKeywordCheck(prompt)) {
// //     logger.debug("Router: keyword → agent");
// //     return "agent";
// //   }
// //   try {
// //     const client = getOpenRouterClient();
// //     const res = await client.chat.completions.create({
// //       model: "nex-agi/nex-n2-pro:free",
// //       max_tokens: 5,
// //       temperature: 0,
// //       messages: [
// //         { role: "system", content: ROUTER_SYSTEM },
// //         { role: "user", content: prompt.slice(0, 400) },
// //       ],
// //     });
// //     const raw = res.choices[0]?.message?.content?.trim().toLowerCase() ?? "";
// //     return raw.startsWith("agent") ? "agent" : "chat";
// //   } catch {
// //     return "agent";
// //   }
// // }

// // // ─── Chat path ─────────────────────────────────────────────────────────────────

// // const CHAT_SYSTEM = `You are a helpful assistant inside a Superhuman-style email and calendar app.
// // Answer concisely. If the user seems to want to perform an email or calendar action, remind them they can ask directly.`;

// // // ─── Tool Registry ──────────────────────────────────────────────────────────────

// // function buildToolRegistry(): OpenAI.Chat.ChatCompletionTool[] {
// //   return [
// //     { type: "function", function: { name: "gmail_messages_list", description: "List or search messages in the Gmail mailbox.", parameters: { type: "object", properties: { q: { type: "string" }, maxResults: { type: "number" }, labelIds: { type: "array", items: { type: "string" } }, pageToken: { type: "string" }, includeSpamTrash: { type: "boolean" } }, required: [] } } },
// //     { type: "function", function: { name: "gmail_messages_get", description: "Get a specific Gmail message by ID.", parameters: { type: "object", properties: { id: { type: "string" }, format: { type: "string", enum: ["minimal","full","raw","metadata"] } }, required: ["id"] } } },
// //     { type: "function", function: { name: "gmail_messages_send", description: "Send an email.", parameters: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, cc: { type: "string" }, bcc: { type: "string" }, fromEmail: { type: "string" }, threadId: { type: "string" } }, required: ["to","subject","body"] } } },
// //     { type: "function", function: { name: "gmail_messages_modify", description: "Add or remove labels from a message.", parameters: { type: "object", properties: { id: { type: "string" }, addLabelIds: { type: "array", items: { type: "string" } }, removeLabelIds: { type: "array", items: { type: "string" } } }, required: ["id"] } } },
// //     { type: "function", function: { name: "gmail_messages_trash", description: "Move a message to trash.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
// //     { type: "function", function: { name: "gmail_messages_untrash", description: "Restore a message from trash.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
// //     { type: "function", function: { name: "gmail_messages_batch_modify", description: "Bulk label operations on multiple messages.", parameters: { type: "object", properties: { ids: { type: "array", items: { type: "string" } }, addLabelIds: { type: "array", items: { type: "string" } }, removeLabelIds: { type: "array", items: { type: "string" } } }, required: ["ids"] } } },
// //     { type: "function", function: { name: "gmail_threads_list", description: "List email threads.", parameters: { type: "object", properties: { q: { type: "string" }, maxResults: { type: "number" }, labelIds: { type: "array", items: { type: "string" } }, pageToken: { type: "string" } }, required: [] } } },
// //     { type: "function", function: { name: "gmail_threads_get", description: "Get a full thread by ID.", parameters: { type: "object", properties: { id: { type: "string" }, format: { type: "string", enum: ["minimal","full","metadata"] } }, required: ["id"] } } },
// //     { type: "function", function: { name: "gmail_threads_modify", description: "Modify thread labels.", parameters: { type: "object", properties: { id: { type: "string" }, addLabelIds: { type: "array", items: { type: "string" } }, removeLabelIds: { type: "array", items: { type: "string" } } }, required: ["id"] } } },
// //     { type: "function", function: { name: "gmail_threads_trash", description: "Trash an entire thread.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
// //     { type: "function", function: { name: "gmail_drafts_create", description: "Create a draft.", parameters: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, cc: { type: "string" }, threadId: { type: "string" } }, required: ["to","subject","body"] } } },
// //     { type: "function", function: { name: "gmail_drafts_list", description: "List drafts.", parameters: { type: "object", properties: { maxResults: { type: "number" }, q: { type: "string" } }, required: [] } } },
// //     { type: "function", function: { name: "gmail_drafts_send", description: "Send an existing draft.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
// //     { type: "function", function: { name: "gmail_drafts_delete", description: "Delete a draft.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
// //     { type: "function", function: { name: "gmail_labels_list", description: "List all Gmail labels.", parameters: { type: "object", properties: {}, required: [] } } },
// //     { type: "function", function: { name: "gmail_labels_create", description: "Create a label.", parameters: { type: "object", properties: { name: { type: "string" }, messageListVisibility: { type: "string", enum: ["show","hide"] }, labelListVisibility: { type: "string", enum: ["labelShow","labelShowIfUnread","labelHide"] } }, required: ["name"] } } },
// //     { type: "function", function: { name: "gmail_db_messages_search", description: "Search local Gmail cache (instant, no quota).", parameters: { type: "object", properties: { subject: { type: "string" }, body: { type: "string" }, from: { type: "string" }, to: { type: "string" }, snippet: { type: "string" }, threadId: { type: "string" }, limit: { type: "number" }, offset: { type: "number" } }, required: [] } } },
// //     { type: "function", function: { name: "gmail_db_threads_search", description: "Search local thread cache.", parameters: { type: "object", properties: { snippet: { type: "string" }, limit: { type: "number" }, offset: { type: "number" } }, required: [] } } },
// //     { type: "function", function: { name: "gmail_db_drafts_search", description: "Search local drafts cache.", parameters: { type: "object", properties: { limit: { type: "number" }, offset: { type: "number" } }, required: [] } } },
// //     { type: "function", function: { name: "gmail_db_labels_search", description: "Search local labels cache.", parameters: { type: "object", properties: { name: { type: "string" }, limit: { type: "number" } }, required: [] } } },
// //     { type: "function", function: { name: "calendar_events_list", description: "List Google Calendar events.", parameters: { type: "object", properties: { timeMin: { type: "string" }, timeMax: { type: "string" }, q: { type: "string" }, maxResults: { type: "number" }, singleEvents: { type: "boolean" }, orderBy: { type: "string", enum: ["startTime","updated"] }, calendarId: { type: "string" }, showDeleted: { type: "boolean" } }, required: [] } } },
// //     { type: "function", function: { name: "calendar_events_get", description: "Get a calendar event by ID.", parameters: { type: "object", properties: { id: { type: "string" }, calendarId: { type: "string" } }, required: ["id"] } } },
// //     { type: "function", function: { name: "calendar_events_create", description: "Create a calendar event.", parameters: { type: "object", properties: { summary: { type: "string" }, description: { type: "string" }, location: { type: "string" }, startDateTime: { type: "string" }, endDateTime: { type: "string" }, timeZone: { type: "string" }, attendees: { type: "array", items: { type: "string" } }, sendUpdates: { type: "string", enum: ["all","externalOnly","none"] }, calendarId: { type: "string" }, recurrence: { type: "array", items: { type: "string" } } }, required: ["summary","startDateTime","endDateTime"] } } },
// //     { type: "function", function: { name: "calendar_events_update", description: "Update a calendar event.", parameters: { type: "object", properties: { id: { type: "string" }, summary: { type: "string" }, description: { type: "string" }, location: { type: "string" }, startDateTime: { type: "string" }, endDateTime: { type: "string" }, timeZone: { type: "string" }, attendees: { type: "array", items: { type: "string" } }, sendUpdates: { type: "string", enum: ["all","externalOnly","none"] }, calendarId: { type: "string" } }, required: ["id"] } } },
// //     { type: "function", function: { name: "calendar_events_delete", description: "Delete a calendar event.", parameters: { type: "object", properties: { id: { type: "string" }, calendarId: { type: "string" }, sendUpdates: { type: "string", enum: ["all","externalOnly","none"] } }, required: ["id"] } } },
// //     { type: "function", function: { name: "calendar_get_availability", description: "Check free/busy for calendars.", parameters: { type: "object", properties: { timeMin: { type: "string" }, timeMax: { type: "string" }, calendarIds: { type: "array", items: { type: "string" } }, timeZone: { type: "string" } }, required: ["timeMin","timeMax"] } } },
// //     { type: "function", function: { name: "calendar_db_events_search", description: "Search local calendar event cache.", parameters: { type: "object", properties: { summary: { type: "string" }, description: { type: "string" }, location: { type: "string" }, calendarId: { type: "string" }, recurringEventId: { type: "string" }, limit: { type: "number" }, offset: { type: "number" } }, required: [] } } },
// //     { type: "function", function: { name: "calendar_db_calendars_search", description: "Search local calendars cache.", parameters: { type: "object", properties: { summary: { type: "string" }, timeZone: { type: "string" }, limit: { type: "number" } }, required: [] } } },
// //   ];
// // }

// // // ─── Tool executor ──────────────────────────────────────────────────────────────

// // function buildRawEmail(opts: { from?: string; to: string; cc?: string; bcc?: string; subject: string; body: string; threadId?: string }): string {
// //   const lines = [
// //     opts.from ? `From: ${opts.from}` : null,
// //     `To: ${opts.to}`,
// //     opts.cc ? `Cc: ${opts.cc}` : null,
// //     opts.bcc ? `Bcc: ${opts.bcc}` : null,
// //     `Subject: ${opts.subject}`,
// //     "MIME-Version: 1.0",
// //     "Content-Type: text/plain; charset=UTF-8",
// //     "",
// //     opts.body,
// //   ].filter((l): l is string => l !== null).join("\r\n");
// //   return Buffer.from(lines).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// // }

// // type ToolArgs = Record<string, unknown>;

// // async function executeTool(name: string, args: ToolArgs, tenant: CorsairTenant, userEmail: string): Promise<unknown> {
// //   switch (name) {
// //     case "gmail_messages_list":
// //       return tenant.gmail.api.messages.list({ q: args.q as string | undefined, maxResults: (args.maxResults as number | undefined) ?? 20, labelIds: args.labelIds as string[] | undefined, pageToken: args.pageToken as string | undefined, includeSpamTrash: args.includeSpamTrash as boolean | undefined });
// //     case "gmail_messages_get":
// //       return tenant.gmail.api.messages.get({ id: args.id as string, format: (args.format as "minimal" | "full" | "raw" | "metadata") ?? "full" });
// //     case "gmail_messages_send": {
// //       const raw = buildRawEmail({ from: userEmail, to: args.to as string, cc: args.cc as string | undefined, bcc: args.bcc as string | undefined, subject: args.subject as string, body: args.body as string, threadId: args.threadId as string | undefined });
// //       return tenant.gmail.api.messages.send({ raw, threadId: args.threadId as string | undefined });
// //     }
// //     case "gmail_messages_modify":
// //       return tenant.gmail.api.messages.modify({ id: args.id as string, addLabelIds: args.addLabelIds as string[] | undefined, removeLabelIds: args.removeLabelIds as string[] | undefined });
// //     case "gmail_messages_trash":
// //       return tenant.gmail.api.messages.trash({ id: args.id as string });
// //     case "gmail_messages_untrash":
// //       return tenant.gmail.api.messages.untrash({ id: args.id as string });
// //     case "gmail_messages_batch_modify":
// //       return tenant.gmail.api.messages.batchModify({ ids: args.ids as string[], addLabelIds: args.addLabelIds as string[] | undefined, removeLabelIds: args.removeLabelIds as string[] | undefined });
// //     case "gmail_threads_list":
// //       return tenant.gmail.api.threads.list({ q: args.q as string | undefined, maxResults: (args.maxResults as number | undefined) ?? 20, labelIds: args.labelIds as string[] | undefined, pageToken: args.pageToken as string | undefined });
// //     case "gmail_threads_get":
// //       return tenant.gmail.api.threads.get({ id: args.id as string, format: (args.format as "minimal" | "full" | "metadata") ?? "full" });
// //     case "gmail_threads_modify":
// //       return tenant.gmail.api.threads.modify({ id: args.id as string, addLabelIds: args.addLabelIds as string[] | undefined, removeLabelIds: args.removeLabelIds as string[] | undefined });
// //     case "gmail_threads_trash":
// //       return tenant.gmail.api.threads.trash({ id: args.id as string });
// //     case "gmail_drafts_create": {
// //       const raw = buildRawEmail({ from: userEmail, to: args.to as string, cc: args.cc as string | undefined, subject: args.subject as string, body: args.body as string, threadId: args.threadId as string | undefined });
// //       return tenant.gmail.api.drafts.create({ draft: { message: { raw, threadId: args.threadId as string | undefined } } });
// //     }
// //     case "gmail_drafts_list":
// //       return tenant.gmail.api.drafts.list({ maxResults: args.maxResults as number | undefined, q: args.q as string | undefined });
// //     case "gmail_drafts_send":
// //       return tenant.gmail.api.drafts.send({ id: args.id as string });
// //     case "gmail_drafts_delete":
// //       return tenant.gmail.api.drafts.delete({ id: args.id as string });
// //     case "gmail_labels_list":
// //       return tenant.gmail.api.labels.list({});
// //     case "gmail_labels_create":
// //       return tenant.gmail.api.labels.create({ label: { name: args.name as string, messageListVisibility: args.messageListVisibility as "show" | "hide" | undefined, labelListVisibility: args.labelListVisibility as "labelShow" | "labelShowIfUnread" | "labelHide" | undefined } });
// //     case "gmail_db_messages_search": {
// //       const data: Record<string, unknown> = {};
// //       if (args.subject) data.subject = { contains: args.subject };
// //       if (args.body) data.body = { contains: args.body };
// //       if (args.from) data.from = { contains: args.from };
// //       if (args.to) data.to = { contains: args.to };
// //       if (args.snippet) data.snippet = { contains: args.snippet };
// //       if (args.threadId) data.threadId = { equals: args.threadId };
// //       return tenant.gmail.db.messages.search({ data, limit: (args.limit as number | undefined) ?? 20, offset: (args.offset as number | undefined) ?? 0 });
// //     }
// //     case "gmail_db_threads_search": {
// //       const data: Record<string, unknown> = {};
// //       if (args.snippet) data.snippet = { contains: args.snippet };
// //       return tenant.gmail.db.threads.search({ data, limit: (args.limit as number | undefined) ?? 20, offset: (args.offset as number | undefined) ?? 0 });
// //     }
// //     case "gmail_db_drafts_search":
// //       return tenant.gmail.db.drafts.search({ data: {}, limit: (args.limit as number | undefined) ?? 20, offset: (args.offset as number | undefined) ?? 0 });
// //     case "gmail_db_labels_search": {
// //       const data: Record<string, unknown> = {};
// //       if (args.name) data.name = { contains: args.name };
// //       return tenant.gmail.db.labels.search({ data, limit: (args.limit as number | undefined) ?? 50 });
// //     }
// //     case "calendar_events_list":
// //       return tenant.googlecalendar.api.events.getMany({ calendarId: (args.calendarId as string | undefined) ?? "primary", timeMin: (args.timeMin as string | undefined) ?? new Date().toISOString(), timeMax: args.timeMax as string | undefined, q: args.q as string | undefined, maxResults: (args.maxResults as number | undefined) ?? 20, singleEvents: (args.singleEvents as boolean | undefined) ?? true, orderBy: (args.orderBy as "startTime" | "updated" | undefined) ?? "startTime", showDeleted: args.showDeleted as boolean | undefined });
// //     case "calendar_events_get":
// //       return tenant.googlecalendar.api.events.get({ id: args.id as string, calendarId: (args.calendarId as string | undefined) ?? "primary" });
// //     case "calendar_events_create": {
// //       const attendees = (args.attendees as string[] | undefined)?.map((email) => ({ email }));
// //       return tenant.googlecalendar.api.events.create({ calendarId: (args.calendarId as string | undefined) ?? "primary", event: { summary: args.summary as string, description: args.description as string | undefined, location: args.location as string | undefined, start: { dateTime: args.startDateTime as string, timeZone: args.timeZone as string | undefined }, end: { dateTime: args.endDateTime as string, timeZone: args.timeZone as string | undefined }, attendees, recurrence: args.recurrence as string[] | undefined }, sendUpdates: ((args.sendUpdates as string | undefined) ?? "all") as "all" | "externalOnly" | "none" });
// //     }
// //     case "calendar_events_update": {
// //       const attendees = (args.attendees as string[] | undefined)?.map((email) => ({ email }));
// //       const eventPatch: Record<string, unknown> = {};
// //       if (args.summary) eventPatch.summary = args.summary;
// //       if (args.description) eventPatch.description = args.description;
// //       if (args.location) eventPatch.location = args.location;
// //       if (args.startDateTime) eventPatch.start = { dateTime: args.startDateTime, timeZone: args.timeZone };
// //       if (args.endDateTime) eventPatch.end = { dateTime: args.endDateTime, timeZone: args.timeZone };
// //       if (attendees) eventPatch.attendees = attendees;
// //       return tenant.googlecalendar.api.events.update({ id: args.id as string, calendarId: (args.calendarId as string | undefined) ?? "primary", event: eventPatch, sendUpdates: ((args.sendUpdates as string | undefined) ?? "all") as "all" | "externalOnly" | "none" });
// //     }
// //     case "calendar_events_delete":
// //       return tenant.googlecalendar.api.events.delete({ id: args.id as string, calendarId: (args.calendarId as string | undefined) ?? "primary", sendUpdates: ((args.sendUpdates as string | undefined) ?? "all") as "all" | "externalOnly" | "none" });
// //     case "calendar_get_availability": {
// //       const calIds = (args.calendarIds as string[] | undefined) ?? ["primary"];
// //       return tenant.googlecalendar.api.calendar.getAvailability({ timeMin: args.timeMin as string, timeMax: args.timeMax as string, timeZone: args.timeZone as string | undefined, items: calIds.map((id) => ({ id })) });
// //     }
// //     case "calendar_db_events_search": {
// //       const data: Record<string, unknown> = {};
// //       if (args.summary) data.summary = { contains: args.summary };
// //       if (args.description) data.description = { contains: args.description };
// //       if (args.location) data.location = { contains: args.location };
// //       if (args.calendarId) data.calendarId = { equals: args.calendarId };
// //       if (args.recurringEventId) data.recurringEventId = { equals: args.recurringEventId };
// //       return tenant.googlecalendar.db.events.search({ data, limit: (args.limit as number | undefined) ?? 20, offset: (args.offset as number | undefined) ?? 0 });
// //     }
// //     case "calendar_db_calendars_search": {
// //       const data: Record<string, unknown> = {};
// //       if (args.summary) data.summary = { contains: args.summary };
// //       if (args.timeZone) data.timeZone = { equals: args.timeZone };
// //       return tenant.googlecalendar.db.calendars.search({ data, limit: (args.limit as number | undefined) ?? 20 });
// //     }
// //     default:
// //       throw new Error(`Unknown tool: ${name}`);
// //   }
// // }

// // // ─── Agent system prompt ───────────────────────────────────────────────────────

// // function buildAgentSystemPrompt(userEmail: string): string {
// //   return `You are an elite Gmail and Google Calendar assistant inside a Superhuman-style productivity app.

// // ## Context
// // - User email: ${userEmail}
// // - Current time (UTC): ${new Date().toISOString()}

// // ## Strategy
// // 1. For search/lookup: try DB tools first (gmail_db_*, calendar_db_*) — instant, no API quota.
// // 2. For actions (send, create, update, delete): use API tools directly.
// // 3. For availability/scheduling: check calendar_get_availability before creating events.
// // 4. Chain tool calls for complex tasks ("send invite + email").

// // ## Rules
// // - ALWAYS execute — never ask "shall I proceed?" for clear instructions
// // - Confirm completed actions with resource IDs
// // - For calendar events: always include startDateTime + endDateTime in ISO 8601
// // - Batch operations when possible
// // - Keep final summary to 1-3 lines`;
// // }

// // // ─── nex-n2-pro agent (manual tool loop with rich emitters) ───────────────────

// // async function runNexAgent(
// //   corsairTenantId: string,
// //   userEmail: string,
// //   messages: Array<{ role: "user" | "assistant"; content: string }>,
// // ): Promise<string> {
// //   const client = getOpenRouterClient();
// //   const tenant = corsair.withTenant(corsairTenantId);
// //   const tools = buildToolRegistry();

// //   // Step 1: Understanding
// //   emitToUser(corsairTenantId, {
// //     type: "agent_status",
// //     data: { level: "info", message: "Understanding your request..." },
// //   });

// //   const loopMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
// //     { role: "system", content: buildAgentSystemPrompt(userEmail) },
// //     ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
// //   ];

// //   // Step 2: Planning
// //   emitToUser(corsairTenantId, {
// //     type: "agent_status",
// //     data: { level: "info", message: "Planning the right actions..." },
// //   });

// //   const MAX_TOOL_ROUNDS = 8;
// //   let lastActionMeta: LastActionMeta | null = null;

// //   for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
// //     const response = await client.chat.completions.create({
// //       model: "nex-agi/nex-n2-pro:free",
// //       max_tokens: 2048,
// //       tools,
// //       tool_choice: "auto",
// //       messages: loopMessages,
// //     });

// //     const choice = response.choices[0];
// //     if (!choice) break;

// //     const assistantMsg = choice.message;
// //     loopMessages.push(assistantMsg as OpenAI.Chat.ChatCompletionMessageParam);

// //     if (choice.finish_reason !== "tool_calls" || !assistantMsg.tool_calls?.length) {
// //       emitToUser(corsairTenantId, {
// //         type: "agent_status",
// //         data: { level: "success", message: "Finished — preparing your response" },
// //       });
// //       return assistantMsg.content ?? "Task completed.";
// //     }

// //     // Execute tool calls
// //     const toolResultMsgs: OpenAI.Chat.ChatCompletionToolMessageParam[] = await Promise.all(
// //       assistantMsg.tool_calls.map(async (tc) => {
// //         if (tc.type !== "function") {
// //           return { role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify({ error: "Unsupported tool type" }) };
// //         }

// //         const toolName = tc.function.name;
// //         let args: ToolArgs = {};
// //         try { args = JSON.parse(tc.function.arguments) as ToolArgs; } catch {}

// //         // Emit: tool starting (pending)
// //         emitToUser(corsairTenantId, {
// //           type: "agent_status",
// //           data: {
// //             level: "info",
// //             message: `Using Gmail to ${toolStepLabel(toolName).toLowerCase()}...`,
// //             toolName,
// //             toolArgs: args,
// //             toolStatus: "pending",
// //           },
// //         });

// //         let result: unknown;
// //         let status: "success" | "error" = "success";

// //         try {
// //           result = await executeTool(toolName, args, tenant, userEmail);
// //           status = "success";

// //           // Build meta for action tools
// //           if (["gmail_messages_send","calendar_events_create","calendar_events_update","calendar_events_delete"].includes(toolName)) {
// //             lastActionMeta = buildMeta(toolName, args, result, "success");
// //           }

// //           // Emit: tool succeeded
// //           emitToUser(corsairTenantId, {
// //             type: "agent_status",
// //             data: {
// //               level: "success",
// //               message: `${toolStepLabel(toolName)} completed successfully`,
// //               toolName,
// //               toolArgs: args,
// //               toolResult: result,
// //               toolStatus: "success",
// //               ...(lastActionMeta ? { meta: lastActionMeta } : {}),
// //             },
// //           });

// //           logger.debug("nex tool success", { tool: toolName });
// //         } catch (err) {
// //           status = "error";
// //           result = { error: String(err) };

// //           if (["gmail_messages_send","calendar_events_create","calendar_events_update"].includes(toolName)) {
// //             lastActionMeta = buildMeta(toolName, args, result, "error");
// //           }

// //           // Emit: tool failed
// //           emitToUser(corsairTenantId, {
// //             type: "agent_status",
// //             data: {
// //               level: "error",
// //               message: `${toolStepLabel(toolName)} failed: ${String(err)}`,
// //               toolName,
// //               toolArgs: args,
// //               toolStatus: "error",
// //               ...(lastActionMeta ? { meta: lastActionMeta } : {}),
// //             },
// //           });

// //           logger.warn("nex tool error", { tool: toolName, error: String(err) });
// //         }

// //         return { role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify(result) };
// //       }),
// //     );

// //     loopMessages.push(...toolResultMsgs);
// //   }

// //   // Hit round limit
// //   emitToUser(corsairTenantId, {
// //     type: "agent_status",
// //     data: { level: "info", message: "Wrapping up..." },
// //   });

// //   loopMessages.push({ role: "user", content: "Summarize what was accomplished in 1-3 lines." });
// //   const summary = await client.chat.completions.create({
// //     model: "nex-agi/nex-n2-pro:free",
// //     max_tokens: 512,
// //     messages: loopMessages,
// //   });

// //   const finalText = summary.choices[0]?.message?.content ?? "Task completed.";

// //   // Attach summary to meta if we have one
// //   if (lastActionMeta) {
// //     (lastActionMeta as LastActionMeta).summary = finalText;
// //     emitToUser(corsairTenantId, {
// //       type: "agent_status",
// //       data: { level: "success", message: "Done", meta: lastActionMeta },
// //     });
// //   }

// //   return finalText;
// // }

// // // ─── Anthropic agent ───────────────────────────────────────────────────────────

// // let _mcpProvider: AnthropicProvider | null = null;
// // function getMcpProvider(): AnthropicProvider {
// //   if (!_mcpProvider) _mcpProvider = new AnthropicProvider();
// //   return _mcpProvider;
// // }

// // async function runAnthropicAgent(
// //   corsairTenantId: string,
// //   userEmail: string,
// //   messages: Array<{ role: "user" | "assistant"; content: string }>,
// // ): Promise<string> {
// //   const apiKey = env.LLM_PROVIDER_AGENT_KEY ?? env.ANTHROPIC_API_KEY;
// //   if (!apiKey) throw new Error("Set LLM_PROVIDER_AGENT_KEY or ANTHROPIC_API_KEY for Anthropic agent");

// //   emitToUser(corsairTenantId, { type: "agent_status", data: { level: "info", message: "Understanding your request..." } });

// //   const client = new Anthropic({ apiKey });
// //   const tenantCorsair = corsair.withTenant(corsairTenantId);
// //   const tools = getMcpProvider().build({ corsair: tenantCorsair });

// //   emitToUser(corsairTenantId, { type: "agent_status", data: { level: "info", message: "Executing with Claude..." } });

// //   const message = await client.beta.messages.toolRunner({
// //     model: "claude-haiku-4-5",
// //     max_tokens: 2048,
// //     system: buildAgentSystemPrompt(userEmail),
// //     tools,
// //     messages: messages as Anthropic.MessageParam[],
// //   });

// //   emitToUser(corsairTenantId, { type: "agent_status", data: { level: "success", message: "Task complete" } });

// //   return (
// //     message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim() || "Task completed."
// //   );
// // }

// // // ─── OpenAI Agents ─────────────────────────────────────────────────────────────

// // async function runOpenAIAgent(
// //   corsairTenantId: string,
// //   userEmail: string,
// //   messages: Array<{ role: "user" | "assistant"; content: string }>,
// // ): Promise<string> {
// //   const apiKey = env.LLM_PROVIDER_AGENT_KEY ?? env.OPENAI_API_KEY;
// //   if (!apiKey) throw new Error("Set LLM_PROVIDER_AGENT_KEY or OPENAI_API_KEY for OpenAI agent");

// //   emitToUser(corsairTenantId, { type: "agent_status", data: { level: "info", message: "Running with GPT-4o-mini..." } });

// //   const { Agent, run, tool } = await import("@openai/agents").catch(() => {
// //     throw new Error("@openai/agents not installed — run: npm install @openai/agents");
// //   });
// //   const { OpenAIAgentsProvider } = await import("@corsair-dev/mcp");

// //   const tenantCorsair = corsair.withTenant(corsairTenantId);
// //   const provider = new OpenAIAgentsProvider();
// //   const tools = await provider.build({ corsair: tenantCorsair, tool });

// //   const agent = new Agent({ name: "superhuman-agent", model: "gpt-4o-mini", instructions: buildAgentSystemPrompt(userEmail), tools });
// //   const lastMsg = messages.findLast((m) => m.role === "user")?.content ?? "";
// //   const result = await run(agent, lastMsg);

// //   emitToUser(corsairTenantId, { type: "agent_status", data: { level: "success", message: "Task complete" } });

// //   return result.finalOutput ?? "Task completed.";
// // }

// // // ─── Vercel AI ─────────────────────────────────────────────────────────────────

// // async function runVercelAiAgent(_userEmail: string, _messages: Array<{ role: "user" | "assistant"; content: string }>): Promise<string> {
// //   return "Task completed.";
// // }

// // // ─── Agent dispatcher ──────────────────────────────────────────────────────────

// // function getAgentProvider(): AgentProvider {
// //   const raw = (env.LLM_PROVIDER_FOR_AGENT ?? "nex").toLowerCase().trim();
// //   if (raw === "anthropic") return "anthropic";
// //   if (raw === "openai_agents" || raw === "openai") return "openai_agents";
// //   if (raw === "vercel_ai" || raw === "vercel") return "vercel_ai";
// //   return "nex";
// // }

// // async function runAgent(
// //   corsairTenantId: string,
// //   userEmail: string,
// //   messages: Array<{ role: "user" | "assistant"; content: string }>,
// // ): Promise<{ reply: string; model: string; provider: AgentProvider }> {
// //   const provider = getAgentProvider();
// //   logger.info("Agent dispatch", { provider, corsairTenantId });

// //   switch (provider) {
// //     case "nex": {
// //       const reply = await runNexAgent(corsairTenantId, userEmail, messages);
// //       return { reply, model: "nex-agi/nex-n2-pro:free", provider };
// //     }
// //     case "anthropic": {
// //       const reply = await runAnthropicAgent(corsairTenantId, userEmail, messages);
// //       return { reply, model: "claude-haiku-4-5", provider };
// //     }
// //     case "openai_agents": {
// //       const reply = await runOpenAIAgent(corsairTenantId, userEmail, messages);
// //       return { reply, model: "gpt-4o-mini", provider };
// //     }
// //     case "vercel_ai": {
// //       const reply = await runVercelAiAgent(userEmail, messages);
// //       return { reply, model: "claude-haiku-4-5 (vercel-ai)", provider };
// //     }
// //   }
// // }

// // // ─── Action extraction ─────────────────────────────────────────────────────────

// // function extractActions(text: string): AgentAction[] {
// //   const actions: AgentAction[] = [];
// //   if (/email.*sent|sent.*email|message.*sent|draft.*sent/i.test(text)) {
// //     const id = text.match(/message[_\s]?id[:\s]+([a-zA-Z0-9_-]+)/i)?.[1];
// //     actions.push({ type: "email_sent", summary: "Email sent", resourceId: id });
// //   }
// //   if (/event.*created|created.*event|meeting.*scheduled|calendar.*added/i.test(text)) {
// //     const id = text.match(/event[_\s]?id[:\s]+([a-zA-Z0-9_@.]+)/i)?.[1];
// //     actions.push({ type: "event_created", summary: "Calendar event created", resourceId: id });
// //   }
// //   if (/event.*updated|rsvp.*updated|meeting.*rescheduled/i.test(text)) {
// //     actions.push({ type: "event_updated", summary: "Calendar event updated" });
// //   }
// //   return actions;
// // }

// // // ─── processCommand ────────────────────────────────────────────────────────────

// // export async function processCommand(
// //   tenantId: string,
// //   userId: string,
// //   userEmail: string,
// //   input: ChatInput,
// // ): Promise<ChatResponse> {
// //   const startTime = Date.now();
// //   const userMessages: Array<{ role: "user" | "assistant"; content: string }> = [
// //     ...input.conversationHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
// //     { role: "user", content: input.prompt },
// //   ];

// //   try {
// //     const intent = await classifyIntent(input.prompt);
// //     logger.info("Intent", { userId, intent });

// //     if (intent === "chat") {
// //       const client = getOpenRouterClient();
// //       const res = await client.chat.completions.create({ model: "nex-agi/nex-n2-pro:free", max_tokens: 1024, messages: [{ role: "system", content: CHAT_SYSTEM }, ...userMessages] });
// //       const reply = res.choices[0]?.message?.content ?? "How can I help?";
// //       return { reply, actions: [], durationMs: Date.now() - startTime, model: "nex-agi/nex-n2-pro:free", routedTo: "chat" };
// //     }

// //     const corsairTenantId = getTenantId(tenantId);
// //     const agentResult = await runAgent(corsairTenantId, userEmail, userMessages);
// //     const actions = extractActions(agentResult.reply);
// //     const durationMs = Date.now() - startTime;

// //     void db.insert(agentLogs).values({ userId, prompt: input.prompt, response: agentResult.reply, actions, durationMs: String(durationMs) }).catch((err: any) => logger.warn("agentLog insert failed", { error: String(err) }));

// //     logger.info("Agent done", { userId, provider: agentResult.provider, durationMs });
// //     return { reply: agentResult.reply, actions, durationMs, model: agentResult.model, routedTo: "agent" };
// //   } catch (err) {
// //     logger.error("processCommand failed", { userId, error: String(err) });
// //     throw createExternalApiError("LLM Agent", err);
// //   }
// // }

// // // ─── streamCommand ─────────────────────────────────────────────────────────────

// // export async function* streamCommand(
// //   tenantId: string,
// //   userId: string,
// //   userEmail: string,
// //   input: ChatInput,
// // ): AsyncGenerator<string> {
// //   const userMessages: Array<{ role: "user" | "assistant"; content: string }> = [
// //     ...input.conversationHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
// //     { role: "user", content: input.prompt },
// //   ];

// //   try {
// //     const intent = await classifyIntent(input.prompt);
// //     const client = getOpenRouterClient();

// //     if (intent === "chat") {
// //       const stream = await client.chat.completions.create({ model: "nex-agi/nex-n2-pro:free", max_tokens: 1024, stream: true, messages: [{ role: "system", content: CHAT_SYSTEM }, ...userMessages] });
// //       for await (const chunk of stream) {
// //         const delta = chunk.choices[0]?.delta?.content;
// //         if (delta) yield delta;
// //       }
// //       return;
// //     }

// //     const provider = getAgentProvider();
// //     const corsairTenantId = getTenantId(tenantId);

// //     if (provider === "anthropic") {
// //       const apiKey = env.LLM_PROVIDER_AGENT_KEY ?? env.ANTHROPIC_API_KEY;
// //       if (!apiKey) throw new Error("No Anthropic API key");
// //       const anthClient = new Anthropic({ apiKey });
// //       const tenantCorsair = corsair.withTenant(corsairTenantId);
// //       const tools = getMcpProvider().build({ corsair: tenantCorsair });

// //       const stream = anthClient.messages.stream({ model: "claude-haiku-4-5", max_tokens: 2048, system: buildAgentSystemPrompt(userEmail), tools, messages: userMessages as Anthropic.MessageParam[] });
// //       for await (const chunk of stream) {
// //         if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
// //           yield chunk.delta.text;
// //         }
// //       }
// //     } else if (provider === "nex") {
// //       // nex: run full tool loop (SSE emitters fire during it), then stream final reply
// //       const agentResult = await runNexAgent(corsairTenantId, userEmail, userMessages);
// //       for (let i = 0; i < agentResult.length; i += 50) {
// //         yield agentResult.slice(i, i + 50);
// //         await new Promise((r) => setTimeout(r, 8));
// //       }
// //     } else {
// //       const agentResult = await runAgent(corsairTenantId, userEmail, userMessages);
// //       yield agentResult.reply;
// //     }
// //   } catch (err) {
// //     logger.error("streamCommand failed", { userId, error: String(err) });
// //     yield `\n\n[Error: ${err instanceof Error ? err.message : "Something went wrong"}]`;
// //   }
// // }


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
    return "agent";
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

  return summary.choices[0]?.message?.content ?? "Task completed.";
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