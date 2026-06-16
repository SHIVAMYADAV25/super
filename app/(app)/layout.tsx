// app/(app)/layout.tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useCallback, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { Send } from "lucide-react";

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
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/calendar",
    label: "Calendar",
    shortcut: "G then C",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
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
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const { theme, setTheme, resolvedTheme } = useTheme();
  
  const [mounted, setMounted] = useState(false);
  const [gPressed, setGPressed] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Prevent UI component hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  const isDarkMode = resolvedTheme === "dark";

const toggleTheme = (event: React.MouseEvent<HTMLButtonElement>) => {
  // 1. Capture the exact state BEFORE the theme switches
  const wasDarkMode = resolvedTheme === "dark";
  const nextTheme = wasDarkMode ? "light" : "dark";

  // Graceful fallback for legacy browsers without View Transition API support
  if (!document.startViewTransition) {
    setTheme(nextTheme);
    return;
  }

  // Target coordinates of your navigation toggle button click
  const x = event.clientX;
  const y = event.clientY;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );

  const transition = document.startViewTransition(() => {
    setTheme(nextTheme);
  });

  transition.ready.then(() => {
    const clipPath = [
      `circle(0px at ${x}px ${y}px)`,
      `circle(${endRadius}px at ${x}px ${y}px)`,
    ];
    
    document.documentElement.animate(
      {
        // 2. Use the stable 'wasDarkMode' variable instead of the reactive 'resolvedTheme'
        clipPath: wasDarkMode ? [...clipPath].reverse() : clipPath,
      },
      {
        duration: 450,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        // 3. Pin the pseudo-element to match the starting state safely
        pseudoElement: wasDarkMode
          ? "::view-transition-old(root)"
          : "::view-transition-new(root)",
      }
    );
  });
};

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;

    if (e.key === "g" || e.key === "G") {
      setGPressed(true);
      setTimeout(() => setGPressed(false), 800);
      return;
    }

    if (gPressed) {
      if (e.key === "i" || e.key === "I") router.push("/inbox");
      if (e.key === "c" || e.key === "C") router.push("/calendar");
      if (e.key === "a" || e.key === "A") router.push("/chat");
      setGPressed(false);
      return;
    }

    if (e.key === "c" && !e.metaKey && !e.ctrlKey) window.dispatchEvent(new CustomEvent("compose:open"));
    if (e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("search:open"));
    }
    if (e.key === "?") setShowShortcuts((prev) => !prev);
    if (e.key === "Escape") setShowShortcuts(false);
  }, [gPressed, router]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="w-screen h-screen p-3 sm:p-4 bg-background overflow-hidden flex box-border select-none">
      <div className="flex-1 h-full bg-surface-0 superhuman-shell-shadow rounded-xl flex overflow-hidden border border-neutral-200 dark:border-neutral-900/80 relative">

        {/* Left nav strip */}
        <aside className="w-[58px] flex flex-col items-center py-5 gap-1.5 border-r border-neutral-200 dark:border-neutral-900/60 bg-surface-0 shrink-0 h-full">
          <div className="w-[34px] h-[34px] rounded-lg bg-accent flex items-center justify-center mb-4 transition-colors">
              <Link key={"/home"} href={"/home"} title="Home (H)"><Send size={20} /> </Link>
          </div>

          <nav className="flex flex-col gap-2 flex-1 w-full items-center">
            {navItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} title={`${item.label} (${item.shortcut})`}
                  className={`w-[38px] h-[34px] rounded-md flex items-center justify-center transition-all duration-100 outline-none
                    ${isActive ? "bg-accent/10 text-accent font-semibold" : "text-text-tertiary/90 hover:text-text-primary hover:bg-surface-2"}`}>
                  {item.icon}
                </Link>
              );
            })}
          </nav>

          {/* Theme toggle button */}
          <button onClick={toggleTheme} title={mounted ? `Switch to ${isDarkMode ? "Light" : "Dark"} Mode` : "Toggle Theme"}
            className="w-[38px] h-[34px] rounded-md flex items-center justify-center text-text-tertiary/90 hover:text-text-primary hover:bg-surface-2 transition-all duration-100 outline-none mb-1">
            {mounted && isDarkMode ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#e75b85]">
                <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
              </svg>
            )}
          </button>

          {/* Avatar / sign out */}
          <div className="mt-auto">
            <button onClick={() => signOut({ callbackUrl: "/login" })} title={session?.user?.email ?? "Sign out"}
              className="w-7 h-7 rounded-full bg-surface-2 flex items-center justify-center text-xs font-semibold text-text-secondary hover:bg-surface-3 transition-colors outline-none">
              {session?.user?.name?.[0]?.toUpperCase() ?? "S"}
            </button>
          </div>
        </aside>

        {/* Main content slot */}
        <main className="flex-1 overflow-hidden h-full bg-surface-0">
          {children}
        </main>
      </div>

      {/* Keyboard shortcuts overlay */}
      {showShortcuts && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 item-fade-in" onClick={() => setShowShortcuts(false)}>
          <div className="bg-surface-0 border border-neutral-200 dark:border-neutral-900/80 rounded-2xl p-6 w-[360px] superhuman-shell-shadow" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-bold text-text-primary tracking-tight mb-4">Keyboard Shortcuts</h2>
            <div className="space-y-2.5 text-xs">
              {[
                ["C", "Compose"],
                ["/ or ⌘K", "Search"],
                ["J / K", "Navigate Down / Up"],
                ["E", "Archive"],
                ["R", "Reply"],
                ["G → I", "Inbox"],
                ["G → C", "Calendar"],
                ["G → A", "Assistant"],
                ["?", "Toggle Shortcuts"],
                ["Esc", "Close"],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-text-secondary font-medium">{desc}</span>
                  <kbd className="px-1.5 py-0.5 rounded bg-surface-2 text-text-primary font-mono text-[11px] border border-neutral-200 dark:border-neutral-800/60 font-semibold shadow-xs">
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