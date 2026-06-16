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
//     <div className="flex flex-col h-full">
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
//                   <div className="mb-6 rounded-xl border border-border bg-surface-1 p-4">
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

import { useState, useRef, useEffect, useCallback } from "react";
import { nanoid } from "nanoid";
import type { ChatMessage, AgentAction } from "@/src/types";

// ─── Types ─────────────────────────────────────────────────────────────────────

type ActivityLevel = "info" | "success" | "error" | "tool_call";

interface Activity {
  id: string;
  level: ActivityLevel;
  message: string;
  timestamp: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  toolStatus?: "pending" | "success" | "error";
}

interface LastActionMeta {
  toolName: string;
  status: "success" | "error";
  timestamp: string;
  details?: Record<string, string>;
  preview?: {
    type: "email" | "calendar";
    fields: Array<{ label: string; value: string }>;
  };
  summary?: string;
}

interface ExtendedChatMessage extends ChatMessage {
  isStreaming?: boolean;
  activities?: Activity[];
  meta?: LastActionMeta;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  { icon: "✉️", label: "Send email to Alex" },
  { icon: "📅", label: "What's on my calendar today?" },
  { icon: "🔍", label: "Find unread emails" },
  { icon: "📆", label: "Schedule a meeting with team" },
];

const TOOL_ICON_MAP: Record<string, string> = {
  gmail_messages_send: "✉️",
  gmail_messages_list: "🔍",
  gmail_messages_get: "📩",
  gmail_messages_modify: "🏷️",
  gmail_messages_trash: "🗑️",
  gmail_messages_batch_modify: "📦",
  gmail_threads_list: "🧵",
  gmail_threads_get: "🧵",
  gmail_threads_modify: "🧵",
  gmail_threads_trash: "🗑️",
  gmail_drafts_create: "📝",
  gmail_drafts_list: "📝",
  gmail_drafts_send: "📤",
  gmail_drafts_delete: "🗑️",
  gmail_labels_list: "🏷️",
  gmail_labels_create: "🏷️",
  gmail_db_messages_search: "⚡",
  gmail_db_threads_search: "⚡",
  gmail_db_drafts_search: "⚡",
  gmail_db_labels_search: "⚡",
  calendar_events_list: "📅",
  calendar_events_get: "📅",
  calendar_events_create: "📆",
  calendar_events_update: "🔄",
  calendar_events_delete: "🗑️",
  calendar_get_availability: "🕐",
  calendar_db_events_search: "⚡",
  calendar_db_calendars_search: "⚡",
};

