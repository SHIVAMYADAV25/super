"use client";

/**
 * Gmail Advanced Search Builder
 *
 * Lets users build Gmail's advanced search operators (from:, to:, subject:,
 * has:attachment, is:unread, after:/before:, larger:, label:) through a
 * structured form, instead of requiring them to memorize Gmail syntax.
 *
 * The generated query string is passed straight through to /api/search
 * (mode=text), which forwards `q` to Corsair's tenant.gmail.api.messages.list
 * — Gmail's own search engine does the heavy lifting.
 */

import { useState, useMemo } from "react";

export interface GmailQueryFilters {
  from: string;
  to: string;
  subject: string;
  hasAttachment: boolean;
  isUnread: boolean;
  isStarred: boolean;
  after: string;  // YYYY-MM-DD
  before: string; // YYYY-MM-DD
  largerThanMb: string; // numeric string, e.g. "5"
  label: string;
  keywords: string; // freeform terms appended at the end
}

export const EMPTY_FILTERS: GmailQueryFilters = {
  from: "",
  to: "",
  subject: "",
  hasAttachment: false,
  isUnread: false,
  isStarred: false,
  after: "",
  before: "",
  largerThanMb: "",
  label: "",
  keywords: "",
};

/**
 * Build a Gmail search query string from structured filters.
 * Mirrors Gmail's advanced search operators exactly:
 * https://support.google.com/mail/answer/7190
 */
export function buildGmailQuery(filters: GmailQueryFilters): string {
  const parts: string[] = [];

  if (filters.from.trim()) parts.push(`from:${filters.from.trim()}`);
  if (filters.to.trim()) parts.push(`to:${filters.to.trim()}`);
  if (filters.subject.trim()) {
    const subj = filters.subject.trim();
    // Quote multi-word subjects so Gmail treats it as one phrase
    parts.push(subj.includes(" ") ? `subject:"${subj}"` : `subject:${subj}`);
  }
  if (filters.hasAttachment) parts.push("has:attachment");
  if (filters.isUnread) parts.push("is:unread");
  if (filters.isStarred) parts.push("is:starred");
  if (filters.after.trim()) parts.push(`after:${filters.after.trim().replace(/-/g, "/")}`);
  if (filters.before.trim()) parts.push(`before:${filters.before.trim().replace(/-/g, "/")}`);
  if (filters.largerThanMb.trim()) parts.push(`larger:${filters.largerThanMb.trim()}M`);
  if (filters.label.trim()) parts.push(`label:${filters.label.trim()}`);
  if (filters.keywords.trim()) parts.push(filters.keywords.trim());

  return parts.join(" ");
}

/** Returns true if any filter field is non-empty */
export function hasActiveFilters(filters: GmailQueryFilters): boolean {
  return Object.entries(filters).some(([key, val]) =>
    typeof val === "boolean" ? val : val.trim().length > 0,
  );
}

interface GmailQueryBuilderProps {
  filters: GmailQueryFilters;
  onChange: (filters: GmailQueryFilters) => void;
  onApply: () => void;
}

function TextField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-tertiary">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent/40 transition-colors"
      />
    </label>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-tertiary">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent/40 transition-colors"
      />
    </label>
  );
}

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
        active
          ? "bg-accent/10 border-accent/30 text-accent"
          : "bg-surface-2 border-border text-text-tertiary hover:text-text-secondary"
      }`}
    >
      {label}
    </button>
  );
}

export function GmailQueryBuilder({ filters, onChange, onApply }: GmailQueryBuilderProps) {
  const preview = useMemo(() => buildGmailQuery(filters), [filters]);

  function set<K extends keyof GmailQueryFilters>(key: K, value: GmailQueryFilters[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="px-4 py-3 border-b border-border space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="From"
          placeholder="alice@company.com"
          value={filters.from}
          onChange={(v) => set("from", v)}
        />
        <TextField
          label="To"
          placeholder="me@company.com"
          value={filters.to}
          onChange={(v) => set("to", v)}
        />
        <TextField
          label="Subject contains"
          placeholder="invoice, meeting..."
          value={filters.subject}
          onChange={(v) => set("subject", v)}
        />
        <TextField
          label="Label"
          placeholder="work, important..."
          value={filters.label}
          onChange={(v) => set("label", v)}
        />
        <DateField label="After" value={filters.after} onChange={(v) => set("after", v)} />
        <DateField label="Before" value={filters.before} onChange={(v) => set("before", v)} />
        <TextField
          label="Larger than (MB)"
          placeholder="5"
          value={filters.largerThanMb}
          onChange={(v) => set("largerThanMb", v.replace(/[^0-9]/g, ""))}
        />
        <TextField
          label="Also match keywords"
          placeholder="project update"
          value={filters.keywords}
          onChange={(v) => set("keywords", v)}
        />
      </div>

      <div className="flex items-center gap-2">
        <ToggleChip
          label="Has attachment"
          active={filters.hasAttachment}
          onClick={() => set("hasAttachment", !filters.hasAttachment)}
        />
        <ToggleChip
          label="Unread"
          active={filters.isUnread}
          onClick={() => set("isUnread", !filters.isUnread)}
        />
        <ToggleChip
          label="Starred"
          active={filters.isStarred}
          onClick={() => set("isStarred", !filters.isStarred)}
        />
      </div>

      {/* Live query preview */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-text-tertiary mb-0.5">Gmail query</p>
          <p className="text-xs font-mono text-text-secondary truncate">
            {preview || "(no filters set)"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!preview}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}