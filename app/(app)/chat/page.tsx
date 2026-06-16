// "use client";

// import { useState, useRef, useEffect } from "react";
// import { nanoid } from "nanoid";
// import type { ChatMessage, AgentAction } from "@/src/types";

// const EXAMPLE_PROMPTS = [
//   "What emails did I get today?",
//   "Schedule a standup tomorrow at 9am with my team",
//   "Reply to the last email from Alice",
//   "What meetings do I have this week?",
// ];

// function ActionCard({ action }: { action: AgentAction }) {
//   const icons: Record<string, string> = {
//     email_sent: "✉️",
//     event_created: "📅",
//     event_updated: "🔄",
//   };

//   return (
//     <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-xs text-accent">
//       <span>{icons[action.type] ?? "✓"}</span>
//       <span>{action.summary}</span>
//     </div>
//   );
// }

// function MessageBubble({ message }: { message: ChatMessage & { isStreaming?: boolean } }) {
//   const isUser = message.role === "user";

//   return (
//     <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
//       {!isUser && (
//         <div className="w-7 h-7 rounded-lg bg-accent/20 flex items-center justify-center shrink-0 mt-0.5">
//           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
//             <path d="M12 2a10 10 0 110 20A10 10 0 0112 2z" />
//             <path d="M12 6v6l4 2" strokeLinecap="round" />
//           </svg>
//         </div>
//       )}

//       <div className={`max-w-[80%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-2`}>
//         <div
//           className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
//             isUser
//               ? "bg-accent text-white rounded-br-sm"
//               : "bg-surface-2 text-text-primary rounded-bl-sm"
//           }`}
//         >
//           {message.content}
//           {message.isStreaming && (
//             <span className="inline-flex gap-0.5 ml-1.5 align-middle">
//               {[0, 1, 2].map((i) => (
//                 <span
//                   key={i}
//                   className="w-1 h-1 rounded-full bg-current opacity-60 animate-bounce"
//                   style={{ animationDelay: `${i * 150}ms` }}
//                 />
//               ))}
//             </span>
//           )}
//         </div>

//         {/* Action cards */}
//         {message.actions && message.actions.length > 0 && (
//           <div className="flex flex-wrap gap-2">
//             {message.actions.map((action, i) => (
//               <ActionCard key={i} action={action} />
//             ))}
//           </div>
//         )}
//       </div>
//     </div>
//   );
// }

// export default function ChatPage() {
//   const [messages, setMessages] = useState<(ChatMessage & { isStreaming?: boolean })[]>([]);
//   const [input, setInput] = useState("");
//   const [isLoading, setIsLoading] = useState(false);
//   const messagesEndRef = useRef<HTMLDivElement>(null);
//   const inputRef = useRef<HTMLTextAreaElement>(null);

// type Activity = {
//   id: string;
//   level: "info" | "success" | "error";
//   message: string;
//   timestamp: number;
// };

// const [activities, setActivities] = useState<Activity[]>([]);

//   useEffect(() => {
//     messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
//   }, [messages, activities]);

//   useEffect(() => {
//     const es = new EventSource("/api/events/stream");

//     es.addEventListener("agent_status", (event) => {
//       const data = JSON.parse(event.data);

//       setActivities((prev) => [
//         ...prev,
//         {
//           id: crypto.randomUUID(),
//           level: data.level ?? "info",
//           message: data.message,
//           timestamp: Date.now(),
//         },
//       ]);
//     });

//     return () => es.close();
//   }, []);

//   async function sendMessage() {
//     const prompt = input.trim();
//     if (!prompt || isLoading) return;
//     setActivities([]);

//     const userMsg: ChatMessage = {
//       id: nanoid(),
//       role: "user",
//       content: prompt,
//       createdAt: new Date(),
//     };

//     const assistantMsgId = nanoid();
//     const assistantMsg: ChatMessage & { isStreaming: boolean } = {
//       id: assistantMsgId,
//       role: "assistant",
//       content: "",
//       actions: [],
//       createdAt: new Date(),
//       isStreaming: true,
//     };

//     setMessages((prev) => [...prev, userMsg, assistantMsg]);
//     setInput("");
//     setIsLoading(true);

//     // Build conversation history for context
//     const history = messages.slice(-10).map((m) => ({
//       role: m.role,
//       content: m.content,
//     }));

//     try {
//       const response = await fetch("/api/chat", {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ prompt, conversationHistory: history }),
//       });

//       if (!response.ok || !response.body) {
//         throw new Error("Request failed");
//       }

//       // Parse SSE stream
//       const reader = response.body.getReader();
//       const decoder = new TextDecoder();
//       let fullText = "";

//       while (true) {
//         const { done, value } = await reader.read();
//         if (done) break;

//         const chunk = decoder.decode(value, { stream: true });
//         const lines = chunk.split("\n");

//         for (const line of lines) {
//           if (!line.startsWith("data: ")) continue;
//           try {
//             const event = JSON.parse(line.slice(6));

//             if (event.type === "text") {
//               fullText += event.content;
//               setMessages((prev) =>
//                 prev.map((m) =>
//                   m.id === assistantMsgId
//                     ? { ...m, content: fullText }
//                     : m,
//                 ),
//               );
//             }

//             if (event.type === "done") {
//               setMessages((prev) =>
//                 prev.map((m) =>
//                   m.id === assistantMsgId
//                     ? { ...m, isStreaming: false }
//                     : m,
//                 ),
//               );
//             }

