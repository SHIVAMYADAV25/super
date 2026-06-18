
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api-client";
import type { EmailListItem, Email, PaginatedResponse, SSEEvent, EmailPriority } from "@/src/types";
import { ComposeModal } from "@/src/components/compose/compose-modal";
import { SearchCommand } from "@/src/components/search/search-command";
import { isToday, isYesterday, subDays, isAfter, startOfMonth } from "date-fns";
import { Pencil, Search } from "lucide-react";
import { EmailDetail } from "@/src/components/Email/EmailDetail";
import { useRouter } from "next/navigation";



const TIMELINE_ORDER = ["Today", "Yesterday", "Last 7 days", "Earlier this month"];

function getTimelineGroup(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "Earlier this month";
  const date = new Date(dateInput);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  if (isAfter(date, subDays(new Date(), 7))) return "Last 7 days";
  if (isAfter(date, startOfMonth(new Date()))) return "Earlier this month";
  return "Earlier this month";
}

interface Badge { name: string; style: string }

function getPrimaryBadge(subject = "", labels: string[] = []): Badge | null {
  const text = [...labels, subject].join(" ").toLowerCase();

  const rules: Array<{ name: string; style: string; keywords: string[] }> = [
    { name: "urgent",     style: "bg-red-500/10 text-red-500 dark:bg-red-950/40 dark:text-red-400",         keywords: ["urgent","immediately","critical","asap","attention required","failed production"] },
    { name: "action",     style: "bg-amber-500/10 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400", keywords: ["invitation","approve","review","respond","verify","complete","action required","invited you"] },
    { name: "job",        style: "bg-violet-500/10 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400", keywords: ["internship","job","career","hiring","recruiter","application","interview"] },
    { name: "meeting",    style: "bg-cyan-500/10 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-400",     keywords: ["meeting","calendar","schedule","zoom","google meet","appointment"] },
    { name: "finance",    style: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400", keywords: ["invoice","payment","billing","subscription","receipt","transaction","refund"] },
    { name: "security",   style: "bg-orange-500/10 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400", keywords: ["security","password","verification","2fa","otp","account access"] },
    { name: "deployment", style: "bg-blue-500/10 text-blue-500 dark:bg-blue-950/40 dark:text-blue-400",     keywords: ["deployment","production","build failed","vercel","railway","netlify","render"] },
    { name: "social",     style: "bg-pink-500/10 text-pink-600 dark:bg-pink-950/40 dark:text-pink-400",     keywords: ["linkedin","connection","social","category_social"] },
    { name: "newsletter", style: "bg-indigo-500/10 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400", keywords: ["newsletter","digest","weekly","monthly","edition","category_updates"] },
    { name: "promotion",  style: "bg-rose-500/10 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",     keywords: ["sale","discount","offer","deal","coupon","promotion","category_promotions"] },
    { name: "support",    style: "bg-slate-500/10 text-slate-600 dark:bg-slate-950/40 dark:text-slate-400", keywords: ["ticket","issue","support","customer service"] },
    { name: "education",  style: "bg-teal-500/10 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400",     keywords: ["course","learn","training","certificate","workshop","bootcamp","tutorial"] },
  ];

  return rules.find((r) => r.keywords.some((kw) => text.includes(kw))) ?? null;
}

type TabType = "inbox" | "important" | "secondary" | "standard_feed" | "notification" | "support" | "others";

function filterByTab(emails: EmailListItem[], tab: TabType): EmailListItem[] {
  return emails.filter((e) => {
    const labels = e.labels ?? [];
    const subject = (e.subject ?? "").toLowerCase();
    switch (tab) {
      case "inbox":         return labels.includes("INBOX");
      case "important":     return labels.includes("IMPORTANT") || labels.includes("CATEGORY_PERSONAL") || e.priority === "high";
      case "secondary":     return labels.includes("CATEGORY_PROMOTIONS") || e.priority === "low";
      case "standard_feed": return e.priority === "normal" && !labels.includes("CATEGORY_UPDATES") && !labels.includes("CATEGORY_PROMOTIONS");
      case "notification":  return labels.includes("CATEGORY_UPDATES");
      case "support":       return subject.includes("support") || subject.includes("issue");
      case "others":        return labels.includes("CATEGORY_SOCIAL");
      default:              return true;
    }
  });
}

function EmailRow({ email, isSelected, onClick }: { email: EmailListItem; isSelected: boolean; onClick: () => void }) {
  const fromName = email.fromAddr?.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim() ?? email.fromAddr ?? "Unknown";
  const badge = getPrimaryBadge(email.subject ?? "", email.labels ?? []);
  const rowDate = email.receivedAt
    ? new Date(email.receivedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()
    : "";

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between px-10 py-2.5 text-left transition-colors duration-100 select-none relative outline-none
        ${isSelected ? "bg-surface-2 text-text-primary" : "hover:bg-surface-1 text-text-secondary"}`}
    >
      <div className="flex items-center gap-5 min-w-0 flex-1 pr-4">
        <div style={{ fontSize: "14px" }}
          className={`w-44 shrink-0 truncate text-sm tracking-super-tight flex items-center
            ${!email.isRead ? "text-text-primary font-semibold" : "text-text-secondary font-medium"}`}>
          <div className="w-1.5 h-1.5 flex items-center justify-center shrink-0 mr-2">
            {!email.isRead && <div className="w-1.5 h-1.5 rounded-full bg-[#79BAD8]" />}
          </div>
          <div className="truncate">{fromName}</div>
        </div>

        <div style={{ marginLeft: "48px" }} className="flex items-center gap-3 min-w-0 flex-1 text-sm truncate tracking-super-tight">
          {badge && (
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider shrink-0 uppercase min-w-[54px] text-center ${badge.style}`}>
              {badge.name}
            </span>
          )}
          <span style={{ fontWeight: 500 }}
            className={`truncate ${!email.isRead ? "text-text-primary font-semibold" : "text-text-primary/90 font-medium"}`}>
            {email.subject ?? "(no subject)"}
          </span>
          {email.snippet && (
            <span className="text-text-secondary/60 font-normal truncate ml-2 text-[13px]">{email.snippet}</span>
          )}
        </div>
      </div>

      <div style={{ fontSize: "13px" }}
        className="text-xxs tracking-super-wide text-text-tertiary font-medium shrink-0 text-right w-16 font-mono">
        {rowDate}
      </div>
    </button>
  );
}

