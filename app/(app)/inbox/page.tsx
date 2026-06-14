"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api-client";
// import type { EmailListItem, Email, PaginatedResponse } from "@/types";
import { EmailListItem , Email, PaginatedResponse } from "@/src/types";
import { formatDistanceToNow } from "date-fns";
import DOMPurify from "isomorphic-dompurify";
import { ComposeModal } from "@/src/components/compose/compose-modal";
import { SearchCommand } from "@/src/components/search/search-command";

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function EmailRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
      <div className="w-2 h-2 rounded-full skeleton shrink-0" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="h-3.5 w-32 skeleton rounded" />
        <div className="h-3 w-full skeleton rounded" />
      </div>
      <div className="h-3 w-12 skeleton rounded shrink-0" />
    </div>
  );
}

// ─── Priority badge ───────────────────────────────────────────────────────────

function PriorityDot({ priority }: { priority: string }) {
  if (priority === "normal") return null;
  return (
    <div
      title={`${priority} priority`}
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
        priority === "high" ? "bg-danger" : "bg-text-tertiary"
      }`}
    />
  );
}

// ─── Email row ────────────────────────────────────────────────────────────────

function EmailRow({
  email,
  isSelected,
  onClick,
}: {
  email: EmailListItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  const fromName = email.fromAddr?.match(/^"?([^"<]+)"?\s*</)
    ?.[1]
    ?.trim() ?? email.fromAddr ?? "Unknown";

  const time = email.receivedAt
    ? formatDistanceToNow(new Date(email.receivedAt), { addSuffix: false })
    : "";

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 border-b border-border/50 text-left
        transition-colors duration-75 group
        ${isSelected
          ? "bg-surface-2"
          : "hover:bg-surface-1"
        }`}
    >
      <PriorityDot priority={email.priority} />

      {/* Unread indicator */}
      <div
        className={`w-1.5 h-1.5 rounded-full shrink-0 transition-opacity ${
          email.isRead ? "opacity-0" : "bg-accent opacity-100"
        }`}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span
            className={`text-sm truncate ${
              email.isRead ? "text-text-secondary font-normal" : "text-text-primary font-semibold"
            }`}
          >
            {fromName}
          </span>
          <span className="text-xs text-text-tertiary shrink-0">{time}</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-sm truncate ${
              email.isRead ? "text-text-tertiary" : "text-text-secondary"
            }`}
          >
            <span className={email.isRead ? "" : "text-text-primary"}>{email.subject ?? "(no subject)"}</span>
            {email.snippet ? (
              <span className="text-text-tertiary"> — {email.snippet}</span>
            ) : null}
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── Email detail pane ────────────────────────────────────────────────────────

function EmailDetail({
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
  console.log("Geting a specific email : ", gmailId);
  const { data: email, isLoading } = useQuery({
    queryKey: ["email", gmailId],
    queryFn: () => api.get<Email>(`/api/emails/${gmailId}`),
    staleTime: 5 * 60_000,
  });

  // Sanitize HTML body for safe rendering
  const safeHtml = email?.body
    ? DOMPurify.sanitize(email.body, { ALLOWED_TAGS: ["p", "br", "b", "i", "a", "ul", "ol", "li", "div", "span", "strong", "em", "h1", "h2", "h3"] })
    : null;

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col p-6 space-y-4">
        <div className="h-5 w-2/3 skeleton rounded" />
        <div className="h-4 w-1/3 skeleton rounded" />
        <div className="space-y-2 mt-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`h-3 skeleton rounded ${i % 3 === 2 ? "w-2/3" : "w-full"}`} />
          ))}
        </div>
      </div>
    );
  }

  if (!email) return null;

  const fromName = email.fromAddr?.match(/^"?([^"<]+)"?\s*</)
    ?.[1]
    ?.trim() ?? email.fromAddr ?? "Unknown";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-text-primary mb-1 leading-snug">
              {email.subject ?? "(no subject)"}
            </h2>
            <p className="text-sm text-text-secondary">
              <span className="font-medium">{fromName}</span>
              {email.receivedAt && (
                <span className="text-text-tertiary ml-2">
                  {new Date(email.receivedAt).toLocaleString()}
                </span>
              )}
            </p>
            {email.toAddrs.length > 0 && (
              <p className="text-xs text-text-tertiary mt-0.5">
                To: {email.toAddrs.join(", ")}
              </p>
            )}
          </div>

          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-secondary p-1 rounded transition-colors shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-3">
          {[
            { label: "Reply (R)", onClick: () => onReply(email), icon: "↩" },
            { label: "Archive (E)", onClick: () => { onArchive(email.gmailId); onClose(); }, icon: "↓" },
          ].map((action) => (
            <button
              key={action.label}
              onClick={action.onClick}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary
                border border-border transition-colors"
            >
              <span>{action.icon}</span>
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {safeHtml ? (
          <div
            className="prose prose-invert prose-sm max-w-none text-text-secondary leading-relaxed"
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        ) : (
          <pre className="text-sm text-text-secondary whitespace-pre-wrap font-sans leading-relaxed">
            {email.body ?? "(no content)"}
          </pre>
        )}
      </div>
    </div>
  );
}

// ─── Main inbox page ──────────────────────────────────────────────────────────

export default function InboxPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Email | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<"all" | "high" | "normal" | "low">("all");
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["emails", priorityFilter],
    queryFn: () =>
      api.get<PaginatedResponse<EmailListItem>>(
        `/api/emails${priorityFilter !== "all" ? `?priority=${priorityFilter}` : ""}`,
      ),
  });

  const archiveMutation = useMutation({
    mutationFn: (gmailId: string) => api.post(`/api/emails/${gmailId}/archive`, {}),
    onMutate: async (gmailId) => {
      // Optimistic update — remove from list immediately
      const key = ["emails", priorityFilter];
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<PaginatedResponse<EmailListItem>>(key);
      if (prev) {
        queryClient.setQueryData<PaginatedResponse<EmailListItem>>(key, {
          ...prev,
          items: prev.items.filter((e) => e.gmailId !== gmailId),
        });
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["emails", priorityFilter], ctx.prev);
    },
  });

  const emails = data?.items ?? [];

  // Listen for global compose event
  useEffect(() => {
    const open = () => setComposeOpen(true);
    const openSearch = () => setSearchOpen(true);
    window.addEventListener("compose:open", open);
    window.addEventListener("search:open", openSearch);
    return () => {
      window.removeEventListener("compose:open", open);
      window.removeEventListener("search:open", openSearch);
    };
  }, []);

  // Keyboard nav within inbox
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(selectedIndex + 1, emails.length - 1);
        setSelectedIndex(next);
        setSelectedId(emails[next]?.gmailId ?? null);
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = Math.max(selectedIndex - 1, 0);
        setSelectedIndex(prev);
        setSelectedId(emails[prev]?.gmailId ?? null);
      }
      if ((e.key === "o" || e.key === "Enter") && selectedId) {
        // Already selected — stays open
      }
      if (e.key === "e" && selectedId) {
        archiveMutation.mutate(selectedId);
        setSelectedId(null);
      }
      if (e.key === "r" && selectedId) {
        const email = emails.find((em) => em.gmailId === selectedId);
        if (email) {
          setReplyTo({
            id: email.id,
            userId: "",
            gmailId: email.gmailId,
            threadId: email.threadId,
            fromAddr: email.fromAddr,
            toAddrs: [],
            ccAddrs: [],
            subject: email.subject,
            snippet: email.snippet,
            body: null,
            isRead: email.isRead,
            labels: email.labels,
            priority: email.priority,
            attachments: [],
            receivedAt: email.receivedAt,
          });
          setComposeOpen(true);
        }
      }
    },
    [emails, selectedId, selectedIndex, archiveMutation],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex h-full">
      {/* Email list */}
      <div
        className={`flex flex-col border-r border-border overflow-hidden transition-all ${
          selectedId ? "w-80 shrink-0" : "flex-1"
        }`}
      >
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h1 className="text-sm font-semibold text-text-primary">Inbox</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSearchOpen(true)}
              className="p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-colors"
              title="Search (/ or ⌘K)"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" strokeLinecap="round" />
              </svg>
            </button>
            <button
              onClick={() => setComposeOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                bg-accent text-white hover:bg-accent-hover transition-colors"
              title="Compose (C)"
            >
              Compose
            </button>
          </div>
        </div>

        {/* Priority filter tabs — backed by LLM-classified email priority */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-border/50">
          {([
            { key: "all", label: "All" },
            { key: "high", label: "High priority" },
            { key: "normal", label: "Normal" },
            { key: "low", label: "Low" },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setPriorityFilter(tab.key);
                setSelectedId(null);
                setSelectedIndex(0);
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                priorityFilter === tab.key
                  ? "bg-surface-2 text-text-primary"
                  : "text-text-tertiary hover:text-text-secondary hover:bg-surface-1"
              }`}
            >
              {tab.key === "high" && (
                <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" />
              )}
              {tab.key === "low" && (
                <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary shrink-0" />
              )}
              {tab.label}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div>
              {Array.from({ length: 8 }).map((_, i) => <EmailRowSkeleton key={i} />)}
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center justify-center h-48 px-6 text-center">
              <p className="text-sm text-text-secondary mb-3">Couldn't load emails</p>
              <button
                onClick={() => refetch()}
                className="text-xs text-accent hover:underline"
              >
                Retry →
              </button>
            </div>
          )}

          {!isLoading && !isError && emails.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 px-6 text-center">
              <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center mb-3">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary">
                  <path d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              {priorityFilter !== "all" ? (
                <>
                  <p className="text-sm text-text-secondary">
                    No {priorityFilter} priority emails right now
                  </p>
                  <button
                    onClick={() => setPriorityFilter("all")}
                    className="mt-3 text-xs text-accent hover:underline"
                  >
                    Show all emails →
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-text-secondary">Your inbox is empty</p>
                  <button
                    onClick={() => setComposeOpen(true)}
                    className="mt-3 text-xs text-accent hover:underline"
                  >
                    Compose your first email →
                  </button>
                </>
              )}
            </div>
          )}

          {emails.map((email, index) => (
            <EmailRow
              key={email.gmailId}
              email={email}
              isSelected={email.gmailId === selectedId}
              onClick={() => {
                setSelectedId(email.gmailId);
                setSelectedIndex(index);
              }}
            />
          ))}
        </div>
      </div>

      {/* Email detail pane */}
      {selectedId && (
        <EmailDetail
          gmailId={selectedId}
          onClose={() => setSelectedId(null)}
          onReply={(email) => {
            setReplyTo(email);
            setComposeOpen(true);
          }}
          onArchive={(id) => archiveMutation.mutate(id)}
        />
      )}

      {/* Compose modal */}
      {composeOpen && (
        <ComposeModal
          replyTo={replyTo}
          onClose={() => {
            setComposeOpen(false);
            setReplyTo(null);
          }}
          onSent={() => {
            setComposeOpen(false);
            setReplyTo(null);
            queryClient.invalidateQueries({ queryKey: ["emails"] });
          }}
        />
      )}

      {/* Search command palette */}
      {searchOpen && (
        <SearchCommand onClose={() => setSearchOpen(false)} />
      )}
    </div>
  );
}