//             if (event.type === "error") {
//               throw new Error(event.message);
//             }
//           } catch {}
//         }
//       }
//     } catch (err) {
//       const errMsg = err instanceof Error ? err.message : "Something went wrong. Try again.";
//       setMessages((prev) =>
//         prev.map((m) =>
//           m.id === assistantMsgId
//             ? { ...m, content: errMsg, isStreaming: false }
//             : m,
//         ),
//       );
//     } finally {
//       setIsLoading(false);
//     }
//   }

//   function handleKeyDown(e: React.KeyboardEvent) {
//     if (e.key === "Enter" && !e.shiftKey) {
//       e.preventDefault();
//       sendMessage();
//     }
//   }

//   // Auto-resize textarea
//   function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
//     setInput(e.target.value);
//     e.target.style.height = "auto";
//     e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
//   }

// function getActivityIcon(
//   level: "info" | "success" | "error"
// ) {
//   switch (level) {
//     case "success":
//       return "✅";

//     case "error":
//       return "❌";

//     default:
//       return "🤖";
//   }
// }

//   return (
//     <div className="flex flex-col h-full ">
//       {/* Header */}
//       <div className="px-4 py-3 border-b border-border shrink-0">
//         <h1 className="text-sm font-semibold text-text-primary">AI Assistant</h1>
//         <p className="text-xs text-text-tertiary mt-0.5">
//           Powered by Claude + Corsair — can send emails and manage your calendar
//         </p>
//       </div>

//       {/* Messages */}
//       <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
//         {messages.length === 0 && (
//           <div className="flex flex-col items-center justify-center h-full text-center px-4">
//             <div className="w-12 h-12 rounded-2xl bg-accent/20 flex items-center justify-center mb-4">
//               <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
//                 <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
//               </svg>
//             </div>
//             <h2 className="text-base font-semibold text-text-primary mb-1">
//               What can I help with?
//             </h2>
//             <p className="text-sm text-text-secondary mb-6 max-w-sm">
//               I can send emails, schedule meetings, search your inbox, and more.
//             </p>
//             <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
//               {EXAMPLE_PROMPTS.map((prompt) => (
//                 <button
//                   key={prompt}
//                   onClick={() => { setInput(prompt); inputRef.current?.focus(); }}
//                   className="px-3 py-2 rounded-xl bg-surface-1 border border-border text-xs text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors text-left"
//                 >
//                   {prompt}
//                 </button>
//               ))}
//             </div>
//           </div>
//         )}

//                 {activities.length > 0 && (
//                   <div className="mb-6 rounded-xl border border-border bg-surface-1 p-4 ">
//                     <div className="text-xs font-semibold text-text-secondary mb-3">
//                       Agent Activity
//                     </div>

//                     <div className="space-y-2">
//                       {activities.map((activity) => (
//                         <div
//                           key={activity.id}
//                           className="flex items-center gap-2 text-sm"
//                         >
//                           <span>
//                             {getActivityIcon(activity.level)}
//                           </span>

//                           <span>
//                             {activity.message}
//                           </span>
//                         </div>
//                       ))}
//                     </div>
//                   </div>
//                 )}

//         {messages.map((message) => (
//           <MessageBubble key={message.id} message={message} />
//         ))}

        
//         <div ref={messagesEndRef} />

//       </div>

//       {/* Input */}
//       <div className="px-4 pb-4 pt-2 border-t border-border shrink-0">
//         <div className="flex items-end gap-2 bg-surface-1 border border-border rounded-2xl px-4 py-2 focus-within:border-accent/40 transition-colors">
//           <textarea
//             ref={inputRef}
//             value={input}
//             onChange={handleInput}
//             onKeyDown={handleKeyDown}
//             placeholder="Message your assistant..."
//             rows={1}
//             disabled={isLoading}
//             className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none resize-none max-h-[120px] py-1"
//             style={{ minHeight: "24px" }}
//           />
//           <button
//             onClick={sendMessage}
//             disabled={!input.trim() || isLoading}
//             className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-hover transition-colors"
//           >
//             {isLoading ? (
//               <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none">
//                 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
//                 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
//               </svg>
//             ) : (
//               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
//                 <line x1="22" y1="2" x2="11" y2="13" />
//                 <polygon points="22,2 15,22 11,13 2,9 22,2" />
//               </svg>
//             )}
//           </button>
//         </div>
//         <p className="text-xs text-text-tertiary mt-1.5 text-center">
//           Enter to send · Shift+Enter for new line
//         </p>
//       </div>
//     </div>
//   );
// }

"use client";

// app/(app)/chat/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// SSE EVENT SHAPES THIS PAGE HANDLES (from agent-service.ts runNexAgent):
//
// 1. { level:"info",    message:"Understanding request..." }
// 2. { level:"info",    message:"Searching available tools..." }
// 3. { level:"info",    message:"Executing <toolName>...",           toolName, toolStatus:"pending",  toolArgs }
// 4. { level:"success", message:"<toolName> completed successfully",  toolName, toolStatus:"success", toolArgs, toolResult }
// 5. { level:"error",   message:"Failed to execute <toolName>",       toolName, toolStatus:"error",   toolArgs, toolResult }
// 6. { level:"info",    message:"Generating response..." }
//
// STEP RENDERING LOGIC:
//   events without toolName  → plain timeline step (info/success/error dot)
//   events with toolName + toolStatus:"pending"  → new ToolCard (pulsing)
//   events with toolName + toolStatus:"success"  → update matching ToolCard (green)
//   events with toolName + toolStatus:"error"    → update matching ToolCard (red)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect, useCallback } from "react";
import { nanoid } from "nanoid";
import type { ChatMessage } from "@/src/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type StepStatus = "pending" | "success" | "error" | "info";