function RecentOpensSidebar({
  hasSelectedEmail,
  onSelectRecent,
  emails,
}: {
  hasSelectedEmail: boolean;
  onSelectRecent: (id: string) => void;
  emails: EmailListItem[];
}) {
  // Show the 6 most recently received emails as "recent opens"
  const recent = [...emails]
    .filter((e) => e.receivedAt)
    .sort((a, b) => new Date(b.receivedAt!).getTime() - new Date(a.receivedAt!).getTime())
    .slice(0, 6);

  return (
    <div
      className={`w-[280px] h-full flex flex-col pt-6 select-none shrink-0 relative transition-colors duration-150 overflow-hidden
        ${hasSelectedEmail
          ? "bg-surface-0 border-l border-neutral-200 dark:border-neutral-800/20"
          : "bg-surface-sidebar border-l border-neutral-200/60 dark:border-neutral-900/60"
        }`}
    >
      <div className="px-6 pb-4 shrink-0">
        <h2 className="text-xs font-semibold text-text-primary tracking-tight">Recent</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-6 space-y-3.5 pb-4 custom-thin-scrollbar">
        {recent.length === 0 && (
          <p className="text-xs text-text-tertiary italic">No emails loaded yet.</p>
        )}
        {recent.map((item) => {
          const fromName =
            item.fromAddr?.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim() ??
            item.fromAddr ??
            "Unknown";
          const timeStr = item.receivedAt
            ? new Date(item.receivedAt).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })
            : "";

          return (
            <div
              key={item.gmailId}
              onClick={() => onSelectRecent(item.gmailId)}
              className="min-w-0 cursor-pointer block group"
            >
              <div className="flex items-baseline justify-between gap-2 mb-0.5">
                <p className="text-xs font-medium text-text-primary/90 group-hover:text-accent transition-colors truncate">
                  {fromName}
                </p>
                <span className="text-[10px] text-text-tertiary/70 shrink-0 font-mono">
                  {timeStr}
                </span>
              </div>
              <p className="text-xs text-text-secondary truncate leading-normal">
                {item.subject ?? "(no subject)"}
              </p>
            </div>
          );
        })}
      </div>

      <div className="px-6 py-3 border-t border-neutral-200 dark:border-neutral-800/40 flex items-center justify-between text-[10px] tracking-super-wide text-text-tertiary/80 uppercase font-mono shrink-0">
        <span>Supermail</span>
        <div className="flex gap-2.5 opacity-40">
          <span>🎁</span><span>❓</span><span>📅</span>
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { id: "inbox",         label: "Inbox" },
  { id: "important",     label: "Important" },
  { id: "secondary",     label: "Secondary" },
  { id: "standard_feed", label: "Standard Feed" },
  { id: "notification",  label: "Notification" },
  { id: "support",       label: "Support" },
  { id: "others",        label: "Others" },
] as const;

