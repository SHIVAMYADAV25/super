"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X, Plus, Clock, MapPin, Users, Check, AlertCircle } from "lucide-react";

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface Attendee {
  email: string;
  responseStatus: "needsAction" | "accepted" | "declined" | "tentative";
}

interface CalendarEvent {
  id: string;
  userId: string;
  gcalId: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  startTime: string;
  endTime: string;
  startTimeZone?: string | null;
  endTimeZone?: string | null;
  attendees: Attendee[];
  status: string;
  htmlLink?: string | null;
  createdAt: string;
  // UI-only field derived from summary keyword matching or stored on creation
  calendar?: string;
}

interface ApiResponse<T> {
  ok: boolean;
  data: T;
}

interface CreateEventPayload {
  summary: string;
  description?: string;
  location?: string;
  startTime: string;     // ISO string
  endTime: string;       // ISO string
  timeZone: string;
  attendees?: Attendee[];
  recurrence?: string[];
  calendarType : string;
}

interface UpdateEventPayload {
  summary?: string;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  timeZone?: string;
  attendees?: Attendee[];
}

interface CreateEventResponse {
  event: CalendarEvent;
  conflicts: CalendarEvent[];
}

type RSVPStatus = "accepted" | "declined" | "tentative" | "needsAction";

interface CalendarType {
  label: string;
  color: string;
  darkBg: string;
  darkText: string;
  lightBg: string;
  lightText: string;
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const HOURS: number[] = Array.from({ length: 15 }, (_, i) => i + 6); // 6 AM to 8 PM

const CALENDAR_TYPES: CalendarType[] = [
  { label: "Work",      color: "#3b82f6", darkBg: "#314b9b", darkText: "#eef3ff", lightBg: "#e8edfb", lightText: "#283A71" },
  { label: "Personal",  color: "#eb2560", darkBg: "#a73d72", darkText: "#fff0f6", lightBg: "#f9e2ec", lightText: "#cf3f79" },
  { label: "Meetings",  color: "#22c55e", darkBg: "#3f7c59", darkText: "#eefdf4", lightBg: "#e5f4e9", lightText: "#2f8a57" },
  { label: "Study",     color: "#eab308", darkBg: "#9a7a2e", darkText: "#fff9e7", lightBg: "#f8f0c9", lightText: "#b68618" },
  { label: "Deadlines", color: "#9333ea", darkBg: "#7352a7", darkText: "#f7f0ff", lightBg: "#efe5fb", lightText: "#8a4ed6" },
];

// Keywords used to auto-assign a calendar type to events coming from the backend
// (backend doesn't store `calendar` field — we derive it from summary keywords)
const KEYWORD_MAP: Record<string, string> = {
  workout:   "Work",
  standup:   "Meetings",
  "1:1":     "Meetings",
  sync:      "Meetings",
  meeting:   "Meetings",
  call:      "Meetings",
  review:    "Meetings",
  kickoff:   "Meetings",
  learn:     "Study",
  study:     "Study",
  docs:      "Study",
  deadline:  "Deadlines",
  planning:  "Personal",
  lunch:     "Work",
  wrap:      "Work",
  focus:     "Meetings",
  community: "Personal",
  event:     "Personal",
};

function inferCalendar(summary: string): string {
  const lower = summary.toLowerCase();
  for (const [key, cal] of Object.entries(KEYWORD_MAP)) {
    if (lower.includes(key)) return cal;
  }
  return "Work";
}

// ─── API LAYER ───────────────────────────────────────────────────────────────
// All routes wired to the backend endpoints described in routes.

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err?.message ?? `Request failed: ${res.status}`);
  }
  const json = await res.json();
  // Backend wraps in { ok, data } — unwrap if present
  return (json?.data !== undefined ? json.data : json) as T;
}

// GET /api/calendar/events?from=&to=&q=&maxResult=
function useListEvents(from: string, to: string) {
  return useQuery<CalendarEvent[]>({
    queryKey: ["events", from, to],
    queryFn: async () => {
      const params = new URLSearchParams({ from, to });
      const raw = await apiFetch<CalendarEvent[] | { data: CalendarEvent[] }>(
        `/api/calendar/events?${params}`
      );
      const arr = Array.isArray(raw) ? raw : (raw as any)?.data ?? [];
      // Attach inferred calendar label for UI colour mapping
      return arr.map((e: CalendarEvent) => ({
        ...e,
        calendar: inferCalendar(e.summary),
      }));
    },
    staleTime: 30_000,
  });
}

// GET /api/calendar/events/[id]
async function fetchEvent(id: string): Promise<CalendarEvent> {
  return apiFetch<CalendarEvent>(`/api/calendar/events/${id}`);
}

