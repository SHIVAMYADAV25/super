"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  Inbox,
  CalendarDays,
  Sparkles,
  Search,
  RefreshCw,
  ShieldCheck,
  Sun,
  Moon,
  ArrowRight,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────
// Static content — keep copy here so the JSX below stays readable.
// ─────────────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Inbox,
    tag: "action",
    title: "One inbox, one calendar",
    body: "Gmail and Google Calendar live in the same keyboard-driven view, backed by a local cache so it never feels like it's waiting on Google.",
  },
  {
    icon: Sparkles,
    tag: "product",
    title: "An assistant that can act",
    body: "Ask it to clear out the noise, draft a reply, or set up a meeting it works inside your inbox directly, instead of just describing what you should do.",
  },
  {
    icon: RefreshCw,
    tag: "urgent",
    title: "Priority, sorted for you",
    body: "Every message gets triaged the moment it lands, so the one that actually matters doesn't sit behind fifty newsletters.",
  },
  {
    icon: Search,
    tag: "meeting",
    title: "Search that understands you",
    body: "Press \u2318K and search by what an email says, not just what it's titled text and meaning, merged into one ranked list.",
  },
  {
    icon: CalendarDays,
    tag: "finance",
    title: "Always in sync",
    body: "New mail and calendar changes show up the second they happen no refresh, no polling, just a quiet push from Google.",
  },
  {
    icon: ShieldCheck,
    tag: "security",
    title: "Permission, not autopilot",
    body: "The assistant can read and write on your behalf, but permanent deletes always wait for your say-so.",
  },
] as const;

const STEPS = [
  {
    n: "01",
    title: "Connect your Google account",
    body: "Sign in once. Gmail and Calendar access is requested up front and your tokens are encrypted at rest, never stored in plaintext.",
  },
  {
    n: "02",
    title: "It learns your inbox",
    body: "New mail is triaged and indexed in the background as it arrives priority, content, everything  so it's ready before you ask.",
  },
  {
    n: "03",
    title: "It handles the busywork",
    body: "Ask it to draft, send, or schedule, and it does through the same account you just connected, with your permissions respected.",
  },
] as const;

const INBOX_PREVIEW = [
  { initials: "JD", tag: "meeting", sender: "Jordan Diaz", subject: "Re: Q3 roadmap review", time: "2m" },
  { initials: "AP", tag: "urgent", sender: "Ava Patel Finance", subject: "Invoice #4471 is overdue", time: "14m" },
  { initials: "SU", tag: "action", sender: "Super Assistant", subject: "Drafted a reply to Jordan ready to send", time: "Just now" },
  { initials: "TS", tag: "newsletter", sender: "TechStash Weekly", subject: "5 things shipping this week", time: "1h" },
] as const;

const STACK = [
  "Next.js",
  "PostgreSQL",
  "Redis",
  "Anthropic Claude",
  "Corsair",
];