// One row in the agent activity timeline
interface Step {
  id: string;
  // plain step (no tool) OR tool step (has toolName)
  kind: "plain" | "tool";
  message: string;           // raw message from SSE
  label: string;             // human-readable label shown in UI
  desc: string;              // sub-description shown below label
  status: StepStatus;
  timestamp: number;
  // only for tool steps
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
}

interface AgentAction {
  type: string;
  summary: string;
  resourceId?: string;
}

interface ExtendedMsg extends ChatMessage {
  isStreaming?: boolean;
  steps?: Step[];
  actions?: AgentAction[];
}

// Shape of data field in every SSE agent_status event
interface SSEData {
  level?: "info" | "success" | "error";
  message: string;
  toolName?: string;
  toolStatus?: "pending" | "success" | "error";
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
}

// ─── Tool label + description maps ───────────────────────────────────────────

const TOOL_LABEL: Record<string, string> = {
  gmail_messages_send:       "Sending email",
  gmail_messages_list:       "Searching inbox",
  gmail_messages_get:        "Reading message",
  gmail_messages_modify:     "Updating labels",
  gmail_messages_trash:      "Moving to trash",
  gmail_messages_untrash:    "Restoring from trash",
  gmail_messages_batch_modify:"Bulk updating messages",
  gmail_threads_list:        "Listing threads",
  gmail_threads_get:         "Reading thread",
  gmail_threads_modify:      "Updating thread",
  gmail_threads_trash:       "Trashing thread",
  gmail_drafts_create:       "Creating draft",
  gmail_drafts_list:         "Listing drafts",
  gmail_drafts_send:         "Sending draft",
  gmail_drafts_delete:       "Deleting draft",
  gmail_labels_list:         "Fetching labels",
  gmail_labels_create:       "Creating label",
  gmail_db_messages_search:  "Searching local cache",
  gmail_db_threads_search:   "Searching threads cache",
  gmail_db_drafts_search:    "Searching drafts cache",
  gmail_db_labels_search:    "Searching labels cache",
  calendar_events_list:      "Fetching calendar events",
  calendar_events_get:       "Reading event",
  calendar_events_create:    "Creating calendar event",
  calendar_events_update:    "Updating event",
  calendar_events_delete:    "Deleting event",
  calendar_get_availability: "Checking availability",
  calendar_db_events_search: "Searching events cache",
  calendar_db_calendars_search:"Searching calendars cache",
};

const TOOL_DESC: Record<string, string> = {
  gmail_messages_send:       "Using Gmail API to send the message...",
  gmail_messages_list:       "Querying Gmail inbox...",
  gmail_messages_get:        "Fetching full message body...",
  gmail_messages_modify:     "Applying label changes...",
  gmail_messages_trash:      "Moving message to trash...",
  gmail_messages_batch_modify:"Applying bulk label operation...",
  gmail_db_messages_search:  "Querying local Gmail cache...",
  gmail_db_threads_search:   "Querying local threads cache...",
  gmail_db_labels_search:    "Querying local labels cache...",
  calendar_events_list:      "Fetching events from Calendar API...",
  calendar_events_create:    "Creating event via Calendar API...",
  calendar_events_update:    "Patching event via Calendar API...",
  calendar_events_delete:    "Deleting event via Calendar API...",
  calendar_get_availability: "Checking free/busy slots...",
  calendar_db_events_search: "Querying local events cache...",
};

// Plain-message label overrides
const PLAIN_LABEL: Record<string, { label: string; desc: string }> = {
  "Understanding request...":    { label: "Understanding request",   desc: "Analysing what you want to do..." },
  "Searching available tools...":{ label: "Planning",                desc: "Selecting the right tools for the task..." },
  "Generating response...":      { label: "Generating response",     desc: "Writing a reply based on the result..." },
};

