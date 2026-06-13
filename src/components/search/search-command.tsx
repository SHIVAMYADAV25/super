"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api-client";
import type { SearchResult } from "@/src/types";
import { formatDistanceToNow } from "date-fns";

interface SearchCommandProps {
  onClose: () => void;
}

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

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
        isSelected ? "bg-surface-2" : "hover:bg-surface-1"
      }`}
    >
      <div
        className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
          result.type === "email" ? "bg-accent/20 text-accent" : "bg-success/20 text-success"
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

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="text-sm font-medium text-text-primary truncate">{result.title}</span>
          {date && <span className="text-xs text-text-tertiary shrink-0">{date}</span>}
        </div>
        {result.snippet && (
          <p className="text-xs text-text-tertiary truncate">{result.snippet}</p>
        )}
      </div>

      {result.relevanceScore !== undefined && (
        <div
          className="shrink-0 text-xs text-text-tertiary"
          title="Relevance score"
        >
          {Math.round(result.relevanceScore * 100)}%
        </div>
      )}
    </button>
  );
}

// Example prompts shown when input is empty
const SUGGESTIONS = [
  "project update",
  "meeting invite",
  "invoice",
  "follow up",
];

export function SearchCommand({ onClose }: SearchCommandProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce 300ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Reset selection when results change
  useEffect(() => setSelectedIndex(0), [debouncedQuery]);

  const { data, isLoading } = useQuery({
    queryKey: ["search", debouncedQuery],
    queryFn: () =>
      api.get<{ results: SearchResult[] }>(
        `/api/search?q=${encodeURIComponent(debouncedQuery)}&mode=both`,
      ),
    enabled: debouncedQuery.trim().length > 0,
    staleTime: 30_000,
  });

  const results = data?.results ?? [];

  const handleSelect = useCallback(
    (result: SearchResult) => {
      if (result.type === "email") {
        window.location.href = `/inbox?email=${result.id}`;
      }
      onClose();
    },
    [onClose],
  );

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && results[selectedIndex]) {
        handleSelect(results[selectedIndex]!);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [results, selectedIndex, handleSelect, onClose]);

  // Auto-focus input
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh] z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-surface-1 border border-border rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          {isLoading ? (
            <svg className="animate-spin h-4 w-4 text-text-tertiary shrink-0" viewBox="0 0 24 24" fill="none">
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
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emails and events..."
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none"
          />
          <kbd className="text-xs text-text-tertiary bg-surface-2 px-1.5 py-0.5 rounded border border-border">
            Esc
          </kbd>
        </div>

        {/* Results or suggestions */}
        <div className="max-h-80 overflow-y-auto">
          {!debouncedQuery && (
            <div className="px-4 pt-3 pb-1">
              <p className="text-xs text-text-tertiary mb-2">Try searching for</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setQuery(s)}
                    className="px-2.5 py-1 rounded-lg bg-surface-2 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-colors border border-border"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {debouncedQuery && results.length === 0 && !isLoading && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-text-secondary">
                No results for <span className="text-text-primary">"{debouncedQuery}"</span>
              </p>
              <p className="text-xs text-text-tertiary mt-1">
                Try different keywords or a broader search term
              </p>
            </div>
          )}

          {results.map((result, index) => (
            <ResultItem
              key={result.id}
              result={result}
              isSelected={index === selectedIndex}
              onClick={() => handleSelect(result)}
            />
          ))}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-border flex items-center gap-4 text-xs text-text-tertiary">
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>Esc close</span>
          </div>
        )}
      </div>
    </div>
  );
}