export default function InboxPage() {
  const [activeTab, setActiveTab] = useState<TabType>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Email | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [gChord, setGChord] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const openCompose = () => setComposeOpen(true);
    const openSearch = () => setSearchOpen(true);
    window.addEventListener("compose:open", openCompose);
    window.addEventListener("search:open", openSearch);
    return () => {
      window.removeEventListener("compose:open", openCompose);
      window.removeEventListener("search:open", openSearch);
    };
  }, []);

  const queryClient = useQueryClient();

  // SSE — single persistent connection, surgical updates only
  useEffect(() => {
    const es = new EventSource("/api/events/stream");

    es.addEventListener("new_email", (e: MessageEvent) => {
  try {
    const data = JSON.parse(e.data) as { historyId?: string; email?: EmailListItem };
    console.log(data);
    if (data.email) {
      queryClient.setQueryData<PaginatedResponse<EmailListItem>>(["emails"], (old) => {
        if (!old) return old;
        const exists = old.items.some((i) => i.gmailId === data.email!.gmailId);
        if (exists) return old;
        return { ...old, items: [data.email!, ...old.items] };
      });
    } else {
      void queryClient.invalidateQueries({ queryKey: ["emails"] });
    }
  } catch { /* malformed payload — ignore */ }
});

es.addEventListener("email_enriched", (e: MessageEvent) => {
  try {
    const data = JSON.parse(e.data) as {
      gmailId: string;
      priority: EmailPriority;
    };

    queryClient.setQueryData<PaginatedResponse<EmailListItem>>(
      ["emails"],
      (old) => {
        if (!old) return old;

        return {
          ...old,
          items: old.items.map((item) =>
            item.gmailId === data.gmailId
              ? { ...item, priority: data.priority }
              : item
          ),
        };
      }
    );
  } catch {}
});

    return () => es.close();
  }, [queryClient]);

  const { data, isLoading, isError, refetch } = useQuery<PaginatedResponse<EmailListItem>>({
    queryKey: ["emails"],
    queryFn: () => api.get<PaginatedResponse<EmailListItem>>("/api/emails"),
    staleTime: 5 * 60 * 1000,
  });

  const archiveMutation = useMutation({
    mutationFn: (gmailId: string) => api.post(`/api/emails/${gmailId}/archive`, {}),
    onMutate: async (gmailId) => {
      await queryClient.cancelQueries({ queryKey: ["emails"] });
      const prev = queryClient.getQueryData<PaginatedResponse<EmailListItem>>(["emails"]);
      if (prev) {
        queryClient.setQueryData<PaginatedResponse<EmailListItem>>(["emails"], {
          ...prev,
          items: prev.items.filter((e) => e.gmailId !== gmailId),
        });
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["emails"], ctx.prev);
    },
  });


  const emails = data?.items ?? [];
  const selectedEmail = useMemo(
  () => emails.find((e) => e.gmailId === selectedId) ?? null,
  [emails, selectedId]
);


  const filteredEmails = useMemo(() => filterByTab(emails, activeTab), [emails, activeTab]);

  const groupedEmails = useMemo(() => {
    const groups: Record<string, EmailListItem[]> = {};
    const sorted = [...filteredEmails].sort((a, b) => {
      if (!a.receivedAt) return 1;
      if (!b.receivedAt) return -1;
      return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
    });
    for (const email of sorted) {
      if (!email.gmailId) continue;
      const g = getTimelineGroup(email.receivedAt?.toString());
      if (!groups[g]) groups[g] = [];
      groups[g].push(email);
    }
    return groups;
  }, [filteredEmails]);

  const chronologicalKeys = useMemo(() => {
    const keys = Object.keys(groupedEmails);
    return TIMELINE_ORDER.filter((k) => keys.includes(k)).concat(keys.filter((k) => !TIMELINE_ORDER.includes(k)));
  }, [groupedEmails]);

  const tabCounts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.id, filterByTab(emails, t.id).filter((e) => !e.isRead).length])),
    [emails],
  );

