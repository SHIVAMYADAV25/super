"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api-client";
import type { Email } from "@/src/types";
import { SendEmailSchema } from "@/src/schema";

// ─── Recipient chip input ─────────────────────────────────────────────────────

function RecipientInput({
  label,
  emails,
  onChange,
}: {
  label: string;
  emails: string[];
  onChange: (emails: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  function addEmail(raw: string) {
    const value = raw.trim();
    if (!value) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError(`Invalid email: ${value}`);
      return;
    }
    if (emails.includes(value)) {
      setInput("");
      return;
    }
    onChange([...emails, value]);
    setInput("");
    setError(null);
  }

  function removeEmail(email: string) {
    onChange(emails.filter((e) => e !== email));
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-text-tertiary font-medium">{label}</label>
      <div className="flex flex-wrap items-center gap-1.5 min-h-[36px] px-3 py-2 rounded-lg bg-surface-2 border border-border focus-within:border-accent/50 transition-colors">
        {emails.map((email) => (
          <span
            key={email}
            className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-3 text-xs text-text-secondary"
          >
            {email}
            <button
              type="button"
              onClick={() => removeEmail(email)}
              className="text-text-tertiary hover:text-text-secondary ml-0.5"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === " ") {
              e.preventDefault();
              addEmail(input);
            }
            if (e.key === "Backspace" && !input && emails.length > 0) {
              onChange(emails.slice(0, -1));
            }
          }}
          onBlur={() => { if (input) addEmail(input); }}
          placeholder={emails.length === 0 ? "Add email..." : ""}
          className="flex-1 min-w-[100px] bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none"
        />
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

// ─── Autosave hook ────────────────────────────────────────────────────────────

interface DraftState {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
}

function useAutosaveDraft(userId: string | undefined, state: DraftState) {
  const draftIdRef = useRef<string | null>(null);
  const gmailDraftIdRef = useRef<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(async () => {
    if (!userId) return;
    const hasContent =
      state.to.length > 0 ||
      state.subject.trim().length > 0 ||
      state.body.trim().length > 0;
    if (!hasContent) return;

    setSaveStatus("saving");
    try {
      if (!draftIdRef.current) {
        // First save
        const result = await api.post<{ draftId: string; gmailDraftId: string }>(
          "/api/drafts",
          state,
        );
        draftIdRef.current = result.draftId;
        gmailDraftIdRef.current = result.gmailDraftId;
      } else {
        // Update existing
        await api.put(`/api/drafts/${draftIdRef.current}`, state);
      }
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }, [userId, state]);

  // Debounce — save 1.5s after last change
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, 1500);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [save]);

  return {
    draftId: draftIdRef.current,
    saveStatus,
    discardDraft: async () => {
      if (draftIdRef.current) {
        await api.delete(`/api/drafts/${draftIdRef.current}`).catch(() => null);
        draftIdRef.current = null;
      }
    },
  };
}

// ─── Compose modal ────────────────────────────────────────────────────────────

interface ComposeModalProps {
  replyTo?: Email | null;
  onClose: () => void;
  onSent: () => void;
}

export function ComposeModal({ replyTo, onClose, onSent }: ComposeModalProps) {
  const [to, setTo] = useState<string[]>(
    replyTo?.fromAddr ? [replyTo.fromAddr.replace(/.*<(.+)>.*/, "$1").trim()] : [],
  );
  const [cc, setCc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(
    replyTo?.subject
      ? replyTo.subject.startsWith("Re:") ? replyTo.subject : `Re: ${replyTo.subject}`
      : "",
  );
  const [body, setBody] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [showDiscard, setShowDiscard] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const { draftId, saveStatus, discardDraft } = useAutosaveDraft("user", {
    to, cc, subject, body,
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      api.post<{ messageId: string }>("/api/emails", {
        to,
        cc,
        subject,
        body,
        draftId: draftId ?? undefined,
      }),
    onSuccess: () => {
      onSent();
    },
    onError: (err) => {
      setSendError(err instanceof Error ? err.message : "Failed to send. Draft saved.");
    },
  });

  // Validate before send
  function handleSend() {
    setSendError(null);
    const result = SendEmailSchema.safeParse({ to, cc, subject, body });
    if (!result.success) {
      const first = result.error.flatten().fieldErrors;
      const msg =
        first.to?.[0] ?? first.subject?.[0] ?? first.body?.[0] ?? "Please fill in required fields";
      setSendError(msg);
      return;
    }
    sendMutation.mutate();
  }

  // Close with confirmation if content present
  function handleClose() {
    const hasContent = to.length > 0 || subject || body;
    if (hasContent) {
      setShowDiscard(true);
    } else {
      onClose();
    }
  }

  async function handleDiscard() {
    await discardDraft();
    onClose();
  }

  // Cmd+Enter sends
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "Escape") {
        handleClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Auto-focus body
  useEffect(() => {
    setTimeout(() => bodyRef.current?.focus(), 50);
  }, []);

  const saveStatusLabel = {
    idle: "",
    saving: "Saving...",
    saved: "Draft saved",
    error: "Save failed",
  }[saveStatus];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={handleClose} />

      {/* Modal — bottom-right like Gmail */}
      <div className="fixed bottom-4 right-4 w-[540px] max-h-[80vh] bg-surface-1 border border-border rounded-2xl shadow-2xl z-50 flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-medium text-text-primary">
            {replyTo ? "Reply" : "New Message"}
          </span>
          <div className="flex items-center gap-3">
            {saveStatusLabel && (
              <span className={`text-xs ${saveStatus === "error" ? "text-danger" : "text-text-tertiary"}`}>
                {saveStatusLabel}
              </span>
            )}
            <button
              onClick={handleClose}
              className="text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Fields */}
        <div className="flex flex-col gap-3 px-4 pt-3 pb-2">
          <RecipientInput label="To" emails={to} onChange={setTo} />

          {showCc && (
            <RecipientInput label="Cc" emails={cc} onChange={setCc} />
          )}

          <div className="flex items-center gap-2">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary
                border-b border-border pb-1 outline-none focus:border-accent/50 transition-colors"
            />
            {!showCc && (
              <button
                type="button"
                onClick={() => setShowCc(true)}
                className="text-xs text-text-tertiary hover:text-text-secondary shrink-0"
              >
                + Cc
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your message..."
          className="flex-1 resize-none bg-transparent text-sm text-text-primary placeholder:text-text-tertiary
            px-4 py-2 outline-none min-h-[200px]"
        />

        {/* Error */}
        {sendError && (
          <div className="mx-4 mb-2 px-3 py-2 rounded-lg bg-danger/10 border border-danger/20 text-xs text-danger">
            {sendError}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <span className="text-xs text-text-tertiary">⌘ + Enter to send</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClose}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={sendMutation.isPending}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-medium
                hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {sendMutation.isPending ? (
                <>
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Sending...
                </>
              ) : (
                "Send"
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Discard confirm dialog */}
{showDiscard && (
<div className="fixed inset-0 z-[9999] flex items-center justify-center">
    <div
      className="absolute inset-0 bg-black/50"
      onClick={() => setShowDiscard(false)}
    />

    <div className="relative bg-surface-1 border border-border rounded-xl p-5 w-72 shadow-2xl">
      <p className="text-sm font-medium text-text-primary mb-1">
        Discard draft?
      </p>
            <p className="text-xs text-text-secondary mb-4">
              Your unsent message will be deleted.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDiscard(false)}
                className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
              >
                Keep writing
              </button>
              <button
                onClick={handleDiscard}
                className="px-3 py-1.5 rounded-lg bg-danger/10 border border-danger/30 text-xs text-danger hover:bg-danger/20 transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}