const TOOL_LABEL_MAP: Record<string, string> = {
  gmail_messages_send: "Sending email",
  gmail_messages_list: "Searching inbox",
  gmail_messages_get: "Reading message",
  gmail_messages_modify: "Updating labels",
  gmail_messages_trash: "Moving to trash",
  gmail_messages_batch_modify: "Bulk updating",
  gmail_threads_list: "Listing threads",
  gmail_threads_get: "Reading thread",
  gmail_threads_modify: "Updating thread",
  gmail_threads_trash: "Trashing thread",
  gmail_drafts_create: "Creating draft",
  gmail_drafts_list: "Listing drafts",
  gmail_drafts_send: "Sending draft",
  gmail_drafts_delete: "Deleting draft",
  gmail_labels_list: "Fetching labels",
  gmail_labels_create: "Creating label",
  gmail_db_messages_search: "Searching local cache",
  gmail_db_threads_search: "Searching threads cache",
  gmail_db_drafts_search: "Searching drafts cache",
  gmail_db_labels_search: "Searching labels cache",
  calendar_events_list: "Fetching events",
  calendar_events_get: "Reading event",
  calendar_events_create: "Creating event",
  calendar_events_update: "Updating event",
  calendar_events_delete: "Deleting event",
  calendar_get_availability: "Checking availability",
  calendar_db_events_search: "Searching events cache",
  calendar_db_calendars_search: "Searching calendars cache",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function getStepIcon(level: ActivityLevel, status?: "pending" | "success" | "error") {
  if (status === "success" || level === "success") {
    return (
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 5.5L4 7.5L8 3" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (status === "error" || level === "error") {
    return (
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M3 3L7 7M7 3L3 7" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="flex-shrink-0 w-5 h-5 rounded-full border border-accent/60 flex items-center justify-center">
        <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
      </span>
    );
  }
  // info
  return (
    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-surface-2 flex items-center justify-center">
      <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary" />
    </span>
  );
}

// ─── Tool Call Card ─────────────────────────────────────────────────────────────

function ToolCallCard({ activity }: { activity: Activity }) {
  const [expanded, setExpanded] = useState(false);
  const toolName = activity.toolName ?? "";
  const icon = TOOL_ICON_MAP[toolName] ?? "🔧";
  const label = TOOL_LABEL_MAP[toolName] ?? toolName;
  const isSuccess = activity.toolStatus === "success";
  const isPending = activity.toolStatus === "pending";
  const isError = activity.toolStatus === "error";

  return (
    <div className="ml-7 mt-1 rounded-xl border border-border bg-surface-0 overflow-hidden text-xs">
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-surface-1 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">{icon}</span>
          <span className="font-medium text-text-secondary">Tool call</span>
          <code className="px-1.5 py-0.5 rounded bg-surface-2 text-text-primary font-mono">{toolName}</code>
        </div>
        <div className="flex items-center gap-2">
          {isPending && (
            <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xxs font-medium animate-pulse">Running</span>
          )}
          {isSuccess && (
            <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 text-xxs font-medium">Success</span>
          )}
          {isError && (
            <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 text-xxs font-medium">Failed</span>
          )}
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none"
            className={`text-text-tertiary transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-1.5 bg-surface-0">
          {activity.toolArgs && Object.keys(activity.toolArgs).length > 0 && (
            <div>
              <div className="text-xxs uppercase tracking-wider text-text-tertiary mb-1">Arguments</div>
              {Object.entries(activity.toolArgs).map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <span className="text-text-tertiary w-20 shrink-0">{k}</span>
                  <span className="text-text-primary font-mono truncate">
                    {typeof v === "string" ? v : JSON.stringify(v)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {isSuccess && activity.toolResult != null && (
            <div>
              <div className="text-xxs uppercase tracking-wider text-text-tertiary mb-1 mt-1">Result</div>
              {(() => {
                const r = (activity.toolResult ?? {}) as Record<string, unknown>;
                const fields = [
                  r.id && ["Message ID", String(r.id)],
                  r.threadId && ["Thread ID", String(r.threadId)],
                  r.status && ["Status", String(r.status)],
                  r.to && ["To", String(r.to)],
                  r.subject && ["Subject", String(r.subject)],
                ].filter(Boolean) as string[][];
                if (fields.length > 0) {
                  return fields.map(([k, v]) => (
                    <div key={k} className="flex gap-3">
                      <span className="text-text-tertiary w-20 shrink-0">{k}</span>
                      <span className="text-text-primary font-mono truncate">{v}</span>
                    </div>
                  ));
                }
                return (
                  <div className="text-text-secondary">
                    {typeof r === "string" ? r : "Completed successfully"}
                  </div>
                );
              })()}
            </div>
          )}
          {isError && (
            <div className="text-red-400 text-xxs">{activity.message}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Agent Activity Block ───────────────────────────────────────────────────────

function AgentActivityBlock({ activities }: { activities: Activity[] }) {
  if (!activities.length) return null;
  return (
    <div className="mt-3 ml-10">
      {/* Collapsible trigger row */}
      <details open className="group">
        <summary className="flex items-center gap-1.5 text-xs text-text-tertiary cursor-pointer select-none list-none mb-2 hover:text-text-secondary transition-colors">
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none"
            className="transition-transform group-open:rotate-90"
          >
            <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Agent activity
        </summary>

        <div className="space-y-2 relative">
          {/* Vertical connector line */}
          <div className="absolute left-2.5 top-0 bottom-0 w-px bg-border" />

          {activities.map((a) => (
            <div key={a.id} className="relative">
              <div className="flex items-start gap-3">
                <div className="relative z-10 mt-0.5">
                  {getStepIcon(a.level, a.toolStatus)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`text-xs font-medium ${
                      a.level === "success" ? "text-text-primary" :
                      a.level === "error" ? "text-red-400" :
                      a.toolStatus === "pending" ? "text-text-primary" :
                      "text-text-secondary"
                    }`}>
                      {a.toolName ? (TOOL_LABEL_MAP[a.toolName] ?? a.toolName) : a.message}
                    </span>
                    <span className="text-xxs text-text-tertiary shrink-0">
                      {formatTime(new Date(a.timestamp))}
                    </span>
                  </div>
                  {a.toolName && (
                    <p className="text-xxs text-text-tertiary mt-0.5">{a.message}</p>
                  )}
                  {a.level === "tool_call" && (
                    <ToolCallCard activity={a} />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

// ─── Meta Panel ─────────────────────────────────────────────────────────────────

function MetaPanel({ meta, onClose }: { meta: LastActionMeta; onClose: () => void }) {
  return (
    <div className="w-80 shrink-0 border-l border-border bg-surface-sidebar flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span className="text-sm font-semibold text-text-primary">Last action</span>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-lg hover:bg-surface-2 flex items-center justify-center transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="px-4 py-4 space-y-5 flex-1">
        {/* Tool name + status */}
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="text-base">{TOOL_ICON_MAP[meta.toolName] ?? "🔧"}</span>
            <code className="text-sm font-mono font-semibold text-text-primary">{meta.toolName}</code>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xxs font-medium ${
              meta.status === "success"
                ? "bg-green-500/10 text-green-500"
                : "bg-red-500/10 text-red-500"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${meta.status === "success" ? "bg-green-500" : "bg-red-500"}`} />
              {meta.status === "success" ? "Success" : "Failed"}
            </span>
            <span className="text-xxs text-text-tertiary">{meta.timestamp}</span>
          </div>
        </div>

        {/* Details */}
        {meta.details && Object.keys(meta.details).length > 0 && (
          <div>
            <div className="text-xs font-semibold text-text-secondary mb-2">Details</div>
            <div className="space-y-2">
              {Object.entries(meta.details).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span className="text-xs text-text-tertiary">{k}</span>
                  <span className="text-xs text-text-primary text-right font-medium truncate max-w-[60%]">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Preview (email/calendar) */}
        {meta.preview && (
          <div>
            <div className="text-xs font-semibold text-text-secondary mb-2">
              {meta.preview.type === "email" ? "Email preview" : "Event preview"}
            </div>
            <div className="rounded-xl bg-surface-1 border border-border p-3 space-y-2">
              {meta.preview.fields.map(({ label, value }) => (
                <div key={label}>
                  {label === "Body" ? (
                    <p className="text-xs text-text-secondary whitespace-pre-line">{value}</p>
                  ) : (
                    <div className="flex gap-2">
                      <span className="text-xs text-text-tertiary w-14 shrink-0">{label}:</span>
                      <span className="text-xs text-text-primary">{value}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Conversation summary */}
        {meta.summary && (
          <div>
            <div className="text-xs font-semibold text-text-secondary mb-2">Conversation summary</div>
            <p className="text-xs text-text-secondary leading-relaxed">{meta.summary}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border shrink-0">
        <button className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-surface-1 hover:bg-surface-2 text-xs text-text-secondary hover:text-text-primary transition-colors border border-border">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="1" y="2" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M3 5H9M3 7H7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          View full history
        </button>
      </div>
    </div>
  );
}

// ─── Message Bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ExtendedChatMessage }) {
  const isUser = message.role === "user";
  const time = formatTime(new Date(message.createdAt));

  if (isUser) {
    return (
      <div className="flex items-start gap-3 justify-end">
        <div className="flex flex-col items-end gap-1 max-w-[75%]">
          <div className="flex items-center gap-2">
            <span className="text-xxs text-text-tertiary">{time}</span>
          </div>
          <div className="px-4 py-2.5 bg-accent text-white rounded-2xl rounded-br-sm text-sm leading-relaxed">
            {message.content}
          </div>
        </div>
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-surface-2 border border-border overflow-hidden flex items-center justify-center shrink-0 mt-0.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      {/* AI Avatar */}
      <div className="w-8 h-8 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center shrink-0 mt-0.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-accent">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs font-semibold text-text-primary">Superhuman AI</span>
          <span className="text-xxs text-text-tertiary">{time}</span>
        </div>

        {/* Main response text */}
        {(message.content || message.isStreaming) && (
          <div className="px-4 py-2.5 bg-surface-1 rounded-2xl rounded-bl-sm text-sm leading-relaxed text-text-primary inline-block max-w-[75%]">
            {message.content}
            {message.isStreaming && !message.activities?.length && (
              <span className="inline-flex gap-0.5 ml-1.5 align-middle">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="w-1 h-1 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </span>
            )}
          </div>
        )}

        {/* Agent activity */}
        {message.activities && message.activities.length > 0 && (
          <AgentActivityBlock activities={message.activities} />
        )}

        {/* Action cards */}
        {message.actions && message.actions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {message.actions.map((action, i) => (
              <div key={i} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-xs text-accent">
                {action.type === "email_sent" && "✉️"}
                {action.type === "event_created" && "📅"}
                {action.type === "event_updated" && "🔄"}
                <span>{action.summary}</span>
              </div>
            ))}
          </div>
        )}

        {/* Message actions */}
        {!message.isStreaming && message.content && (
          <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {[
              { icon: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z", title: "Copy" },
              { icon: "M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5", title: "Good" },
              { icon: "M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5", title: "Bad" },
              { icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15", title: "Regenerate" },
            ].map(({ icon, title }) => (
              <button key={title} title={title} className="w-6 h-6 rounded-lg hover:bg-surface-2 flex items-center justify-center transition-colors">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary">
                  <path d={icon} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Empty State ────────────────────────────────────────────────────────────────

function EmptyState({ onPrompt }: { onPrompt: (p: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center">
      {/* Icon cluster */}
      <div className="relative mb-6">
        <div className="relative w-20 h-20 rounded-2xl bg-surface-1 border border-border flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <path d="M28 22.667A2.667 2.667 0 0125.333 25.333H9.333L4 30.667V6.667A2.667 2.667 0 016.667 4H25.333A2.667 2.667 0 0128 6.667V22.667z" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <circle cx="11" cy="14" r="1.2" fill="var(--accent)" />
            <circle cx="16" cy="14" r="1.2" fill="var(--accent)" />
            <circle cx="21" cy="14" r="1.2" fill="var(--accent)" />
          </svg>
        </div>
        {/* Decorative dots */}
        {[
          { top: -8, left: 30, size: 4, opacity: 0.3 },
          { top: 2, left: -12, size: 6, opacity: 0.2 },
          { top: 16, left: -20, size: 3, opacity: 0.4 },
          { top: -6, right: -10, size: 5, opacity: 0.25 },
          { top: 30, right: -16, size: 4, opacity: 0.3 },
          { bottom: -4, left: 10, size: 3, opacity: 0.2 },
        ].map((dot, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-text-tertiary"
            style={{
              width: dot.size, height: dot.size,
              top: dot.top, left: (dot as any).left, right: (dot as any).right, bottom: (dot as any).bottom,
              opacity: dot.opacity,
            }}
          />
        ))}
      </div>

      <h2 className="text-lg font-semibold text-text-primary mb-1.5">Start a conversation</h2>
      <p className="text-sm text-text-secondary mb-8 max-w-xs leading-relaxed">
        Ask me to send emails, check your calendar, search messages, and more.
      </p>

      {/* Prompt grid */}
      <div className="grid grid-cols-2 gap-2 w-full max-w-md">
        {EXAMPLE_PROMPTS.map(({ icon, label }) => (
          <button
            key={label}
            onClick={() => onPrompt(label)}
            className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl bg-surface-1 border border-border text-sm text-text-secondary hover:text-text-primary hover:bg-surface-2 hover:border-border transition-all text-left"
          >
            <span className="text-base">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Sidebar Nav ────────────────────────────────────────────────────────────────

function Sidebar() {
  const items = [
    { icon: "M15.232 5.232l3.536 3.536M9 11l6-6 3.536 3.536-6 6H9v-3.536z", label: "Compose" },
    { icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z", label: "Search" },
    { icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z", label: "Chat", active: true },
    { icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z", label: "Mail" },
    { icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z", label: "Calendar" },
    { icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z", label: "Contacts" },
  ];

  return (
    <div className="w-14 shrink-0 bg-surface-sidebar border-r border-border flex flex-col items-center py-3 gap-1">
      {/* Logo */}
      <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center mb-3">
        <span className="text-white font-bold text-sm">S</span>
      </div>

      {items.map(({ icon, label, active }) => (
        <button
          key={label}
          title={label}
          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
            active ? "bg-accent/15 text-accent" : "text-text-tertiary hover:bg-surface-2 hover:text-text-secondary"
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d={icon} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ))}

      <div className="flex-1" />
      <button className="w-9 h-9 rounded-xl flex items-center justify-center text-text-tertiary hover:bg-surface-2 transition-colors" title="More">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="5" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="19" r="1" fill="currentColor" />
        </svg>
      </button>

      {/* User avatar */}
      <div className="relative mt-1">
        <div className="w-8 h-8 rounded-full bg-surface-2 border border-border flex items-center justify-center">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-surface-sidebar" />
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [messages, setMessages] = useState<ExtendedChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [meta, setMeta] = useState<LastActionMeta | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const currentMsgIdRef = useRef<string | null>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // SSE: agent_status events
  useEffect(() => {
    const es = new EventSource("/api/events/stream");

    es.addEventListener("agent_status", (event) => {
      const data = JSON.parse(event.data) as {
        level?: ActivityLevel;
        message: string;
        toolName?: string;
        toolArgs?: Record<string, unknown>;
        toolResult?: unknown;
        toolStatus?: "pending" | "success" | "error";
        meta?: LastActionMeta;
      };

      const msgId = currentMsgIdRef.current;
      if (!msgId) return;

      // Update last action meta panel if provided
      if (data.meta) {
        setMeta(data.meta);
      }

      const newActivity: Activity = {
        id: nanoid(),
        level: data.toolName ? "tool_call" : (data.level ?? "info"),
        message: data.message,
        timestamp: Date.now(),
        toolName: data.toolName,
        toolArgs: data.toolArgs,
        toolResult: data.toolResult,
        toolStatus: data.toolStatus,
      };

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, activities: [...(m.activities ?? []), newActivity] }
            : m,
        ),
      );
    });

    return () => es.close();
  }, []);

  const sendMessage = useCallback(async (prompt?: string) => {
    const text = (prompt ?? input).trim();
    if (!text || isLoading) return;

    const userMsg: ExtendedChatMessage = {
      id: nanoid(),
      role: "user",
      content: text,
      createdAt: new Date(),
    };

    const assistantId = nanoid();
    currentMsgIdRef.current = assistantId;

    const assistantMsg: ExtendedChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      actions: [],
      activities: [],
      createdAt: new Date(),
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setIsLoading(true);
    setMeta(null);

    const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, conversationHistory: history }),
      });

      if (!res.ok || !res.body) throw new Error("Request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "text") {
              fullText += ev.content;
              setMessages((prev) =>
                prev.map((m) => m.id === assistantId ? { ...m, content: fullText } : m),
              );
            }
            if (ev.type === "done") {
              setMessages((prev) =>
                prev.map((m) => m.id === assistantId ? { ...m, isStreaming: false } : m),
              );
            }
            if (ev.type === "error") throw new Error(ev.message);
          } catch {}
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setMessages((prev) =>
        prev.map((m) => m.id === assistantId ? { ...m, content: msg, isStreaming: false } : m),
      );
    } finally {
      setIsLoading(false);
      currentMsgIdRef.current = null;
    }
  }, [input, isLoading, messages]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* <Sidebar /> */}

      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0 bg-surface-0">
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 text-sm font-semibold text-text-primary hover:text-text-secondary transition-colors">
              New conversation
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-1">
            {[
              "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
              "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12",
              "M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z",
            ].map((d, i) => (
              <button key={i} className="w-8 h-8 rounded-lg hover:bg-surface-2 flex items-center justify-center transition-colors">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary">
                  <path d={d} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ))}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6 custom-thin-scrollbar">
          {messages.length === 0 ? (
            <EmptyState onPrompt={(p) => { setInput(p); inputRef.current?.focus(); sendMessage(p); }} />
          ) : (
            messages.map((m) => (
              <div key={m.id} className="group">
                <MessageBubble message={m} />
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-5 pb-5 pt-3 border-t border-border shrink-0">
          <div className="flex items-end gap-3 bg-surface-1 border border-border rounded-2xl px-4 py-3 focus-within:border-accent/40 focus-within:ring-1 focus-within:ring-accent/10 transition-all">
            <button className="shrink-0 w-7 h-7 rounded-lg hover:bg-surface-2 flex items-center justify-center transition-colors mb-0.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary">
                <path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              rows={1}
              disabled={isLoading}
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none resize-none max-h-[120px] py-0.5"
              style={{ minHeight: "22px" }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isLoading}
              className="w-9 h-9 rounded-xl bg-accent hover:bg-accent-hover flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (
                <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22,2 15,22 11,13 2,9 22,2" />
                </svg>
              )}
            </button>
          </div>
          <p className="text-xxs text-text-tertiary mt-2 text-center">
            Superhuman AI can make mistakes. Consider checking important info.
          </p>
        </div>
      </div>

      {/* Meta panel */}
      {meta && <MetaPanel meta={meta} onClose={() => setMeta(null)} />}
    </div>
  );
}