const handleKeyDown = useCallback((e: KeyboardEvent) => {
  // Don't fire if user is typing in an input/textarea
  if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;

  // J / K — navigate emails
if (e.key === "j" || e.key === "ArrowDown") {
  e.preventDefault();

  setSelectedIndex((i) => {
    const next = Math.min(i + 1, filteredEmails.length - 1);

    const nextEmail = filteredEmails[next];
    if (nextEmail) {
      setSelectedId(nextEmail.gmailId);
    }

    return next;
  });
}

if (e.key === "k" || e.key === "ArrowUp") {
  e.preventDefault();

  setSelectedIndex((i) => {
    const next = Math.max(i - 1, 0);

    const nextEmail = filteredEmails[next];
    if (nextEmail) {
      setSelectedId(nextEmail.gmailId);
    }

    return next;
  });
}

  // E — archive selected
  if (e.key === "e" && selectedEmail) {
    archiveMutation.mutate(selectedEmail.gmailId);
  }

  // R — reply to selected
  if (e.key === "r" && selectedEmail) {
  setReplyTo({
    id: selectedEmail.id,
    userId: "",
    gmailId: selectedEmail.gmailId,
    threadId: selectedEmail.threadId,
    fromAddr: selectedEmail.fromAddr,
    toAddrs: [],
    ccAddrs: [],
    subject: selectedEmail.subject,
    snippet: selectedEmail.snippet,
    body: null,
    isRead: selectedEmail.isRead,
    labels: selectedEmail.labels,
    priority: selectedEmail.priority,
    attachments: [],
    receivedAt: selectedEmail.receivedAt,
  });

  setComposeOpen(true);
}

  // C — compose new
  if (e.key === "c") {
    setComposeOpen(true);
  }

  // / or Cmd+K — open search
  if (e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) {
    e.preventDefault();
    setSearchOpen(true);
  }

  // Escape — close panels
  if (e.key === "Escape") {
    setSelectedId(null);
    setComposeOpen(false);
    setSearchOpen(false);
  }

  // G-chord navigation
  if (e.key === "g") {
    setGChord(true);
    setTimeout(() => setGChord(false), 1000);
  }
  if (gChord) {
    if (e.key === "i") router.push("/inbox");
    if (e.key === "c") router.push("/calendar");
    if (e.key === "a") router.push("/chat");
  }
}, [selectedEmail,filteredEmails, emails, selectedIndex, gChord, archiveMutation, router]);