// POST /api/calendar/events
async function createEventApi(payload: CreateEventPayload): Promise<CreateEventResponse> {
  return apiFetch<CreateEventResponse>("/api/calendar/events", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// PATCH /api/calendar/events/[id]
async function updateEventApi(id: string, payload: UpdateEventPayload): Promise<CalendarEvent> {
  return apiFetch<CalendarEvent>(`/api/calendar/events/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// DELETE /api/calendar/events/[id]
async function deleteEventApi(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/api/calendar/events/${id}`, {
    method: "DELETE",
  });
}

// POST /api/calendar/events/[id]/rsvp
async function rsvpEventApi(id: string, status: RSVPStatus): Promise<CalendarEvent> {
  return apiFetch<CalendarEvent>(`/api/calendar/events/${id}/rsvp`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatHour(h: number): string {
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function isSameDay(a: string | Date, b: string | Date): boolean {
  const da = new Date(a), db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function fmt(date: string | Date, pattern: string): string {
  const d = new Date(date);
  const DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const SDAYS  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const SMONTH = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return pattern
    .replace("MMMM", MONTHS[d.getMonth()])
    .replace("MMM",  SMONTH[d.getMonth()])
    .replace("MM",   String(d.getMonth() + 1).padStart(2, "0"))
    .replace("EEEE", DAYS[d.getDay()])
    .replace("EEE",  SDAYS[d.getDay()])
    .replace("yyyy", String(d.getFullYear()))
    .replace("dd",   String(d.getDate()).padStart(2, "0"))
    .replace("d",    String(d.getDate()))
    .replace("HH",   String(d.getHours()).padStart(2, "0"))
    .replace("mm",   String(d.getMinutes()).padStart(2, "0"))
    .replace("h",    String(d.getHours() > 12 ? d.getHours() - 12 : d.getHours() || 12))
    .replace("a",    d.getHours() >= 12 ? "PM" : "AM");
}

function getCalendarStyle(calLabel: string, dark: boolean): { background: string; color: string } {
  const cal = CALENDAR_TYPES.find(c => c.label === calLabel) ?? CALENDAR_TYPES[0];
  return dark
    ? { background: cal.darkBg, color: cal.darkText }
    : { background: cal.lightBg, color: cal.lightText };
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1;
}

function toLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── MINI CALENDAR ───────────────────────────────────────────────────────────

interface MiniCalendarProps {
  current: Date;
  onSelectWeek: (d: Date) => void;
  dark: boolean;
}

function MiniCalendar({ current, onSelectWeek, dark }: MiniCalendarProps) {
  const [view, setView] = useState(new Date(current));
  const year  = view.getFullYear();
  const month = view.getMonth();
  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const cells: (Date | null)[] = [];
  for (let i = 0; i < getFirstDayOfMonth(year, month); i++) cells.push(null);
  for (let d = 1; d <= getDaysInMonth(year, month); d++) cells.push(new Date(year, month, d));

  const today = new Date();

  return (
    <div style={{ padding: "0 4px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: dark ? "#9ca3af" : "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "monospace" }}>
          {MONTH_NAMES[month]} {year}
        </span>
        <div style={{ display: "flex", gap: 2 }}>
          <button onClick={() => setView(v => { const n = new Date(v); n.setMonth(n.getMonth() - 1); return n; })}
            style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#6b7280" : "#9ca3af", padding: "2px 3px", borderRadius: 4, fontSize: 12, lineHeight: 1 }}>‹</button>
          <button onClick={() => setView(v => { const n = new Date(v); n.setMonth(n.getMonth() + 1); return n; })}
            style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#6b7280" : "#9ca3af", padding: "2px 3px", borderRadius: 4, fontSize: 12, lineHeight: 1 }}>›</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px 0", textAlign: "center" }}>
        {["M","T","W","T","F","S","S"].map((d, i) => (
          <span key={i} style={{ fontSize: 9, fontWeight: 700, color: dark ? "#4b5563" : "#9ca3af", fontFamily: "monospace", paddingBottom: 3 }}>{d}</span>
        ))}
        {cells.map((day, i) => {
          if (!day) return <span key={i} />;
          const isToday = isSameDay(day, today);
          const ws = startOfWeek(current);
          const we = addDays(ws, 6);
          const isInCurrentWeek = day >= ws && day <= we;
          return (
            <span key={i} onClick={() => onSelectWeek(startOfWeek(day))} style={{
              fontSize: 10, fontFamily: "monospace", cursor: "pointer", borderRadius: "50%",
              width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1px",
              background: isToday ? "#eb2560" : isInCurrentWeek ? (dark ? "rgba(59,130,246,0.15)" : "rgba(59,130,246,0.1)") : "transparent",
              color: isToday ? "#fff" : isInCurrentWeek ? "#3b82f6" : dark ? "#9ca3af" : "#6b7280",
              fontWeight: isInCurrentWeek || isToday ? 700 : 400,
            }}>{day.getDate()}</span>
          );
        })}
      </div>
    </div>
  );
}

// ─── UPCOMING EVENTS ─────────────────────────────────────────────────────────

interface UpcomingEventsProps {
  events: CalendarEvent[];
  dark: boolean;
}

function UpcomingEvents({ events, dark }: UpcomingEventsProps) {
  const now      = new Date();
  const today    = new Date();
  const tomorrow = addDays(today, 1);

  const upcoming = [...events]
    .filter(e => new Date(e.startTime) >= now)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(0, 4);

  function relativeDay(dt: Date): string {
    if (isSameDay(dt, today))    return "Today";
    if (isSameDay(dt, tomorrow)) return "Tomorrow";
    return fmt(dt, "EEE, MMM d");
  }

  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: dark ? "#4b5563" : "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "monospace", marginBottom: 8, paddingLeft: 1 }}>
        Upcoming
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {upcoming.map(e => {
          const cal   = CALENDAR_TYPES.find(c => c.label === e.calendar) ?? CALENDAR_TYPES[0];
          const start = new Date(e.startTime);
          const end   = new Date(e.endTime);
          return (
            <div key={e.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: cal.color, marginTop: 4, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: dark ? "#f3f4f6" : "#111112", lineHeight: 1.3 }}>{e.summary}</div>
                <div style={{ fontSize: 11, color: dark ? "#6b7280" : "#9ca3af", marginTop: 1 }}>
                  {relativeDay(start)}, {fmt(start, "h:mm")} – {fmt(end, "h:mm a")}
                </div>
              </div>
            </div>
          );
        })}
        {upcoming.length === 0 && (
          <div style={{ fontSize: 12, color: dark ? "#4b5563" : "#9ca3af", fontStyle: "italic" }}>No upcoming events</div>
        )}
      </div>
    </div>
  );
}

// ─── EVENT DETAIL MODAL ──────────────────────────────────────────────────────

interface EventDetailProps {
  event: CalendarEvent;
  dark: boolean;
  onClose: () => void;
  onDeleted: (id: string) => void;
  onRsvp: (id: string, status: RSVPStatus) => void;
}

function EventDetail({ event, dark, onClose, onDeleted, onRsvp }: EventDetailProps) {
  const queryClient = useQueryClient();
  const cal   = CALENDAR_TYPES.find(c => c.label === event.calendar) ?? CALENDAR_TYPES[0];
  const start = new Date(event.startTime);
  const end   = new Date(event.endTime);

  const deleteMutation = useMutation({
    mutationFn: () => deleteEventApi(event.gcalId || event.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      onDeleted(event.id);
      onClose();
    },
  });

  const rsvpMutation = useMutation({
    mutationFn: (status: RSVPStatus) => rsvpEventApi(event.gcalId || event.id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      onClose();
    },
  });

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, backdropFilter: "blur(4px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? "#1d1d1d" : "#fdf8f8", border: `1px solid ${dark ? "#27292f" : "#e5e7eb"}`, borderRadius: 16, padding: "20px 22px", width: 320, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: cal.color, flexShrink: 0, marginTop: 2 }} />
            <h3 style={{ fontSize: 15, fontWeight: 700, color: dark ? "#f3f4f6" : "#111112", margin: 0, lineHeight: 1.3 }}>{event.summary}</h3>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#6b7280" : "#9ca3af", padding: 0, lineHeight: 1 }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ borderTop: `1px solid ${dark ? "#27292f" : "#e5e7eb"}`, paddingTop: 12, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Clock size={13} color={dark ? "#6b7280" : "#9ca3af"} />
            <span style={{ fontSize: 12, color: dark ? "#9ca3af" : "#4b5563" }}>{fmt(start, "EEEE, MMMM d")}</span>
          </div>
          <div style={{ fontSize: 12, color: dark ? "#6b7280" : "#9ca3af", paddingLeft: 21, fontFamily: "monospace" }}>
            {fmt(start, "h:mm a")} – {fmt(end, "h:mm a")}
          </div>

          {event.location && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <MapPin size={13} color={dark ? "#6b7280" : "#9ca3af"} />
              <span style={{ fontSize: 12, color: dark ? "#9ca3af" : "#4b5563" }}>{event.location}</span>
            </div>
          )}

          {event.attendees?.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <Users size={13} color={dark ? "#6b7280" : "#9ca3af"} />
              <span style={{ fontSize: 11, color: dark ? "#6b7280" : "#9ca3af" }}>
                {event.attendees.map(a => a.email).join(", ")}
              </span>
            </div>
          )}

          {event.description && (
            <div style={{ marginTop: 8, fontSize: 12, color: dark ? "#6b7280" : "#9ca3af", lineHeight: 1.5 }}>
              {event.description}
            </div>
          )}

          <div style={{ marginTop: 10, paddingLeft: 0 }}>
            <span style={{
              fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 600,
              background: getCalendarStyle(event.calendar ?? "Work", dark).background,
              color: getCalendarStyle(event.calendar ?? "Work", dark).color,
            }}>{event.calendar ?? "Work"}</span>
          </div>
        </div>

        {/* RSVP buttons — POST /api/calendar/events/[id]/rsvp */}
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button
            onClick={() => rsvpMutation.mutate("confirmed")}
            disabled={rsvpMutation.isPending}
            style={{ flex: 1, padding: "6px 0", borderRadius: 8, fontSize: 11, fontWeight: 700, border: "1px solid rgba(34,197,94,0.3)", color: "#22c55e", background: "transparent", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Accept
          </button>
          <button
            onClick={() => rsvpMutation.mutate("tentative")}
            disabled={rsvpMutation.isPending}
            style={{ flex: 1, padding: "6px 0", borderRadius: 8, fontSize: 11, fontWeight: 700, border: "1px solid rgba(234,179,8,0.3)", color: "#eab308", background: "transparent", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Maybe
          </button>
          <button
            onClick={() => rsvpMutation.mutate("cancelled")}
            disabled={rsvpMutation.isPending}
            style={{ flex: 1, padding: "6px 0", borderRadius: 8, fontSize: 11, fontWeight: 700, border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", background: "transparent", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Decline
          </button>
        </div>

        {/* DELETE — DELETE /api/calendar/events/[id] */}
        <button
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
          style={{ width: "100%", padding: "7px 0", borderRadius: 8, fontSize: 12, fontWeight: 600, border: `1px solid ${dark ? "#27292f" : "#e5e7eb"}`, color: dark ? "#6b7280" : "#9ca3af", background: "transparent", cursor: "pointer" }}>
          {deleteMutation.isPending ? "Deleting…" : "Delete event"}
        </button>

        {(deleteMutation.isError || rsvpMutation.isError) && (
          <div style={{ marginTop: 8, fontSize: 11, color: "#ef4444", display: "flex", alignItems: "center", gap: 4 }}>
            <AlertCircle size={12} /> {(deleteMutation.error as Error)?.message ?? (rsvpMutation.error as Error)?.message}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CREATE EVENT MODAL ──────────────────────────────────────────────────────

interface CreateEventModalProps {
  dark: boolean;
  onClose: () => void;
  onCreated: (e: CalendarEvent) => void;
  defaultDate?: Date | null;
}

function CreateEventModal({ dark, onClose, onCreated, defaultDate }: CreateEventModalProps) {
  const queryClient = useQueryClient();
  const now        = defaultDate ?? new Date();
  const rounded    = new Date(Math.ceil(now.getTime() / (30 * 60_000)) * (30 * 60_000));
  const roundedEnd = new Date(rounded.getTime() + 60 * 60_000);

  const [summary,     setSummary]     = useState("");
  const [calType,     setCalType]     = useState("Work");
  const [startTime,   setStartTime]   = useState(toLocal(rounded));
  const [endTime,     setEndTime]     = useState(toLocal(roundedEnd));
  const [location,    setLocation]    = useState("");
  const [description, setDescription] = useState("");
  const [error,       setError]       = useState("");

  const inputStyle: React.CSSProperties = {
    width: "100%", background: dark ? "#242429" : "#ecedee",
    border: `1px solid ${dark ? "#27292f" : "#e5e7eb"}`,
    borderRadius: 8, padding: "8px 12px", fontSize: 13,
    color: dark ? "#f3f4f6" : "#111112", outline: "none", boxSizing: "border-box",
    fontFamily: "inherit",
  };

  // POST /api/calendar/events
  const createMutation = useMutation({
    mutationFn: (payload: CreateEventPayload) => createEventApi(payload),
    onSuccess: ({ event, conflicts }) => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      // Attach inferred calendar for immediate UI use
      onCreated({ ...event, calendar: calType });
      // console.log({ ...event, calendar: calType })
      if (conflicts.length > 0) {
        // Non-blocking conflict warning — just log; can be surfaced in a toast if needed
        console.warn("Scheduling conflicts:", conflicts.map(c => c.summary).join(", "));
      }
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!summary.trim()) { setError("Title is required"); return; }
    setError("");
    createMutation.mutate({
      summary: summary.trim(),
      description: description || undefined,
      location: location || undefined,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      calendarType:calType,
      attendees: [],
    });
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, backdropFilter: "blur(4px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? "#1d1d1d" : "#fdf8f8", border: `1px solid ${dark ? "#27292f" : "#e5e7eb"}`, borderRadius: 16, padding: "22px 24px", width: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: dark ? "#f3f4f6" : "#111112", margin: 0 }}>New Event</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#6b7280" : "#9ca3af" }}><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input value={summary} onChange={e => setSummary(e.target.value)} placeholder="Event title *" style={inputStyle} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{width:"185px"}}>
              <label style={{ fontSize: 11, color: dark ? "#6b7280" : "#9ca3af", display: "block", marginBottom: 4, fontWeight: 600 }}>Start</label>
              <input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} style={inputStyle} />
            </div>
            <div style={{width:"185px"}}>
              <label style={{ fontSize: 11, color: dark ? "#6b7280" : "#9ca3af", display: "block", marginBottom: 4, fontWeight: 600 }}>End</label>
              <input type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, color: dark ? "#6b7280" : "#9ca3af", display: "block", marginBottom: 6, fontWeight: 600 }}>Calendar</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {CALENDAR_TYPES.map(c => (
                <button key={c.label} type="button" onClick={() => setCalType(c.label)} style={{
                  padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  border: calType === c.label ? `2px solid ${c.color}` : `1px solid ${dark ? "#27292f" : "#e5e7eb"}`,
                  background: calType === c.label ? (dark ? c.darkBg : c.lightBg) : "transparent",
                  color: calType === c.label ? (dark ? c.darkText : c.lightText) : dark ? "#9ca3af" : "#6b7280",
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.color }} />
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Location (optional)" style={inputStyle} />
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} style={{ ...inputStyle, resize: "none" }} />

          {error && (
            <div style={{ fontSize: 12, color: "#ef4444", display: "flex", alignItems: "center", gap: 4 }}>
              <AlertCircle size={12} /> {error}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "transparent", border: `1px solid ${dark ? "#27292f" : "#e5e7eb"}`, color: dark ? "#9ca3af" : "#6b7280", cursor: "pointer" }}>Cancel</button>
            <button type="submit" disabled={createMutation.isPending} style={{ padding: "8px 20px", borderRadius: 8, fontSize: 12, fontWeight: 700, background: "#eb2560", border: "none", color: "#fff", cursor: "pointer", opacity: createMutation.isPending ? 0.7 : 1 }}>
              {createMutation.isPending ? "Creating…" : "Create Event"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── EDIT EVENT MODAL ────────────────────────────────────────────────────────

interface EditEventModalProps {
  event: CalendarEvent;
  dark: boolean;
  onClose: () => void;
  onUpdated: (e: CalendarEvent) => void;
}

function EditEventModal({ event, dark, onClose, onUpdated }: EditEventModalProps) {
  const queryClient = useQueryClient();
  const [summary,     setSummary]     = useState(event.summary);
  const [startTime,   setStartTime]   = useState(toLocal(new Date(event.startTime)));
  const [endTime,     setEndTime]     = useState(toLocal(new Date(event.endTime)));
  const [location,    setLocation]    = useState(event.location ?? "");
  const [description, setDescription] = useState(event.description ?? "");
  const [error,       setError]       = useState("");

  const inputStyle: React.CSSProperties = {
    width: "100%", background: dark ? "#242429" : "#ecedee",
    border: `1px solid ${dark ? "#27292f" : "#e5e7eb"}`,
    borderRadius: 8, padding: "8px 12px", fontSize: 13,
    color: dark ? "#f3f4f6" : "#111112", outline: "none", boxSizing: "border-box", fontFamily: "inherit",
  };

  // PATCH /api/calendar/events/[id]
  const updateMutation = useMutation({
    mutationFn: (payload: UpdateEventPayload) => updateEventApi(event.gcalId || event.id, payload),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      onUpdated({ ...updated, calendar: event.calendar });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!summary.trim()) { setError("Title is required"); return; }
    setError("");
    updateMutation.mutate({
      summary: summary.trim(),
      description: description || undefined,
      location: location || undefined,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 101, backdropFilter: "blur(4px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? "#1d1d1d" : "#fdf8f8", border: `1px solid ${dark ? "#27292f" : "#e5e7eb"}`, borderRadius: 16, padding: "22px 24px", width: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: dark ? "#f3f4f6" : "#111112", margin: 0 }}>Edit Event</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#6b7280" : "#9ca3af" }}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input value={summary} onChange={e => setSummary(e.target.value)} placeholder="Event title *" style={inputStyle} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: dark ? "#6b7280" : "#9ca3af", display: "block", marginBottom: 4, fontWeight: 600 }}>Start</label>
              <input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: dark ? "#6b7280" : "#9ca3af", display: "block", marginBottom: 4, fontWeight: 600 }}>End</label>
              <input type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Location (optional)" style={inputStyle} />
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} style={{ ...inputStyle, resize: "none" }} />
          {error && <div style={{ fontSize: 12, color: "#ef4444", display: "flex", alignItems: "center", gap: 4 }}><AlertCircle size={12} />{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "transparent", border: `1px solid ${dark ? "#27292f" : "#e5e7eb"}`, color: dark ? "#9ca3af" : "#6b7280", cursor: "pointer" }}>Cancel</button>
            <button type="submit" disabled={updateMutation.isPending} style={{ padding: "8px 20px", borderRadius: 8, fontSize: 12, fontWeight: 700, background: "#eb2560", border: "none", color: "#fff", cursor: "pointer", opacity: updateMutation.isPending ? 0.7 : 1 }}>
              {updateMutation.isPending ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── ADD CALENDAR MODAL ──────────────────────────────────────────────────────

interface AddCalendarModalProps {
  dark: boolean;
  onClose: () => void;
  onAdd: (cal: CalendarType) => void;
}

function AddCalendarModal({ dark, onClose, onAdd }: AddCalendarModalProps) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#6366f1");
  const COLORS = ["#3b82f6","#eb2560","#22c55e","#eab308","#9333ea","#f97316","#06b6d4","#ec4899","#14b8a6","#a855f7"];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, backdropFilter: "blur(4px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? "#1d1d1d" : "#fdf8f8", border: `1px solid ${dark ? "#27292f" : "#e5e7eb"}`, borderRadius: 16, padding: "22px 24px", width: 320, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: dark ? "#f3f4f6" : "#111112", margin: 0 }}>Add Calendar</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#6b7280" : "#9ca3af" }}><X size={16} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Calendar name *"
            style={{ width: "100%", background: dark ? "#242429" : "#ecedee", border: `1px solid ${dark ? "#27292f" : "#e5e7eb"}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, color: dark ? "#f3f4f6" : "#111112", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
          <div>
            <label style={{ fontSize: 11, color: dark ? "#6b7280" : "#9ca3af", display: "block", marginBottom: 8, fontWeight: 600 }}>Color</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {COLORS.map(c => (
                <button key={c} type="button" onClick={() => setColor(c)} style={{ width: 24, height: 24, borderRadius: "50%", background: c, border: color === c ? "2px solid white" : "2px solid transparent", outline: color === c ? `2px solid ${c}` : "none", cursor: "pointer" }} />
              ))}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={onClose} style={{ padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "transparent", border: `1px solid ${dark ? "#27292f" : "#e5e7eb"}`, color: dark ? "#9ca3af" : "#6b7280", cursor: "pointer" }}>Cancel</button>
            <button onClick={() => {
              if (!label.trim()) return;
              onAdd({ label: label.trim(), color, darkBg: color + "44", darkText: "#f3f4f6", lightBg: color + "22", lightText: color });
              onClose();
            }} style={{ padding: "7px 20px", borderRadius: 8, fontSize: 12, fontWeight: 700, background: "#eb2560", border: "none", color: "#fff", cursor: "pointer" }}>Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const queryClient = useQueryClient();

  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );
  const [weekStart,     setWeekStart]     = useState(() => startOfWeek(new Date()));
  const [localEvents,   setLocalEvents]   = useState<CalendarEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [editingEvent,  setEditingEvent]  = useState<CalendarEvent | null>(null);
  const [showCreate,    setShowCreate]    = useState(false);
  const [showAddCal,    setShowAddCal]    = useState(false);
  const [defaultDate,   setDefaultDate]   = useState<Date | null>(null);
  const [calendars,     setCalendars]     = useState<CalendarType[]>(CALENDAR_TYPES);
  const [enabledCals,   setEnabledCals]   = useState<string[]>(() => CALENDAR_TYPES.map(c => c.label));
  const [viewMode,      setViewMode]      = useState("Week");
  const [currentTime,   setCurrentTime]   = useState(new Date());
  const gridRef = useRef<HTMLDivElement>(null);

  // Sync dark mode with document class
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains("dark"))
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // Tick current time every 30 s
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // SSE real-time sync — mirrors layout.tsx pattern
  useEffect(() => {
    const es = new EventSource("/api/events/stream");
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => queryClient.invalidateQueries({ queryKey: ["events"] }), 3_000);
    };
    es.addEventListener("new_event", debounced);
    return () => { es.close(); if (timer) clearTimeout(timer); };
  }, [queryClient]);

  // Keyboard shortcut — N to open create
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "n" || e.key === "N") { e.preventDefault(); setShowCreate(true); }
      if (e.key === "Escape") { setSelectedEvent(null); setEditingEvent(null); setShowCreate(false); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const today = new Date();
  const days  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const from  = weekStart.toISOString();
  const to    = addDays(weekStart, 7).toISOString();

  // GET /api/calendar/events — primary data fetch
  const { data: serverEvents = [], isLoading, isError, error: fetchError } = useListEvents(from, to);
  console.log(serverEvents);

  // Merge server events with any optimistically-added local events
  const allEvents = useMemo<CalendarEvent[]>(() => {
    const serverIds = new Set(serverEvents.map(e => e.id));
    const extras    = localEvents.filter(e => !serverIds.has(e.id));
    return [...serverEvents, ...extras];
  }, [serverEvents, localEvents]);

  const filteredEvents = allEvents.filter(e => enabledCals.includes(e.calendar ?? "Work"));

  // Current time red line
  const timePercent = useMemo<number | null>(() => {
    const h   = currentTime.getHours() + currentTime.getMinutes() / 60;
    const min = HOURS[0];
    const max = HOURS[HOURS.length - 1] + 1;
    if (h < min || h > max) return null;
    return ((h - min) / (max - min)) * 100;
  }, [currentTime]);

  const todayColIndex  = days.findIndex(d => isSameDay(d, today));
  const isTodayVisible = todayColIndex !== -1;

  function handleGridClick(day: Date, e: React.MouseEvent<HTMLDivElement>) {
    const rect        = e.currentTarget.getBoundingClientRect();
    const pct         = (e.clientY - rect.top) / rect.height;
    const clickedHour = HOURS[0] + pct * (HOURS[HOURS.length - 1] + 1 - HOURS[0]);
    const d           = new Date(day);
    d.setHours(Math.floor(clickedHour), clickedHour % 1 >= 0.5 ? 30 : 0, 0, 0);
    setDefaultDate(d);
    setShowCreate(true);
  }

  // ── RENDER ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", background: dark ? "#1d1d1d" : "#fdf8f8", color: dark ? "#f3f4f6" : "#111112", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", overflow: "hidden", position: "relative" }}>

      {/* ─── LEFT SIDEBAR ─── */}
      <aside style={{ width: 220, borderRight: `1px solid ${dark ? "#242429" : "#e5e7eb"}`, display: "flex", flexDirection: "column", gap: 20, padding: "16px 12px", background: dark ? "#1a1a1a" : "#fff7f7", flexShrink: 0, overflowY: "auto" }}>

        {/* Calendars list */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: dark ? "#4b5563" : "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "monospace" }}>Calendars</span>
            <button onClick={() => setShowAddCal(true)} style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#6b7280" : "#9ca3af", display: "flex", padding: 0 }} title="Add calendar"><Plus size={13} /></button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {calendars.map(cal => {
              const enabled = enabledCals.includes(cal.label);
              return (
                <div key={cal.label}
                  onClick={() => setEnabledCals(p => enabled ? p.filter(c => c !== cal.label) : [...p, cal.label])}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 6, cursor: "pointer", background: "transparent" }}
                  onMouseEnter={e => (e.currentTarget.style.background = dark ? "#242429" : "#f3f4f6")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <div style={{ width: 14, height: 14, borderRadius: 3, border: `2px solid ${cal.color}`, background: enabled ? cal.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {enabled && <Check size={9} color="white" strokeWidth={3} />}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 500, color: dark ? "#9ca3af" : "#4b5563" }}>{cal.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <MiniCalendar current={weekStart} onSelectWeek={setWeekStart} dark={dark} />
        <UpcomingEvents events={filteredEvents} dark={dark} />
      </aside>

      {/* ─── MAIN CONTENT ─── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "10px 20px", borderBottom: `1px solid ${dark ? "#242429" : "#e5e7eb"}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: dark ? "#1d1d1d" : "#fdf8f8", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: dark ? "#f3f4f6" : "#111112" }}>{fmt(weekStart, "MMMM yyyy")}</h1>
            <div style={{ display: "flex", alignItems: "center", border: `1px solid ${dark ? "#27292f" : "#e5e7eb"}`, borderRadius: 8, padding: 2, background: dark ? "#242429" : "#f3f4f6" }}>
              <button onClick={() => setWeekStart(w => addDays(w, -7))} style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#9ca3af" : "#6b7280", padding: "3px 5px", borderRadius: 5, display: "flex" }}><ChevronLeft size={14} /></button>
              <button onClick={() => setWeekStart(startOfWeek(new Date()))} style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#9ca3af" : "#6b7280", fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>Today</button>
              <button onClick={() => setWeekStart(w => addDays(w, 7))}  style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#9ca3af" : "#6b7280", padding: "3px 5px", borderRadius: 5, display: "flex" }}><ChevronRight size={14} /></button>
            </div>
            {/* Loading / error state */}
            {isLoading && <span style={{ fontSize: 11, color: dark ? "#4b5563" : "#9ca3af" }}>Loading…</span>}
            {isError   && <span style={{ fontSize: 11, color: "#ef4444", display: "flex", alignItems: "center", gap: 4 }}><AlertCircle size={12} />{(fetchError as Error).message}</span>}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", border: `1px solid ${dark ? "#27292f" : "#e5e7eb"}`, borderRadius: 8, padding: 2, background: dark ? "#242429" : "#f3f4f6" }}>
              {(["Day","Week","Month","Year"] as const).map(mode => (
                <button key={mode} onClick={() => setViewMode(mode)} style={{ padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.05em", border: "none", background: viewMode === mode ? (dark ? "#1d1d1d" : "#fdf8f8") : "transparent", color: viewMode === mode ? (dark ? "#f3f4f6" : "#111112") : dark ? "#4b5563" : "#9ca3af", boxShadow: viewMode === mode ? `0 0 0 1px ${dark ? "#27292f" : "#e5e7eb"}` : "none" }}>{mode}</button>
              ))}
            </div>
            <button onClick={() => { setDefaultDate(null); setShowCreate(true); }} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 8, background: "#eb2560", border: "none", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              <Plus size={13} /> Event
            </button>
          </div>
        </div>

        {/* Day header row */}
        <div style={{ display: "flex", borderBottom: `1px solid ${dark ? "#242429" : "#e5e7eb"}`, background: dark ? "#1d1d1d" : "#fdf8f8", flexShrink: 0, paddingLeft: 52 }}>
          {days.map((day, i) => {
            const isToday = isSameDay(day, today);
            return (
              <div key={i} style={{ flex: 1, padding: "6px 0", display: "flex", flexDirection: "column", alignItems: "center", borderRight: `1px solid ${dark ? "#242429" : "#e5e7eb"}` }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: dark ? "#4b5563" : "#9ca3af", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "monospace" }}>{fmt(day, "EEE")}</span>
                <span style={{ fontSize: 13, fontWeight: 700, width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", marginTop: 2, fontFamily: "monospace", background: isToday ? "#eb2560" : "transparent", color: isToday ? "#fff" : dark ? "#9ca3af" : "#4b5563" }}>{fmt(day, "d")}</span>
              </div>
            );
          })}
        </div>

        {/* Grid */}
        <div ref={gridRef} style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden", position: "relative" }}>

          {/* Time axis */}
          <div style={{ width: 52, flexShrink: 0, borderRight: `1px solid ${dark ? "#242429" : "#e5e7eb"}`, background: dark ? "#1d1d1d" : "#fdf8f8", position: "relative" }}>
            {HOURS.map((h, i) => (
              <div key={h} style={{ position: "absolute", top: `${(i / HOURS.length) * 100}%`, right: 8, fontSize: 9, fontWeight: 700, fontFamily: "monospace", textTransform: "uppercase", color: dark ? "rgba(75,85,99,0.8)" : "rgba(156,163,175,0.9)", transform: "translateY(-50%)", whiteSpace: "nowrap" }}>{formatHour(h)}</div>
            ))}
          </div>

          {/* Day columns */}
          <div style={{ flex: 1, display: "flex", position: "relative", overflow: "hidden" }}>

            {/* Red current-time line */}
            {isTodayVisible && timePercent !== null && (
              <div style={{ position: "absolute", top: `${timePercent}%`, left: `${(todayColIndex / 7) * 100}%`, width: `${100 / 7}%`, zIndex: 20, pointerEvents: "none", transform: "translateY(-50%)" }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#eb2560", flexShrink: 0 }} />
                  <div style={{ flex: 1, height: 1.5, background: "#eb2560" }} />
                </div>
              </div>
            )}

            {days.map((day, dayIdx) => {
              const dayEvents = filteredEvents.filter(e => {
                try { return isSameDay(e.startTime, day); } catch { return false; }
              });

              return (
                <div key={dayIdx} onClick={e => handleGridClick(day, e)} style={{ flex: 1, borderRight: `1px solid ${dark ? "#242429" : "#e5e7eb"}`, position: "relative", cursor: "crosshair" }}>
                  {HOURS.map((h, i) => (
                    <div key={h} style={{ position: "absolute", top: `${(i / HOURS.length) * 100}%`, left: 0, right: 0, borderTop: `1px solid ${dark ? "rgba(39,41,47,0.8)" : "rgba(229,231,235,0.8)"}`, height: 0 }} />
                  ))}

                  {dayEvents.map((event) => {
                    const startDt = new Date(event.startTime);
                    const endDt   = new Date(event.endTime);
                    const sh      = startDt.getHours() + startDt.getMinutes() / 60;
                    const eh      = endDt.getHours()   + endDt.getMinutes()   / 60;
                    const minH    = HOURS[0];
                    const maxH    = HOURS[HOURS.length - 1] + 1;
                    const top     = Math.max(0,   ((sh - minH) / (maxH - minH)) * 100);
                    const bottom  = Math.min(100, ((eh - minH) / (maxH - minH)) * 100);
                    const height  = Math.max(bottom - top, 3.5);

                    const overlapping   = dayEvents.filter(other => {
                      const os = new Date(other.startTime).getHours() + new Date(other.startTime).getMinutes() / 60;
                      const oe = new Date(other.endTime).getHours()   + new Date(other.endTime).getMinutes()   / 60;
                      return os < eh && oe > sh;
                    });
                    const myOverlapIdx  = overlapping.findIndex(e => e.id === event.id);
                    const overlapCount  = overlapping.length;
                    console.log("frontend call event",event);
                    const evStyle       = getCalendarStyle(event.calendarType ?? "Work", dark);
                    const isShort       = height < 6;

                    return (
                      <button key={event.id}
                        onClick={e => { e.stopPropagation(); setSelectedEvent(event); }}
                        style={{
                          position: "absolute",
                          top: `${top}%`,
                          height: `${height}%`,
                          left: `calc(${(myOverlapIdx / overlapCount) * 100}% + 2px)`,
                          width: `calc(${100 / overlapCount}% - 4px)`,
                          background: evStyle.background,
                          color: evStyle.color,
                          border: "none",
                          borderRadius: 5,
                          padding: isShort ? "1px 6px" : "4px 7px",
                          textAlign: "left",
                          cursor: "pointer",
                          overflow: "hidden",
                          zIndex: 10,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "flex-start",
                          boxShadow: dark ? "0 1px 4px rgba(0,0,0,0.4)" : "0 1px 3px rgba(0,0,0,0.08)",
                        }}>
                        <p style={{ fontSize: isShort ? 10 : 11, fontWeight: 700, margin: 0, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {event.summary}
                        </p>
                        {!isShort && (
                          <p style={{ fontSize: 9, fontFamily: "monospace", margin: "2px 0 0", opacity: 0.8, lineHeight: 1 }}>
                            {fmt(startDt, "h:mm")} – {fmt(endDt, "h:mm a")}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ─── MODALS ─── */}

      {/* Event detail + RSVP + Delete */}
      {selectedEvent && !editingEvent && (
        <EventDetail
          event={selectedEvent}
          dark={dark}
          onClose={() => setSelectedEvent(null)}
          onDeleted={id => {
            setLocalEvents(p => p.filter(e => e.id !== id));
            setSelectedEvent(null);
          }}
          onRsvp={(id, status) => rsvpEventApi(id, status)}
        />
      )}

      {/* Edit event — PATCH /api/calendar/events/[id] */}
      {editingEvent && (
        <EditEventModal
          event={editingEvent}
          dark={dark}
          onClose={() => setEditingEvent(null)}
          onUpdated={updated => {
            setLocalEvents(p => p.map(e => e.id === updated.id ? updated : e));
            queryClient.invalidateQueries({ queryKey: ["events"] });
            setEditingEvent(null);
          }}
        />
      )}

      {/* Create event — POST /api/calendar/events */}
      {showCreate && (
        <CreateEventModal
          dark={dark}
          defaultDate={defaultDate}
          onClose={() => { setShowCreate(false); setDefaultDate(null); }}
          onCreated={e => {
            setLocalEvents(p => [...p, e]);
            queryClient.invalidateQueries({ queryKey: ["events"] });
          }}
        />
      )}

      {/* Add custom calendar (UI-only, no backend route) */}
      {showAddCal && (
        <AddCalendarModal
          dark={dark}
          onClose={() => setShowAddCal(false)}
          onAdd={cal => {
            setCalendars(p => [...p, cal]);
            setEnabledCals(p => [...p, cal.label]);
          }}
        />
      )}
    </div>
  );
}