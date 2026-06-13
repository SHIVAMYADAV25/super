"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { signOut, useSession } from "next-auth/react";


interface NavItem {
  href: string;
  label: string;
  shortcut: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  {
    href: "/inbox",
    label: "Inbox",
    shortcut: "G then I",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/calendar",
    label: "Calendar",
    shortcut: "G then C",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="16" y1="2" x2="16" y2="6" strokeLinecap="round" />
        <line x1="8" y1="2" x2="8" y2="6" strokeLinecap="round" />
        <line x1="3" y1="10" x2="21" y2="10" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/chat",
    label: "Assistant",
    shortcut: "G then A",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  // ─── Real-time SSE connection ───────────────────────────────────────────────

  useEffect(() => {
    const es = new EventSource("/api/events/stream");

    es.addEventListener("new_email", () => {
      queryClient.invalidateQueries({ queryKey: ["emails"] });
    });

    es.addEventListener("new_event", () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
    });

    es.onerror = () => {
      // EventSource auto-reconnects — no action needed
    };

    return () => es.close();
  }, [queryClient]);

  // ─── Global keyboard shortcuts ──────────────────────────────────────────────

  const [gPressed, setGPressed] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't fire in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }

      // G prefix shortcuts
      if (e.key === "g" || e.key === "G") {
        setGPressed(true);
        setTimeout(() => setGPressed(false), 1000);
        return;
      }

      if (gPressed) {
        if (e.key === "i" || e.key === "I") router.push("/inbox");
        if (e.key === "c" || e.key === "C") router.push("/calendar");
        if (e.key === "a" || e.key === "A") router.push("/chat");
        setGPressed(false);
        return;
      }

      // Direct shortcuts
      if (e.key === "c" && !e.metaKey && !e.ctrlKey) {
        // Open compose — dispatched by inbox
        window.dispatchEvent(new CustomEvent("compose:open"));
      }
      if (e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("search:open"));
      }
      if (e.key === "?") {
        setShowShortcuts((prev) => !prev);
      }
      if (e.key === "Escape") {
        setShowShortcuts(false);
      }
    },
    [gPressed, router],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex h-screen bg-surface-0 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-14 flex flex-col items-center py-4 gap-1 border-r border-border bg-surface-0 shrink-0">
        {/* Logo */}
        <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center mb-3">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <path d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        {/* Nav items */}
        <nav className="flex flex-col gap-1 flex-1">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={`${item.label} (${item.shortcut})`}
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors
                  ${isActive
                    ? "bg-accent text-white"
                    : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
                  }`}
              >
                {item.icon}
              </Link>
            );
          })}
        </nav>

        {/* User avatar + logout */}
        <div className="mt-auto">
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            title={session?.user?.email ?? "Sign out"}
            className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center text-xs font-medium text-text-secondary hover:bg-surface-3 transition-colors"
          >
            {session?.user?.name?.[0]?.toUpperCase() ?? "?"}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">{children}</main>

      {/* Keyboard shortcuts help modal */}
      {showShortcuts && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="bg-surface-1 border border-border rounded-2xl p-6 w-96 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-text-primary mb-4">Keyboard shortcuts</h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {[
                ["C", "Compose"],
                ["/ or ⌘K", "Search"],
                ["J / K", "Navigate emails"],
                ["E", "Archive"],
                ["R", "Reply"],
                ["G → I", "Go to Inbox"],
                ["G → C", "Go to Calendar"],
                ["G → A", "Go to Assistant"],
                ["?", "Toggle shortcuts"],
                ["Esc", "Close / Cancel"],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between gap-2">
                  <span className="text-text-tertiary">{desc}</span>
                  <kbd className="px-1.5 py-0.5 rounded bg-surface-2 text-text-secondary font-mono text-xs border border-border">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}