function resolveStep(data: SSEData): Omit<Step, "id" | "timestamp"> {
  if (data.toolName) {
    return {
      kind: "tool",
      message: data.message,
      label: TOOL_LABEL[data.toolName] ?? data.toolName,
      desc: TOOL_DESC[data.toolName] ?? data.message,
      status: (data.toolStatus as StepStatus) ?? "pending",
      toolName: data.toolName,
      toolArgs: data.toolArgs,
      toolResult: data.toolResult,
    };
  }
  const override = PLAIN_LABEL[data.message];
  return {
    kind: "plain",
    message: data.message,
    label: override?.label ?? data.message,
    desc: override?.desc ?? "",
    status: (data.level as StepStatus) ?? "info",
  };
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

const Ico = {
  Check: () => (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path d="M1.5 5.5L4 8L9.5 2.5" stroke="#22c55e" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  X: () => (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 2L8 8M8 2L2 8" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  Close: () => (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  ChevRight: ({ open }: { open: boolean }) => (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
      style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>
      <path d="M3 2L7 5L3 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  ChevDown: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2 4.5L6 8L10 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Send: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M12.5 1.5L7 7" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M12.5 1.5L8.5 12.5L7 7L1.5 5.5L12.5 1.5Z" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Attach: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M11.5 6.5L6.5 11.5C5.4 12.6 3.6 12.6 2.5 11.5C1.4 10.4 1.4 8.6 2.5 7.5L7.5 2.5C8.2 1.8 9.3 1.8 10 2.5C10.7 3.2 10.7 4.3 10 5L5 10C4.7 10.3 4.2 10.3 3.9 10C3.6 9.7 3.6 9.2 3.9 8.9L8.5 4.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
  Copy: () => (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <rect x="3.5" y="3.5" width="8" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.1"/>
      <path d="M1.5 9.5V2C1.5 1.7 1.7 1.5 2 1.5H9.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  ),
  ThumbUp: () => (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M4.5 12V7L6.5 1.5H7.5C8.1 1.5 8.5 2 8.5 2.5V5.5H11C11.6 5.5 12 6 11.8 6.6L10.5 10.8C10.3 11.5 9.8 12 9.2 12H4.5Z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4.5 12H2V7H4.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  ThumbDown: () => (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M8.5 1V6L6.5 11.5H5.5C4.9 11.5 4.5 11 4.5 10.5V7.5H2C1.4 7.5 1 7 1.2 6.4L2.5 2.2C2.7 1.5 3.2 1 3.8 1H8.5Z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M8.5 1H11V6H8.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Refresh: () => (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2 6.5A4.5 4.5 0 009.5 10.5L11 9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      <path d="M11 6.5A4.5 4.5 0 003.5 2.5L2 4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      <path d="M2 1.5V4.5H5M11 11.5V8.5H8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Mail: ({ c = "currentColor" }: { c?: string }) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2.5" width="12" height="9" rx="1.5" stroke={c} strokeWidth="1.2"/>
      <path d="M1 4.5L7 8.5L13 4.5" stroke={c} strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
  Cal: ({ c = "currentColor" }: { c?: string }) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="12" height="11" rx="1.5" stroke={c} strokeWidth="1.2"/>
      <path d="M1 5.5H13" stroke={c} strokeWidth="1.2"/>
      <path d="M4.5 1V3M9.5 1V3" stroke={c} strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
  Search: ({ c = "currentColor" }: { c?: string }) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="6" cy="6" r="4.5" stroke={c} strokeWidth="1.2"/>
      <path d="M10 10L13 13" stroke={c} strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
  User: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  AI: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M4.5 7L6.5 9L9.5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  // Step icons
  StepQ: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.1"/>
      <path d="M4.5 5C4.5 4.2 5.2 3.5 6 3.5C6.8 3.5 7.5 4.2 7.5 5C7.5 5.8 6 6.5 6 7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      <circle cx="6" cy="8.5" r="0.5" fill="currentColor"/>
    </svg>
  ),
  StepSearch: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.1"/>
      <path d="M8 8L11 11" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  ),
  StepPlan: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1" y="2" width="10" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.1"/>
      <path d="M3 5h6M3 7h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  ),
  StepSend: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M11 1L5.5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M11 1L7.5 11L5.5 6.5L1 4.5L11 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  StepGen: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 1.5v2M6 8.5v2M1.5 6h2M8.5 6h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.1"/>
    </svg>
  ),
  StepTool: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M8.5 1.5L10.5 3.5L4 10L1.5 10.5L2 8L8.5 1.5Z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  // Topbar icons
  History: () => (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M7.5 4V8L10 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  Share: () => (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M10 1.5L13.5 5L10 8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M1.5 13.5V10C1.5 7.5 3.5 5 6.5 5H13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  Dots: () => (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="3.5" cy="7.5" r="1.2" fill="currentColor"/>
      <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor"/>
      <circle cx="11.5" cy="7.5" r="1.2" fill="currentColor"/>
    </svg>
  ),
  // Meta panel
  GmailColor: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="4" width="20" height="16" rx="2" stroke="#EA4335" strokeWidth="1.5"/>
      <path d="M2 6L12 13L22 6" stroke="#EA4335" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  CalColor: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="12" height="11" rx="1.5" stroke="#4285F4" strokeWidth="1.2"/>
      <path d="M1 5.5H13" stroke="#4285F4" strokeWidth="1.2"/>
      <path d="M4.5 1V3M9.5 1V3" stroke="#4285F4" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
  CalSmall: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="0.8" y="1.8" width="10.4" height="9.4" rx="1.2" stroke="currentColor" strokeWidth="1"/>
      <path d="M0.8 4.8H11.2" stroke="currentColor" strokeWidth="1"/>
      <path d="M3.8 1V2.6M8.2 1V2.6" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  ),
};

// ─── Step icon resolver ───────────────────────────────────────────────────────

function stepIcon(s: Step) {
  if (s.kind === "tool") return <Ico.StepTool />;
  const m = s.message;
  if (m.includes("Understanding")) return <Ico.StepQ />;
  if (m.includes("Searching available")) return <Ico.StepPlan />;
  if (m.includes("Generating")) return <Ico.StepGen />;
  return <Ico.StepSearch />;
}

// ─── Step node (dot/circle on the left of each row) ──────────────────────────

function StepDot({ s }: { s: Step }) {
  if (s.status === "success") {
    return (
      <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
        style={{ background: "rgba(34,197,94,0.14)" }}>
        <Ico.Check />
      </span>
    );
  }
  if (s.status === "error") {
    return (
      <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
        style={{ background: "rgba(239,68,68,0.14)" }}>
        <Ico.X />
      </span>
    );
  }
  if (s.status === "pending") {
    return (
      <span className="flex-shrink-0 w-5 h-5 rounded-full border flex items-center justify-center"
        style={{ borderColor: "#e75b85" }}>
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#e75b85" }}/>
      </span>
    );
  }
  // info / plain
  return (
    <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
      style={{ background: "rgba(255,255,255,0.07)", color: "#888" }}>
      {stepIcon(s)}
    </span>
  );
}

// ─── Tool detail card (expanded inline under tool step) ───────────────────────
// Shown for tool steps. Displays args preview + result summary.

function ToolCard({ s }: { s: Step }) {
  // Build rows from toolArgs + toolResult
  const rows: [string, string][] = [];
  const args = s.toolArgs ?? {};
  const res  = (s.toolResult ?? {}) as Record<string, unknown>;

  // Common arg fields
  if (args.to)            rows.push(["To",      String(args.to)]);
  if (args.subject)       rows.push(["Subject", String(args.subject)]);
  if (args.summary)       rows.push(["Title",   String(args.summary)]);
  if (args.startDateTime) rows.push(["Start",   String(args.startDateTime)]);
  if (args.endDateTime)   rows.push(["End",     String(args.endDateTime)]);
  if (args.q)             rows.push(["Query",   String(args.q)]);
  if (args.from)          rows.push(["From",    String(args.from)]);

  // Result fields
  if (s.status === "success") {
    const label = s.toolName?.startsWith("calendar") ? "Event created" : "Completed";
    rows.push(["Status", label]);
    if (res.id) rows.push([s.toolName?.startsWith("calendar") ? "Event ID" : "Message ID", String(res.id)]);
    if (res.threadId) rows.push(["Thread ID", String(res.threadId)]);
  }
  if (s.status === "error") {
    const errMsg = (res.error as string) ?? "Unknown error";
    rows.push(["Error", errMsg.slice(0, 80)]);
  }

  return (
    <div className="mt-2.5 rounded-xl overflow-hidden text-xs"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>

      {/* header row */}
      <div className="flex items-center justify-between px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span style={{ color: "#777" }}>Tool call</span>
          <code style={{ color: "#f0f0f0", fontWeight: 600 }}>{s.toolName}</code>
        </div>
        {s.status === "pending" && (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium animate-pulse"
            style={{ background: "rgba(231,91,133,.15)", color: "#e75b85" }}>Running</span>
        )}
        {s.status === "success" && (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium"
            style={{ background: "rgba(34,197,94,.12)", color: "#22c55e" }}>Success</span>
        )}
        {s.status === "error" && (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium"
            style={{ background: "rgba(239,68,68,.12)", color: "#ef4444" }}>Failed</span>
        )}
      </div>

      {/* data rows */}
      {rows.length > 0 && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {rows.map(([k, v]) => (
            <div key={k} className="px-3.5 py-1.5 grid gap-2"
              style={{ gridTemplateColumns: "90px 1fr", borderBottom: "1px solid rgba(255,255,255,.04)" }}>
              <span style={{ color: "#777" }}>{k}</span>
              <span className="truncate" style={{ color: "#f0f0f0" }}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Agent Activity Timeline ──────────────────────────────────────────────────

function AgentActivity({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(true);
  if (!steps.length) return null;

  return (
    <div className="mt-3">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 mb-3 select-none"
        style={{ color: "#777", fontSize: "12px" }}>
        <Ico.ChevRight open={open} />
        Agent activity
      </button>

      {open && (
        <div className="relative" style={{ marginLeft: "2px" }}>
          {/* vertical connector */}
          <div className="absolute top-0 bottom-0 w-px"
            style={{ left: "9px", background: "rgba(255,255,255,.1)" }}/>

          <div className="space-y-3">
            {steps.map(s => (
              <div key={s.id} className="flex items-start gap-3 relative">
                <div className="z-10 mt-0.5 shrink-0">
                  <StepDot s={s} />
                </div>
                <div className="flex-1 min-w-0">
                  {/* label + timestamp */}
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-medium" style={{ color: "#f0f0f0" }}>
                      {s.label}
                    </span>
                    <span className="shrink-0 tabular-nums" style={{ fontSize: "11px", color: "#777" }}>
                      {fmtTime(new Date(s.timestamp))}
                    </span>
                  </div>
                  {/* sub-description */}
                  {s.desc && (
                    <p className="mt-0.5" style={{ fontSize: "11px", color: "#777", lineHeight: 1.5 }}>
                      {s.desc}
                    </p>
                  )}
                  {/* tool card — only for tool steps */}
                  {s.kind === "tool" && <ToolCard s={s} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Meta sidebar ─────────────────────────────────────────────────────────────
// Shows details of the last completed tool action.

interface MetaData {
  toolName: string;
  status: "success" | "error";
  timestamp: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
}

function MetaPanel({ meta, onClose }: { meta: MetaData; onClose: () => void }) {
  const isGmail = meta.toolName.startsWith("gmail_");
  const isCalendar = meta.toolName.startsWith("calendar_");
  const r = (meta.toolResult ?? {}) as Record<string, unknown>;
  const a = meta.toolArgs ?? {};

  const detailRows: [string, string][] = [];
  if (a.to)      detailRows.push(["To",      String(a.to)]);
  if (a.subject) detailRows.push(["Subject", String(a.subject)]);
  if (a.summary) detailRows.push(["Title",   String(a.summary)]);
  if (a.startDateTime) detailRows.push(["Start", String(a.startDateTime)]);
  if (a.endDateTime)   detailRows.push(["End",   String(a.endDateTime)]);
  if (r.id)      detailRows.push([isCalendar ? "Event ID" : "Message ID", String(r.id)]);
  if (r.threadId) detailRows.push(["Thread ID", String(r.threadId)]);
  if (isGmail)   detailRows.push(["Provider", "Gmail"]);
  detailRows.push(["Status", meta.status === "success" ? (isCalendar ? "Created" : "Sent") : "Failed"]);

  // Email preview fields
  const previewFields: Array<{ label: string; value: string }> = [];
  if (a.to)      previewFields.push({ label: "To:",      value: String(a.to) });
  if (a.subject) previewFields.push({ label: "Subject:", value: String(a.subject) });
  if (a.body)    previewFields.push({ label: "Body",     value: String(a.body).slice(0, 300) });
  if (a.summary) previewFields.push({ label: "Title:",   value: String(a.summary) });

  return (
    <div className="w-[300px] shrink-0 flex flex-col h-full"
      style={{ borderLeft: "1px solid rgba(255,255,255,.08)", background: "#191919" }}>

      {/* header */}
      <div className="flex items-center justify-between px-5 py-4 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,.08)" }}>
        <span className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>Last action</span>
        <button onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-lg"
          style={{ color: "#777" }}>
          <Ico.Close />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* tool name + status badge */}
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "rgba(231,91,133,.15)" }}>
              {isGmail ? <Ico.GmailColor /> : isCalendar ? <Ico.CalColor /> : <Ico.StepTool />}
            </div>
            <span className="text-sm font-mono font-semibold" style={{ color: "#f0f0f0" }}>
              {meta.toolName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-semibold"
              style={{
                fontSize: "11px",
                background: meta.status === "success" ? "rgba(34,197,94,.1)" : "rgba(239,68,68,.1)",
                color: meta.status === "success" ? "#22c55e" : "#ef4444",
              }}>
              <span className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ background: meta.status === "success" ? "#22c55e" : "#ef4444" }}/>
              {meta.status === "success" ? "Success" : "Failed"}
            </span>
            <span style={{ fontSize: "11px", color: "#777" }}>{meta.timestamp}</span>
          </div>
        </div>

        {/* detail rows */}
        {detailRows.length > 0 && (
          <div>
            <p className="text-xs font-semibold mb-3" style={{ color: "#f0f0f0" }}>Details</p>
            <div className="space-y-2.5">
              {detailRows.map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-3">
                  <span className="text-xs shrink-0" style={{ color: "#777" }}>{k}</span>
                  <span className="text-xs text-right font-medium break-all"
                    style={{ color: "#f0f0f0", maxWidth: "58%" }}>
                    {k === "Provider" ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Ico.GmailColor /> {v}
                      </span>
                    ) : k === "Status" ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full inline-block"
                          style={{ background: meta.status === "success" ? "#22c55e" : "#ef4444" }}/>
                        {v}
                      </span>
                    ) : v}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* email / event preview */}
        {previewFields.length > 0 && (
          <div>
            <p className="text-xs font-semibold mb-3" style={{ color: "#f0f0f0" }}>
              {isGmail ? "Email preview" : "Event preview"}
            </p>
            <div className="rounded-xl p-3.5 space-y-2"
              style={{ border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.025)" }}>
              {previewFields.map(({ label, value }) => (
                <div key={label}>
                  {label === "Body" ? (
                    <p className="text-xs leading-relaxed whitespace-pre-line" style={{ color: "#bbb" }}>{value}</p>
                  ) : (
                    <div className="flex gap-2">
                      <span className="text-xs w-16 shrink-0" style={{ color: "#777" }}>{label}</span>
                      <span className="text-xs" style={{ color: "#f0f0f0" }}>{value}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="px-5 py-3 shrink-0"
        style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
        <button className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs"
          style={{ border: "1px solid rgba(255,255,255,.1)", color: "#777" }}>
          <Ico.CalSmall /> View full history
        </button>
      </div>
    </div>
  );
}

// ─── Example prompts ──────────────────────────────────────────────────────────

const EXAMPLES = [
  { label: "Send email to Alex", type: "email" },
  { label: "What's on my calendar today?", type: "cal" },
  { label: "Find unread emails", type: "search" },
  { label: "Schedule a meeting with team", type: "cal" },
];

function promptIcon(type: string) {
  const c = "#e75b85";
  if (type === "email")  return <Ico.Mail c={c} />;
  if (type === "cal")    return <Ico.Cal c={c} />;
  if (type === "search") return <Ico.Search c={c} />;
  return <Ico.Mail c={c} />;
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function Empty({ onPrompt }: { onPrompt: (p: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center select-none">
      <div className="w-[72px] h-[72px] rounded-2xl flex items-center justify-center mb-7"
        style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)" }}>
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
          <path d="M26 20.5A2.5 2.5 0 0123.5 23H8.5L3 28.5V6A2.5 2.5 0 015.5 3.5H23.5A2.5 2.5 0 0126 6V20.5Z"
            stroke="#e75b85" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="10.5" cy="13" r="1.1" fill="#e75b85"/>
          <circle cx="15"   cy="13" r="1.1" fill="#e75b85"/>
          <circle cx="19.5" cy="13" r="1.1" fill="#e75b85"/>
        </svg>
      </div>
      <h2 className="text-base font-semibold mb-1.5" style={{ color: "#f0f0f0" }}>Start a conversation</h2>
      <p className="text-sm mb-7 max-w-xs leading-relaxed" style={{ color: "#777" }}>
        Ask me to send emails, check your calendar,<br/>search messages, and more.
      </p>
      <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
        {EXAMPLES.map(({ label, type }) => (
          <button key={label} onClick={() => onPrompt(label)}
            className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-sm text-left"
            style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", color: "#777" }}>
            {promptIcon(type)}
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Message components ───────────────────────────────────────────────────────

function UserMsg({ m }: { m: ExtendedMsg }) {
  return (
    <div className="flex items-start gap-3 px-6 py-4">
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", color: "#777" }}>
        <Ico.User />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-relaxed" style={{ color: "#f0f0f0" }}>{m.content}</p>
      </div>
      <span className="shrink-0 mt-1 tabular-nums" style={{ fontSize: "11px", color: "#777" }}>
        {fmtTime(new Date(m.createdAt))}
      </span>
    </div>
  );
}

function AIMsg({ m }: { m: ExtendedMsg }) {
  return (
    <div className="flex items-start gap-3 px-6 py-4">
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: "rgba(231,91,133,.15)", border: "1px solid rgba(231,91,133,.25)", color: "#e75b85" }}>
        <Ico.AI />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold" style={{ color: "#f0f0f0" }}>Superhuman AI</span>
          <span className="tabular-nums" style={{ fontSize: "11px", color: "#777" }}>
            {fmtTime(new Date(m.createdAt))}
          </span>
        </div>

        {/* streaming dots when no content yet */}
        {m.isStreaming && !m.content && !(m.steps?.length) && (
          <div className="flex gap-0.5 mt-1">
            {[0,1,2].map(i => (
              <span key={i} className="w-1 h-1 rounded-full animate-bounce"
                style={{ background: "#777", animationDelay: `${i*150}ms` }}/>
            ))}
          </div>
        )}

        {/* agent activity (steps) */}
        {m.steps && m.steps.length > 0 && (
          <AgentActivity steps={m.steps} />
        )}

        {/* final text */}
        {m.content && (
          <p className="text-sm leading-relaxed mt-2" style={{ color: "#f0f0f0" }}>
            {m.content}
            {m.isStreaming && (
              <span className="inline-flex gap-0.5 ml-1.5 align-middle">
                {[0,1,2].map(i => (
                  <span key={i} className="w-1 h-1 rounded-full animate-bounce"
                    style={{ background: "#777", animationDelay: `${i*150}ms` }}/>
                ))}
              </span>
            )}
          </p>
        )}

        {/* action pills */}
        {m.actions && m.actions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {m.actions.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs"
                style={{ background: "rgba(231,91,133,.1)", border: "1px solid rgba(231,91,133,.2)", color: "#e75b85" }}>
                {a.type === "email_sent"   && <Ico.Mail c="#e75b85" />}
                {a.type === "event_created" && <Ico.Cal  c="#e75b85" />}
                {a.summary}
              </span>
            ))}
          </div>
        )}

        {/* feedback row (visible on hover) */}
        {!m.isStreaming && m.content && (
          <div className="flex items-center gap-0.5 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
            {[
              { el: <Ico.Copy />,      t: "Copy"      },
              { el: <Ico.ThumbUp />,   t: "Good"      },
              { el: <Ico.ThumbDown />, t: "Bad"       },
              { el: <Ico.Refresh />,   t: "Regenerate"},
            ].map(({ el, t }) => (
              <button key={t} title={t}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                style={{ color: "#777" }}>
                {el}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [messages,  setMessages]  = useState<ExtendedMsg[]>([]);
  const [input,     setInput]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [meta,      setMeta]      = useState<MetaData | null>(null);
  const [sseOk,     setSseOk]     = useState(false);

  const bottomRef    = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLTextAreaElement>(null);
  const currentIdRef = useRef<string | null>(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ─── SSE connection ────────────────────────────────────────────────────────
  // Connects to /api/events/stream which subscribes using getTenantId(session.user.id)
  // = "user_<dbUUID>" — matching what emitToUser(corsairTenantId, ...) fires.
  useEffect(() => {
    let es: EventSource;
    let retry: ReturnType<typeof setTimeout>;

    function connect() {
      es = new EventSource("/api/events/stream");

      es.addEventListener("connected", () => {
        console.log("[SSE] ✅ connected");
        setSseOk(true);
      });

      // ── Handle agent_status events ──────────────────────────────────────
      // Shape: { level?, message, toolName?, toolStatus?, toolArgs?, toolResult? }
      es.addEventListener("agent_status", (ev: MessageEvent) => {
        const data = JSON.parse(ev.data as string) as SSEData;
        console.log("[SSE] agent_status →", data);

        const msgId = currentIdRef.current;
        if (!msgId) return;

        // Resolve this SSE event into a Step
        const resolved = resolveStep(data);

        setMessages(prev => prev.map(m => {
          if (m.id !== msgId) return m;
          const steps = [...(m.steps ?? [])];

          if (data.toolName && data.toolStatus) {
            if (data.toolStatus === "pending") {
              // New tool step — append
              steps.push({ id: nanoid(), timestamp: Date.now(), ...resolved });
            } else {
              // Update the most recent pending step with same toolName
              const idx = [...steps].reverse().findIndex(
                s => s.toolName === data.toolName && s.status === "pending"
              );
              if (idx !== -1) {
                const realIdx = steps.length - 1 - idx;
                steps[realIdx] = {
                  ...steps[realIdx],
                  status:     resolved.status,
                  label:      resolved.label,
                  desc:       resolved.desc,
                  toolResult: data.toolResult,
                };
                // ── Show meta sidebar for completed action tools ────────
                const actionTools = [
                  "gmail_messages_send","calendar_events_create",
                  "calendar_events_update","calendar_events_delete",
                ];
                if (actionTools.includes(data.toolName) && data.toolStatus === "success") {
                  setMeta({
                    toolName:   data.toolName,
                    status:     "success",
                    timestamp:  fmtTime(new Date()),
                    toolArgs:   data.toolArgs,
                    toolResult: data.toolResult,
                  });
                }
                if (data.toolStatus === "error") {
                  setMeta({
                    toolName:   data.toolName,
                    status:     "error",
                    timestamp:  fmtTime(new Date()),
                    toolArgs:   data.toolArgs,
                    toolResult: data.toolResult,
                  });
                }
              } else {
                // No pending found — append as completed step
                steps.push({ id: nanoid(), timestamp: Date.now(), ...resolved });
              }
            }
          } else {
            // Plain step (no toolName)
            steps.push({ id: nanoid(), timestamp: Date.now(), ...resolved });
          }

          return { ...m, steps };
        }));
      });

      es.onerror = () => {
        setSseOk(false);
        es.close();
        retry = setTimeout(connect, 3000);
      };
    }

    connect();
    return () => { es?.close(); clearTimeout(retry); };
  }, []);

  // ─── Send message ──────────────────────────────────────────────────────────

  const send = useCallback(async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || loading) return;

    const uId = nanoid();
    const aId = nanoid();
    currentIdRef.current = aId;

    const userMsg: ExtendedMsg = { id: uId, role: "user",      content: text, createdAt: new Date() };
    const aiMsg:   ExtendedMsg = { id: aId, role: "assistant", content: "",   createdAt: new Date(), isStreaming: true, steps: [], actions: [] };

    setMessages(prev => [...prev, userMsg, aiMsg]);
    setInput("");
    setLoading(true);
    setMeta(null);

    const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, conversationHistory: history }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of dec.decode(value, { stream: true }).split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as { type: string; content?: string };
            if (ev.type === "text") {
              full += ev.content ?? "";
              setMessages(prev => prev.map(m => m.id === aId ? { ...m, content: full } : m));
            }
            if (ev.type === "done") {
              setMessages(prev => prev.map(m => m.id === aId ? { ...m, isStreaming: false } : m));
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setMessages(prev => prev.map(m => m.id === aId ? { ...m, content: msg, isStreaming: false } : m));
    } finally {
      setLoading(false);
      currentIdRef.current = null;
    }
  }, [input, loading, messages]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  }
  function onInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden" style={{ background: "#141414" }}>

      {/* ── Chat column ─────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* topbar */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,.08)" }}>
          <button className="flex items-center gap-1.5 text-sm font-semibold"
            style={{ color: "#f0f0f0" }}>
            New conversation <Ico.ChevDown />
          </button>
          <div className="flex items-center gap-1">
            {/* SSE status dot */}
            <span title={sseOk ? "SSE connected" : "SSE connecting…"}
              className="w-2 h-2 rounded-full mr-2"
              style={{ background: sseOk ? "#22c55e" : "#f59e0b" }}/>
            {[
              { el: <Ico.History />, t: "History" },
              { el: <Ico.Share />,   t: "Share"   },
              { el: <Ico.Dots />,    t: "More"    },
            ].map(({ el, t }) => (
              <button key={t} title={t}
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ color: "#777" }}>
                {el}
              </button>
            ))}
          </div>
        </div>

        {/* messages */}
        <div className="flex-1 overflow-y-auto"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,.08) transparent" }}>
          {messages.length === 0 ? (
            <div className="h-full">
              <Empty onPrompt={p => { setInput(p); inputRef.current?.focus(); void send(p); }} />
            </div>
          ) : (
            <div>
              {messages.map((m, i) => (
                <div key={m.id} className="group"
                  style={{ borderBottom: i < messages.length - 1 ? "1px solid rgba(255,255,255,.05)" : "none" }}>
                  {m.role === "user" ? <UserMsg m={m} /> : <AIMsg m={m} />}
                </div>
              ))}
              <div ref={bottomRef} className="h-4" />
            </div>
          )}
        </div>

        {/* input */}
        <div className="px-5 pb-5 pt-3 shrink-0"
          style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
          <div className="flex items-end gap-2 rounded-2xl px-4 py-3"
            style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)" }}>
            <button className="shrink-0 w-7 h-7 flex items-center justify-center mb-0.5"
              style={{ color: "#777" }}>
              <Ico.Attach />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={onInput}
              onKeyDown={onKey}
              placeholder="Ask anything..."
              rows={1}
              disabled={loading}
              className="flex-1 bg-transparent text-sm outline-none resize-none py-0.5"
              style={{ color: "#f0f0f0", minHeight: "22px", maxHeight: "120px" }}
            />
            <button
              onClick={() => void send()}
              disabled={!input.trim() || loading}
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-40"
              style={{ background: "#e75b85" }}>
              {loading
                ? <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                : <Ico.Send />}
            </button>
          </div>
          <p className="mt-2 text-center" style={{ fontSize: "11px", color: "#777" }}>
            Superhuman AI can make mistakes. Consider checking important info.
          </p>
        </div>
      </div>

      {/* ── Meta sidebar ────────────────────────────────────────────────── */}
      {meta && <MetaPanel meta={meta} onClose={() => setMeta(null)} />}
    </div>
  );
}