useEffect(() => {
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [handleKeyDown]);

  return (
    <div className="w-full h-full bg-surface-0 flex box-border relative transition-colors duration-150">

      <div className={`flex-1 flex flex-col min-w-0 overflow-hidden h-full transition-all duration-300 ${selectedId ? "hidden" : "flex"}`}>

        <div className="flex items-center justify-between px-10 pt-3 pb-2 bg-surface-0 select-none border-b border-neutral-200 dark:border-neutral-800/40">
          <div className="flex items-center gap-6 overflow-x-auto scrollbar-none max-w-full pr-4">
            {TABS.map((tab) => {
              const count = (tabCounts[tab.id] as number) ?? 0;
              return (
                <button key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setSelectedId(null); setSelectedIndex(0); }}
                  className={`text-sm font-semibold transition-all relative pb-2 outline-none shrink-0
                    ${activeTab === tab.id ? "text-text-primary" : "text-text-secondary/50 hover:text-text-secondary"}`}>
                  <span className="inline-flex items-baseline gap-1">
                    {tab.label}
                    {count > 0 && <span className="text-xxs font-normal opacity-60 font-mono">{count}</span>}
                  </span>
                  {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-full" />}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-4 text-text-tertiary/80 shrink-0">
            <button onClick={() => setComposeOpen(true)} className="hover:text-text-secondary p-1 outline-none"><Pencil size={18} /></button>
            <button onClick={() => setSearchOpen(true)} className="hover:text-text-secondary p-1 outline-none"><Search size={18} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-thin-scrollbar">
          {isLoading && (
            <div className="p-10 space-y-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-8 bg-surface-1 rounded animate-pulse opacity-50" style={{ animationDelay: `${i * 50}ms` }} />
              ))}
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center justify-center h-48 px-10 text-center">
              <p className="text-sm text-text-secondary mb-3">Couldn't load emails.</p>
              <button onClick={() => refetch()} className="text-xs text-accent hover:underline">Retry →</button>
            </div>
          )}

          {!isLoading && !isError && chronologicalKeys.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-center px-10">
              <p className="text-sm text-text-secondary font-medium">All clear.</p>
            </div>
          )}

          {!isLoading && !isError && chronologicalKeys.map((groupTitle) => {
            const items = groupedEmails[groupTitle] ?? [];
            if (!items.length) return null;
            return (
              <div key={groupTitle} className="mb-2">
                <div className="px-10 py-1.5 bg-surface-0 sticky top-0 z-10">
                  <h2 className="text-xxs font-bold tracking-super-wide text-text-tertiary uppercase font-mono pt-1 ml-3">{groupTitle}</h2>
                </div>
                <div className="mt-0.5">
                  {items.map((email, idx) => (
                    <EmailRow key={email.gmailId} email={email} isSelected={email.gmailId === selectedId}
                      onClick={() => { setSelectedId(email.gmailId); setSelectedIndex(idx); }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedId && (
        <div className="flex-1 h-full z-20 animate-fade-in absolute inset-0 md:relative">
          <EmailDetail gmailId={selectedId} onClose={() => setSelectedId(null)}
            onReply={(email) => { setReplyTo(email); setComposeOpen(true); }}
            onArchive={(id) => archiveMutation.mutate(id)} />
        </div>
      )}

      <div className={selectedId ? "hidden" : "block"}>
        <RecentOpensSidebar
          hasSelectedEmail={!!selectedId}
          onSelectRecent={(id) => setSelectedId(id)}
          emails={emails}
        />
      </div>

      {composeOpen && (
        <ComposeModal replyTo={replyTo}
          onClose={() => { setComposeOpen(false); setReplyTo(null); }}
          onSent={() => { setComposeOpen(false); setReplyTo(null); void queryClient.invalidateQueries({ queryKey: ["emails"] }); }} />
      )}

      {searchOpen && <SearchCommand onClose={() => setSearchOpen(false)} />}
    </div>
  );
}