// ─────────────────────────────────────────────────────────────────────────

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-9 w-9 rounded-xl" aria-hidden />;
  }

  const isDark = resolvedTheme === "dark";

  function toggle() {
    // Instant switch without animation vectors
    setTheme(isDark ? "light" : "dark");
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

function Logomark({ size = 36 }: { size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl bg-accent text-white"
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none">
        <path
          d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="custom-page-scrollbar min-h-screen w-full bg-surface-0 text-text-primary overflow-x-hidden ">
      {/* Isolated scoped styling specifically for this dashboard view context */}
      <style jsx global>{`
        /* Webkit Engines (Chrome, Safari, Edge) */
        .custom-page-scrollbar::-webkit-scrollbar {
          width: 3px;
          height: 6px;
        }
        .custom-page-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-page-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(156, 163, 175, 0.3); /* Muted gray */
          border-radius: 20px;
        }
        .dark .custom-page-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.15); /* Light translucent white for dark interface */
        }
        .custom-page-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(156, 163, 175, 0.5);
        }
        .dark .custom-page-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(255, 255, 255, 0.25);
        }

        /* Firefox Support Engine configuration rules */
        .custom-page-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(156, 163, 175, 0.3) transparent;
        }
        .dark .custom-page-scrollbar {
          scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
        }
      `}</style>
      
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
        <nav className="flex w-full max-w-5xl items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/60 px-4 py-2.5 shadow-lg backdrop-blur-xl dark:border-white/5 dark:bg-black/40">
          <Link href="/" className="flex items-center gap-2.5">
            <Logomark size={30} />
            <span className="text-sm font-semibold tracking-super-tight text-text-primary">
              Super
            </span>
          </Link>

          <div className="hidden items-center gap-6 text-sm font-medium text-text-secondary sm:flex">
            <a href="#features" className="transition-colors hover:text-text-primary">
              Features
            </a>
            <a href="#how-it-works" className="transition-colors hover:text-text-primary">
              How it works
            </a>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/login"
              className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover shadow-md shadow-accent/10"
            >
              Sign in
            </Link>
          </div>
        </nav>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      {/* We use flex-col layout. Text elements stack comfortably high above the graphic, entirely eliminating overlaps */}
      <section
        className="relative min-h-[920px] w-full flex flex-col items-center justify-start text-center px-6 pt-36 bg-[url('/whiteBG.png')] dark:bg-[url('/BG.png')] bg-cover bg-center bg-no-repeat"
      >
        {/* Core Marketing Copy Stacked Perfectly Above */}
        <div className="relative z-10 max-w-3xl flex flex-col items-center">
          <p className="animate-fade-up text-xs font-bold uppercase tracking-super-wide text-accent bg-accent/10 px-3 py-1 rounded-full w-fit">
            AI-native inbox and calendar, not AI-summarized email
          </p>

          <h1 className="animate-fade-up w-[990px] mt-5 text-4xl font-semibold leading-[1.15] tracking-super-tight text-text-primary sm:text-5xl md:text-6xl drop-shadow-sm">
            Email and calendar that plan, draft, send, and schedule{" "} <span className="text-text-secondary font-medium">not just reads.</span>
          </h1>

          <p className="animate-fade-up mt-6 max-w-xl text-base leading-relaxed text-text-secondary">
            Super is a keyboard-fast inbox with an assistant that has real access to your
            Gmail and Calendar, triages every message as it lands, and never deletes
            anything without asking first.
          </p>
        </div>

        {/* Dynamic Spatial Spacer: This pushes your primary CTA actions underneath the main 3D asset cluster area */}
        <div className="h-[280px] sm:h-[320px] md:h-[360px] w-full pointer-events-none" aria-hidden="true" />

        {/* Bottom Panel Actions Container — Sitting perfectly below the central graphic asset */}
        <div className="relative z-20 w-full max-w-md flex flex-col items-center gap-4 px-4 pt-6">
          <div className="animate-fade-up flex flex-col sm:flex-row items-center gap-3 w-full justify-center">
            <Link
              href="/login"
              className="flex h-12 w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-accent px-6 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition-all hover:bg-accent-hover hover:scale-[1.02]"
            >
              Continue with Google
              <ArrowRight size={16} />
            </Link>
            <a
              href="#how-it-works"
              className="flex h-12 w-full sm:w-auto items-center justify-center rounded-xl border border-border bg-surface-1/90 px-6 text-sm font-medium text-text-primary backdrop-blur-md transition-colors hover:bg-surface-2"
            >
              See how it works
            </a>
          </div>
        </div>

        {/* Base blend fade out block */}
        <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-surface-0 to-transparent pointer-events-none" />
      </section>

      {/* ── Inbox preview (signature element) ──────────────────────────── */}
      <section className="relative z-30 mx-auto -mt-12 w-full max-w-4xl px-6">
        <div className="superhuman-shell-shadow overflow-hidden rounded-2xl border border-border bg-surface-1/90 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5 bg-surface-1/40">
            <span className="text-xs font-semibold uppercase tracking-super-wide text-text-tertiary">
              Live Inbox Preview
            </span>
            <span className="flex items-center gap-1.5 text-xxs font-medium text-text-secondary">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              Synced live
            </span>
          </div>

          <ul className="divide-y divide-border">
            {INBOX_PREVIEW.map((row) => (
              <li
                key={row.subject}
                className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2/40"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 border border-border text-xxs font-bold text-text-primary shadow-sm">
                  {row.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="truncate text-sm font-semibold text-text-primary">
                      {row.sender}
                    </span>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-xxs font-semibold tracking-wide uppercase"
                      style={{
                        background: `var(--tag-${row.tag}-bg)`,
                        color: `var(--tag-${row.tag}-text)`,
                      }}
                    >
                      {row.tag}
                    </span>
                  </div>
                  <p className="truncate text-xs text-text-secondary">{row.subject}</p>
                </div>
                <span className="shrink-0 text-xxs font-medium text-text-tertiary">{row.time}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────── */}
      <section id="features" className="mx-auto max-w-5xl px-6 py-32 relative z-10">
        <div className="mx-auto max-w-xl text-center">
          <p className="text-xs font-bold uppercase tracking-super-wide text-accent">
            Features
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-super-tight text-text-primary sm:text-4xl">
            Everything Super did fast plus an assistant with real hands.
          </h2>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, tag, title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-border bg-surface-1 p-6 transition-all hover:-translate-y-1 hover:shadow-md"
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl shadow-sm"
                style={{
                  background: `var(--tag-${tag}-bg)`,
                  color: `var(--tag-${tag}-text)`,
                }}
              >
                <Icon size={18} />
              </div>
              <h3 className="mt-5 text-base font-semibold text-text-primary">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section id="how-it-works" className="border-y border-border bg-surface-1/50 backdrop-blur-sm px-6 py-32 relative z-10">
        <div className="mx-auto max-w-5xl">
          <div className="mx-auto max-w-xl text-center">
            <p className="text-xs font-bold uppercase tracking-super-wide text-accent">
              How it works
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-super-tight text-text-primary sm:text-4xl">
              Three steps. No setup beyond signing in.
            </h2>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-10 md:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.n} className="relative pl-4 border-l-2 border-border focus-within:border-accent transition-colors">
                <span className="text-xs font-bold tracking-super-wide text-accent">
                  STEP {step.n}
                </span>
                <h3 className="mt-2 text-lg font-semibold text-text-primary">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Tech strip ──────────────────────────────────────────────────── */}
      <section className="px-6 py-16 relative z-10">
        <p className="text-center text-xs font-bold uppercase tracking-super-wide text-text-tertiary">
          Built with
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
          {STACK.map((name) => (
            <span key={name} className="text-sm font-semibold text-text-secondary tracking-tight bg-surface-1 px-3 py-1.5 rounded-lg border border-border/60">
              {name}
            </span>
          ))}
        </div>
      </section>

      {/* ── CTA band ────────────────────────────────────────────────────── */}
      <section className="px-6 py-24 relative z-10">
        <div className="mx-auto flex max-w-4xl flex-col items-center rounded-3xl border border-border bg-gradient-to-b from-surface-1 to-surface-1/40 px-8 py-16 text-center shadow-sm">
          <h2 className="text-3xl font-semibold tracking-super-tight text-text-primary sm:text-4xl">
            Stop triaging. Start delegating.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-text-secondary">
            Connect your Google account and let Super sort the noise from the next ten
            minutes of your day.
          </p>
          <Link
            href="/login"
            className="mt-8 flex h-12 items-center gap-2 rounded-xl bg-accent px-6 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition-all hover:bg-accent-hover hover:scale-[1.02]"
          >
            Continue with Google
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-border px-6 py-12 relative z-10 bg-surface-0">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <Logomark size={26} />
            <span className="text-sm font-semibold text-text-primary">Super</span>
          </div>
          <p className="text-xs text-text-tertiary">
            &copy; {new Date().getFullYear()} Super. Built in public.
          </p>
        </div>
      </footer>
    </div>
  );
}