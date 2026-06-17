"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api-client";
import { Email, EmailListItem, PaginatedResponse } from "@/src/types";
import DOMPurify from "isomorphic-dompurify";
import { formatEmailBodyText } from "./body-parser-utils"; 
import { ArrowLeft, Shield, MoreHorizontal, Clock, CheckCircle2, ChevronLeft, ChevronRight, CornerUpLeft, ReplyAll, Forward, Download, Paperclip } from "lucide-react";

export function EmailDetail({
  gmailId,
  onClose,
  onReply,
  onArchive,
}: {
  gmailId: string;
  onClose: () => void;
  onReply: (email: Email) => void;
  onArchive: (gmailId: string) => void;
}) {
  const { data: networkPayload, isLoading } = useQuery({
    queryKey: ["email", gmailId],
    queryFn: () => api.get<any>(`/api/emails/${gmailId}`),
    staleTime: 5 * 60_000,
  });

  // Smart fallback safely matches payload variance from network inspect logs
  const email = useMemo(() => {
    if (!networkPayload) return null;
    
    // Case 1: Raw response has a root "data" field containing another "data" field
    if (networkPayload.data && typeof networkPayload.data === 'object' && 'data' in networkPayload.data) {
      return networkPayload.data.data as Email;
    }
    
    // Case 2: Raw response is single nested (payload.data is directly the email object)
    if (networkPayload.data && typeof networkPayload.data === 'object' && 'id' in networkPayload.data) {
      return networkPayload.data as Email;
    }

    // Case 3: The custom api client helper has already extracted the absolute payload root
    if (typeof networkPayload === 'object' && 'id' in networkPayload) {
      return networkPayload as Email;
    }
    
    return null;
  }, [networkPayload]);


const queryClient = useQueryClient();

const markReadMutation = useMutation({
  mutationFn: (gmailId: string) =>
    api.patch(`/api/emails/${gmailId}`, {
      isRead: true,
    }),

  onSuccess: (_, gmailId) => {
    queryClient.setQueryData<PaginatedResponse<EmailListItem>>(
      ["emails"],
      (old) => {
        if (!old) return old;

        return {
          ...old,
          items: old.items.map((item) =>
            item.gmailId === gmailId
              ? { ...item, isRead: true }
              : item
          ),
        };
      }
    );
  },
});

useEffect(() => {
  if (email && !email.isRead) {
    markReadMutation.mutate(gmailId);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [email?.isRead, gmailId]);
// Intentionally omit markReadMutation — it's stable but changes identity;
// we only want this to run when email read status or ID changes.

  const safeHtml = email?.body && (email.body.includes("<p") || email.body.includes("<div") || email.body.includes("<table"))
    ? DOMPurify.sanitize(email.body, { 
        ALLOWED_TAGS: ["p", "br", "b", "i", "a", "ul", "ol", "li", "div", "span", "strong", "em", "h1", "h2", "h3", "img", "table", "tbody", "tr", "td"] 
      })
    : null;

  // Safe validation check closes loading spinners instantly for both single and double wrapped structures
  if (isLoading || !email) {
    return (
      <div className="flex-1 h-full bg-surface-0 flex items-center justify-center border-r border-neutral-200 dark:border-neutral-800/20">
        <div className="w-5 h-5 rounded-full border-2 border-neutral-400 dark:border-neutral-600 border-t-transparent animate-spin" />
      </div>
    );
  }

  const fromName = email.fromAddr?.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim() ?? email.fromAddr ?? "Unknown";
  const fromEmail = email.fromAddr?.match(/<([^>]+)>/)?.[1] ?? email.fromAddr ?? "";

  return (
    <div className="flex-1 h-full bg-surface-0 flex overflow-hidden animate-fade-in absolute inset-0 md:relative z-20">
      
      {/* LEFT SURFACE PANE: MAIN EMAIL WORKSPACE CONTAINER */}
      <div className="flex-1 h-full flex flex-col min-w-0 bg-surface-0">
        
        {/* Actions Context Toolbar Strip */}
        <div className="px-8 py-3 flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800/40 shrink-0 bg-surface-0">
          <div className="flex items-center gap-5 text-text-secondary">
            <button onClick={onClose} title="Back to list" className="hover:text-text-primary p-1 rounded transition-colors outline-none">
              <ArrowLeft size={16} strokeWidth={2.2} />
            </button>
            <div className="h-4 w-[1px] bg-neutral-200 dark:bg-neutral-800" />
            <button onClick={() => { onArchive(email.gmailId); onClose(); }} title="Archive (E)" className="hover:text-text-primary p-1 rounded transition-colors outline-none">
              <CheckCircle2 size={16} strokeWidth={2} />
            </button>
            <button className="hover:text-text-primary p-1 rounded transition-colors opacity-40 cursor-default outline-none">
              <Clock size={16} strokeWidth={2} />
            </button>
            <button className="hover:text-text-primary p-1 rounded transition-colors opacity-40 cursor-default outline-none">
              <MoreHorizontal size={16} strokeWidth={2} />
            </button>
          </div>

          <div className="flex items-center gap-4 text-text-tertiary">
            <button className="hover:text-text-primary p-1 opacity-40 cursor-default outline-none"><ChevronLeft size={16} strokeWidth={2.2} /></button>
            <button className="hover:text-text-primary p-1 opacity-40 cursor-default outline-none"><ChevronRight size={16} strokeWidth={2.2} /></button>
          </div>
        </div>

        {/* Scrolling Inner Content Thread Workspace Panel View */}
        <div className="flex-1 overflow-y-auto px-10 pt-8 pb-10 space-y-8 custom-thin-scrollbar bg-surface-0 select-text">
          
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-xl sm:text-2xl font-semibold text-text-primary tracking-tight font-sans leading-tight">
              {email.subject ?? "(no subject)"}
            </h1>
            <div className="flex items-center gap-2 text-text-tertiary shrink-0 mt-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#79BAD8]" />
              <button className="hover:text-text-primary opacity-40 cursor-default outline-none"><Clock size={14} /></button>
              <button className="hover:text-text-primary opacity-40 cursor-default outline-none"><Shield size={14} /></button>
            </div>
          </div>

          {/* Core Card Sender Matrix Block */}
          <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800/20 pb-5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-full bg-neutral-200 dark:bg-neutral-800 shrink-0 flex items-center justify-center font-bold text-text-secondary text-sm">
                {fromName ? fromName[0].toUpperCase() : "U"}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-primary truncate leading-snug">
                  {fromName} <span className="text-xs text-text-secondary font-mono font-normal ml-1.5">&lt;{fromEmail}&gt;</span>
                </div>
                <div className="text-xs text-text-tertiary mt-0.5 font-sans">
                  to me <span className="opacity-60 font-mono text-[11px] ml-1">&lt;{email.toAddrs?.join(", ") || "user@client.io"}&gt;</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-text-tertiary font-mono text-xs text-right shrink-0">
              <span>
                {email.receivedAt ? new Date(email.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ""}
              </span>
              <button onClick={() => onReply(email)} title="Reply" className="p-1 hover:text-text-primary border border-transparent hover:border-neutral-200 dark:hover:border-neutral-800 rounded transition-all ml-1 outline-none">
                <CornerUpLeft size={14} strokeWidth={2.2} />
              </button>
            </div>
          </div>

          {/* Clean text body presentation slot layout layer */}
<div className="text-sm text-text-primary font-normal tracking-normal break-words max-w-3xl selection:bg-blue-500/10">
  {safeHtml ? (
    <div 
      // Using custom standard utility styles over basic tailwind prose defaults
      className="max-w-none text-text-primary/95 space-y-2 dark:prose-invert 
        leading-relaxed selection:text-blue-500
        prose-a:text-[#0066cc] dark:prose-a:text-[#58a6ff] hover:prose-a:underline" 
      dangerouslySetInnerHTML={{ __html: safeHtml }} 
    />
  ) : (
    // Houses our beautifully compacted text system layout cleanly without extra padding lines
    <div className="space-y-2 font-sans text-text-primary/95 rendering-clean">
      {formatEmailBodyText(email.body)}
    </div>
  )}
</div>

          {/* Action Row Triggers */}
          <div className="pt-8 border-t border-neutral-200 dark:border-neutral-800/20 flex flex-wrap items-center gap-3 select-none">
            <button onClick={() => onReply(email)} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800/80 bg-surface-0 hover:bg-surface-1 text-xs font-semibold tracking-tight text-text-secondary hover:text-text-primary transition-all outline-none">
              <CornerUpLeft size={13} strokeWidth={2.2} /> Reply
            </button>
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-transparent bg-transparent opacity-30 cursor-default text-xs font-semibold tracking-tight text-text-secondary outline-none">
              <ReplyAll size={13} /> Reply all
            </button>
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-transparent bg-transparent opacity-30 cursor-default text-xs font-semibold tracking-tight text-text-secondary outline-none">
              <Forward size={13} /> Forward
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT COMPILER SIDEBAR: DYNAMIC SENDER METADATA CONTEXT MODULE */}
<div className="w-[280px] h-full hidden xl:flex flex-col bg-surface-sidebar border-l border-neutral-200 dark:border-neutral-800/40 p-6 overflow-y-auto custom-thin-scrollbar shrink-0 select-none">
  
  {/* 1. Core Profile Header Block Segment */}
  <div className="flex flex-col items-center text-center pb-6 border-b border-neutral-200 dark:border-neutral-800/20">
    {/* Initials Placeholder Circle Element */}
    <div className="w-16 h-16 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center font-bold text-text-primary text-xl shadow-xs mb-3 border border-neutral-200 dark:border-neutral-800">
      {fromName ? fromName[0].toUpperCase() : "U"}
    </div>
    
    {/* Sender Human-Readable Identity Title */}
    <h3 className="text-sm font-semibold text-text-primary tracking-tight leading-snug">
      {fromName}
    </h3>
    
    {/* Explicit String Value of the Target Address Parameter Block */}
    <p className="text-[11px] font-mono text-text-tertiary mt-1 truncate w-full px-2">
      {fromEmail}
    </p>
  </div>

  {/* 2. Priority & Label Metadata Category Tags Feed Context List */}
  <div className="py-5 border-b border-neutral-200 dark:border-neutral-800/20 space-y-3">
    <div className="text-[10px] font-bold tracking-super-wide text-text-tertiary uppercase font-mono">
      Message Context
    </div>
    
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {/* Map priorities dynamically into clean, low-contrast system pills */}
      {email.priority && (
        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-neutral-100 dark:bg-neutral-800/60 text-text-secondary font-mono lowercase">
          priority: {email.priority}
        </span>
      )}
      
      {/* Map literal system label tokens returned from the API */}
      {email.labels?.filter(label => !label.includes("UNREAD")).map((label: string) => (
        <span key={label} className="px-2 py-0.5 rounded text-[10px] font-medium bg-neutral-100 dark:bg-neutral-800/60 text-text-secondary font-mono lowercase">
          {label.replace("CATEGORY_", "").toLowerCase()}
        </span>
      ))}
    </div>
  </div>

  {/* 3. Interactive Secondary Conversation Attachment Frame Rows Widget */}
  <div className="pt-6 flex-1">
    <div className="text-[11px] font-bold tracking-super-wide text-text-tertiary uppercase font-mono mb-3 flex items-center gap-1.5">
      <Paperclip size={11} /> Attachments
    </div>
    
    {email.attachments && email.attachments.length > 0 ? (
      <div className="space-y-2">
        {email.attachments.map((file: any, index: number) => (
          <div key={index} className="flex items-center justify-between p-2 rounded-lg border border-neutral-200 dark:border-neutral-800/60 bg-surface-0 hover:bg-surface-1 transition-all">
            <div className="flex items-center gap-2 min-w-0">
              <div className="text-text-tertiary"><Paperclip size={14} /></div>
              <div className="min-w-0">
                <p className="text-xs text-text-primary font-medium truncate">{file.name || "Attachment"}</p>
                <p className="text-[10px] text-text-tertiary font-mono">{file.size || "1.2 MB"}</p>
              </div>
            </div>
            <button className="text-text-tertiary hover:text-text-primary p-1 rounded transition-colors outline-none">
              <Download size={13} />
            </button>
          </div>
        ))}
      </div>
    ) : (
      <p className="text-xs text-text-tertiary italic opacity-40 font-sans">
        No attached files in this message thread
      </p>
    )}
  </div>
  
  {/* Branding Footer Component Row */}
  <div className="pt-4 border-t border-neutral-200 dark:border-neutral-800/10 text-right">
    <span className="text-[9px] tracking-widest text-text-tertiary font-mono uppercase opacity-50">
      Universal Inbox
    </span>
  </div>
</div>

    </div>
  );
}