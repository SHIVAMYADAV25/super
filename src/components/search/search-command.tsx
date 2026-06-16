"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api-client";
import type { SearchResult } from "@/src/types";
import { formatDistanceToNow } from "date-fns";
import {
  GmailQueryBuilder,
  EMPTY_FILTERS,
  buildGmailQuery,
  type GmailQueryFilters,
} from "./gmail-query-builder";

interface SearchCommandProps {
  onClose: () => void;
  onSelectEmail?: (gmailId: string) => void;
}

// ─── Result row ───────────────────────────────────────────────────────────────

function ResultItem({
  result,
  isSelected,
  onClick,
}: {
  result: SearchResult;
  isSelected: boolean;
  onClick: () => void;
}) {
  const date = result.date
    ? formatDistanceToNow(new Date(result.date), { addSuffix: true })
    : "";

  const score =
    result.relevanceScore !== undefined
      ? Math.round(result.relevanceScore * 100)
      : null;

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
        isSelected ? "bg-surface-2" : "hover:bg-surface-1"
      }`}
    >
      {/* Type icon */}
      <div
        className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
          result.type === "email"
            ? "bg-accent/15 text-accent"
            : "bg-emerald-500/15 text-emerald-500"
        }`}
      >
        {result.type === "email" ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Subject + date */}
        <div className="flex items-start justify-between gap-2 mb-0.5">
          <span
            className={`text-sm font-medium truncate ${
              result.title === "(loading...)"
                ? "text-text-tertiary italic"
                : "text-text-primary"
            }`}
          >
            {result.title === "(loading...)" ? "Loading..." : result.title}
          </span>
          {date && (
            <span className="text-[11px] text-text-tertiary shrink-0 font-mono">
              {date}
            </span>
          )}
        </div>

        {/* Sender (subtitle) */}
        {result.subtitle && (
          <p className="text-[11px] text-text-secondary truncate mb-0.5 font-medium">
            {/* Extract display name from "Name <email>" format */}
            {result.subtitle.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim() ??
              result.subtitle}
          </p>
        )}

        {/* Snippet */}
        {result.snippet && (
          <p className="text-xs text-text-tertiary truncate">{result.snippet}</p>
        )}
      </div>

      {/* Relevance badge */}
      {score !== null && (
        <div
          className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded-md ${
            score >= 80
              ? "bg-emerald-500/10 text-emerald-500"
              : score >= 50
                ? "bg-accent/10 text-accent"
                : "bg-surface-2 text-text-tertiary"
          }`}
          title="Relevance score"
        >
          {score}%
        </div>
      )}
    </button>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="w-5 h-5 rounded-md bg-surface-2 animate-pulse shrink-0 mt-0.5" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3.5 bg-surface-2 rounded animate-pulse w-3/4" />
        <div className="h-2.5 bg-surface-2 rounded animate-pulse w-1/2" />
        <div className="h-2.5 bg-surface-2 rounded animate-pulse w-5/6" />
      </div>
    </div>
  );
}

// ─── Suggestions ─────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  { label: "Unread emails", query: "is:unread" },
  { label: "Has attachment", query: "has:attachment" },
  { label: "Starred", query: "is:starred" },
  { label: "From Google", query: "from:google.com" },
  { label: "Invoices", query: "invoice" },
  { label: "Meetings", query: "meeting" },
];

// ─── SearchCommand ────────────────────────────────────────────────────────────

export function SearchCommand({ onClose, onSelectEmail }: SearchCommandProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState<GmailQueryFilters>(EMPTY_FILTERS);
  const [advancedQuery, setAdvancedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce 300ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => setSelectedIndex(0), [debouncedQuery, advancedQuery]);

  // When advanced search is active, use "text" mode (Gmail operators);
  // otherwise use "both" (hybrid text + semantic).
  const effectiveQuery = advancedQuery || debouncedQuery;
  const effectiveMode = advancedQuery ? "text" : "both";
  const shouldSearch = effectiveQuery.trim().length > 0;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["search", effectiveQuery, effectiveMode],
    queryFn: () =>
      api.get<{ results: SearchResult[] }>(
        `/api/search?q=${encodeURIComponent(effectiveQuery)}&mode=${effectiveMode}&limit=20`,
      ),
    enabled: shouldSearch,
    staleTime: 30_000,
  });

  const results = data?.results ?? [];
  const showSpinner = shouldSearch && (isLoading || isFetching);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      if (result.type === "email") {
        if (onSelectEmail) {
          onSelectEmail(result.id);
        } else {
          // Fallback: navigate to inbox with email open
          window.location.href = `/inbox?email=${result.id}`;
        }
      }
      onClose();
    },
    [onClose, onSelectEmail],
  );

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, results.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
      if (e.key === "Enter" && results[selectedIndex]) handleSelect(results[selectedIndex]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [results, selectedIndex, handleSelect, onClose]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  const applyAdvanced = () => {
    const built = buildGmailQuery(advancedFilters);
    if (!built) return;
    setAdvancedQuery(built);
    setQuery(built);
    setShowAdvanced(false);
  };

  const clearAdvanced = () => {
    setAdvancedQuery("");
    setAdvancedFilters(EMPTY_FILTERS);
    setQuery("");
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh] z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-surface-1 border border-border rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Input bar ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          {showSpinner ? (
            <svg className="animate-spin h-4 w-4 text-accent shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary shrink-0">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" strokeLinecap="round" />
            </svg>
          )}

          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (advancedQuery) setAdvancedQuery("");
            }}
            placeholder={
              advancedQuery
                ? "Advanced filters active — edit below to override"
                : "Search by sender, subject, keywords..."
            }
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none"
          />

          {/* Advanced filter toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            title="Advanced filters"
            className={`p-1.5 rounded-lg transition-colors ${
              showAdvanced || advancedQuery
                ? "bg-accent/10 text-accent"
                : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="6" x2="20" y2="6" strokeLinecap="round" />
              <line x1="4" y1="12" x2="14" y2="12" strokeLinecap="round" />
              <line x1="4" y1="18" x2="10" y2="18" strokeLinecap="round" />
              <circle cx="18" cy="12" r="2" />
              <circle cx="14" cy="18" r="2" />
            </svg>
          </button>

          <kbd className="text-xs text-text-tertiary bg-surface-2 px-1.5 py-0.5 rounded border border-border">
            Esc
          </kbd>
        </div>

        {/* ── Advanced builder ───────────────────────────────────────────────── */}
        {showAdvanced && (
          <GmailQueryBuilder
            filters={advancedFilters}
            onChange={setAdvancedFilters}
            onApply={applyAdvanced}
          />
        )}

        {/* ── Active advanced query banner ───────────────────────────────────── */}
        {advancedQuery && !showAdvanced && (
          <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-accent/5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-accent font-bold shrink-0">
                Advanced
              </span>
              <p className="text-xs font-mono text-text-secondary truncate">{advancedQuery}</p>
            </div>
            <button
              type="button"
              onClick={clearAdvanced}
              className="text-xs text-text-tertiary hover:text-text-secondary shrink-0 transition-colors"
            >
              Clear
            </button>
          </div>
        )}

        {/* ── Results / skeleton / suggestions ──────────────────────────────── */}
        <div className="max-h-[400px] overflow-y-auto custom-thin-scrollbar">

          {/* Initial loading skeleton */}
          {isLoading && shouldSearch && (
            <div>
              {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && shouldSearch && results.length === 0 && (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-text-secondary">
                No results for{" "}
                <span className="text-text-primary font-medium">"{effectiveQuery}"</span>
              </p>
              <p className="text-xs text-text-tertiary mt-1.5">
                {advancedQuery
                  ? "Try relaxing some of the filters above"
                  : "Try different keywords, a sender name, or use advanced filters"}
              </p>
            </div>
          )}

          {/* Suggestions when idle */}
          {!shouldSearch && !showAdvanced && (
            <div className="px-4 pt-4 pb-3">
              <p className="text-xs text-text-tertiary mb-2.5 font-medium">Suggestions</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.query}
                    onClick={() => { setQuery(s.query); setDebouncedQuery(s.query); }}
                    className="px-2.5 py-1 rounded-lg bg-surface-2 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-colors border border-border"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Result rows */}
          {!isLoading && results.length > 0 &&
            results.map((result, index) => (
              <ResultItem
                key={result.id}
                result={result}
                isSelected={index === selectedIndex}
                onClick={() => handleSelect(result)}
              />
            ))}
        </div>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-border flex items-center justify-between text-xs text-text-tertiary">
            <div className="flex items-center gap-4">
              <span>↑↓ navigate</span>
              <span>↵ open</span>
              <span>Esc close</span>
            </div>
            <span className="font-mono opacity-60">
              {results.length} result{results.length !== 1 ? "s" : ""}
              {effectiveMode === "text" ? " · text" : " · hybrid"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}