"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api-client";
import type { CalendarEvent, CreateEventInput, RSVPInput } from "@/src/types";
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay, parseISO } from "date-fns";
import { CreateEventSchema } from "@/src/schema";

// ─── Event form ───────────────────────────────────────────────────────────────

interface EventFormProps {
  defaultStart?: Date;
  onClose: () => void;
  onCreated: () => void;
}

function EventForm({ defaultStart, onClose, onCreated }: EventFormProps) {
  const now = defaultStart ?? new Date();
  const roundedStart = new Date(Math.ceil(now.getTime() / (30 * 60_000)) * (30 * 60_000));
  const roundedEnd = new Date(roundedStart.getTime() + 60 * 60_000);

  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startTime, setStartTime] = useState(toDatetimeLocal(roundedStart));
  const [endTime, setEndTime] = useState(toDatetimeLocal(roundedEnd));
  const [attendeeInput, setAttendeeInput] = useState("");
  const [attendees, setAttendees] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: CreateEventInput) =>
      api.post<{ event: CalendarEvent; conflicts: string[] }>("/api/calendar/events", data),
    onSuccess: (result) => {
      if (result.conflicts.length > 0) {
        setConflictWarning(`Overlaps with existing event: ${result.conflicts[0]}`);
      }
      onCreated();
      onClose();
    },
    onError: (err) => {
      setErrors({ submit: err instanceof Error ? err.message : "Failed to create event" });
    },
  });

  function addAttendee() {
    const v = attendeeInput.trim();
    if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return;
    if (!attendees.includes(v)) setAttendees((a) => [...a, v]);
    setAttendeeInput("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const result = CreateEventSchema.safeParse({
      summary,
      description: description || undefined,
      location: location || undefined,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      attendees,
    });

    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(fieldErrors)) {
        if (v?.[0]) mapped[k] = v[0];
      }
      setErrors(mapped);
      return;
    }

    createMutation.mutate(result.data);
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in p-4">
      <div className="bg-surface-1 border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">New event</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Title */}
          <div>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Event title *"
              autoFocus
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent/50 transition-colors"
            />
            {errors.summary && <p className="text-xs text-danger mt-1">{errors.summary}</p>}
          </div>

          {/* Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-tertiary block mb-1">Start</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50 transition-colors"
              />
              {errors.startTime && <p className="text-xs text-danger mt-1">{errors.startTime}</p>}
            </div>
            <div>
              <label className="text-xs text-text-tertiary block mb-1">End</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50 transition-colors"
              />
              {errors.endTime && <p className="text-xs text-danger mt-1">{errors.endTime}</p>}
            </div>
          </div>

          {/* Location */}
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location (optional)"
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent/50 transition-colors"
          />

          {/* Attendees */}
          <div>
            <label className="text-xs text-text-tertiary block mb-1">Invite people</label>
            <div className="flex gap-2">
              <input
                value={attendeeInput}
                onChange={(e) => setAttendeeInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAttendee(); } }}
                placeholder="email@example.com"
                className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent/50 transition-colors"
              />
              <button
                type="button"
                onClick={addAttendee}
                className="px-3 py-2 rounded-lg bg-surface-2 border border-border text-xs text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-colors"
              >
                Add
              </button>
            </div>
            {attendees.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {attendees.map((a) => (
                  <span key={a} className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-3 text-xs text-text-secondary">
                    {a}
                    <button type="button" onClick={() => setAttendees((list) => list.filter((x) => x !== a))} className="text-text-tertiary hover:text-text-secondary">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Description */}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent/50 transition-colors resize-none"
          />

          {/* Conflict warning */}
          {conflictWarning && (
            <div className="px-3 py-2 rounded-lg bg-warning/10 border border-warning/20 text-xs text-warning">
              ⚠ {conflictWarning} — you can still save this event.
            </div>
          )}

          {/* Submit error */}
          {errors.submit && (
            <div className="px-3 py-2 rounded-lg bg-danger/10 border border-danger/20 text-xs text-danger">
              {errors.submit}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {createMutation.isPending ? "Creating..." : "Create event"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Week view grid ───────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function formatHour(h: number) {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function toDatetimeLocal(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

function getEventTop(startTime: string): number {
  const d = parseISO(startTime);
  return (d.getHours() + d.getMinutes() / 60) * 60; // px (1h = 60px)
}

function getEventHeight(startTime: string, endTime: string): number {
  const s = parseISO(startTime);
  const e = parseISO(endTime);
  const mins = (e.getTime() - s.getTime()) / 60_000;
  return Math.max(mins, 30); // min 30px
}

export default function CalendarPage() {
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [showForm, setShowForm] = useState(false);
  const [clickedDate, setClickedDate] = useState<Date | undefined>(undefined);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const queryClient = useQueryClient();

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  const from = weekStart.toISOString();
  const to = addDays(weekStart, 7).toISOString();

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["events", from, to],
    queryFn: () =>
      api.get<CalendarEvent[]>(`/api/calendar/events?from=${from}&to=${to}`),
    staleTime: 2 * 60_000,
  });

  const rsvpMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: RSVPInput["status"] }) =>
      api.post(`/api/calendar/events/${id}/rsvp`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      setSelectedEvent(null);
    },
  });

  // N key = new event
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "n" || e.key === "N") setShowForm(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-text-primary">
            {format(weekStart, "MMMM yyyy")}
          </h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setWeekStart((w) => subWeeks(w, 1))}
              className="p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15,18 9,12 15,6" />
              </svg>
            </button>
            <button
              onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
              className="px-2.5 py-1 rounded-lg text-xs text-text-secondary hover:bg-surface-2 border border-border transition-colors"
            >
              Today
            </button>
            <button
              onClick={() => setWeekStart((w) => addWeeks(w, 1))}
              className="p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9,18 15,12 9,6" />
              </svg>
            </button>
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-hover transition-colors"
        >
          + New event
        </button>
      </div>

      {/* Calendar grid */}
      <div className="flex flex-1 overflow-hidden">
        {/* Time column */}
        <div className="w-14 shrink-0 border-r border-border overflow-y-auto">
          <div className="h-10" /> {/* header spacer */}
          {HOURS.map((h) => (
            <div key={h} className="h-[60px] flex items-start justify-end pr-2 pt-1">
              <span className="text-xs text-text-tertiary">{formatHour(h)}</span>
            </div>
          ))}
        </div>

        {/* Day columns */}
        <div className="flex-1 overflow-auto">
          {/* Day headers */}
          <div className="flex border-b border-border sticky top-0 bg-surface-0 z-10">
            {days.map((day) => {
              const isToday = isSameDay(day, today);
              return (
                <div key={day.toISOString()} className="flex-1 h-10 flex flex-col items-center justify-center gap-0.5">
                  <span className="text-xs text-text-tertiary uppercase tracking-wide">
                    {format(day, "EEE")}
                  </span>
                  <span
                    className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                      isToday
                        ? "bg-accent text-white"
                        : "text-text-secondary"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Time slots */}
          <div className="flex relative">
            {days.map((day) => {
              const dayEvents = events.filter((e) => {
                try {
                  return isSameDay(parseISO(e.startTime), day);
                } catch {
                  return false;
                }
              });

              return (
                <div
                  key={day.toISOString()}
                  className="flex-1 border-r border-border/50 relative"
                  style={{ height: `${24 * 60}px` }}
                  onClick={() => {
                    setClickedDate(day);
                    setShowForm(true);
                  }}
                >
                  {/* Hour lines */}
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="absolute w-full border-t border-border/30"
                      style={{ top: `${h * 60}px` }}
                    />
                  ))}

                  {/* Events */}
                  {dayEvents.map((event) => {
                    let top = 0;
                    let height = 60;
                    try {
                      top = getEventTop(event.startTime);
                      height = getEventHeight(event.startTime, event.endTime);
                    } catch {}

                    return (
                      <button
                        key={event.gcalId}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEvent(event);
                        }}
                        className="absolute left-1 right-1 rounded-md px-1.5 py-1 text-left bg-accent/20 border border-accent/30 hover:bg-accent/30 transition-colors overflow-hidden z-10"
                        style={{ top, height: Math.max(height, 20) }}
                      >
                        <p className="text-xs font-medium text-accent truncate">{event.summary}</p>
                        {height > 30 && (
                          <p className="text-xs text-accent/70 truncate">
                            {format(parseISO(event.startTime), "h:mm a")}
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

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-xs text-text-tertiary">Loading events...</div>
        </div>
      )}

      {/* Event detail popover */}
      {selectedEvent && (
        <div className="fixed inset-0 flex items-center justify-center z-50" onClick={() => setSelectedEvent(null)}>
          <div
            className="bg-surface-1 border border-border rounded-2xl p-5 w-80 shadow-2xl animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-sm font-semibold text-text-primary leading-snug">
                {selectedEvent.summary ?? "(no title)"}
              </h3>
              <button onClick={() => setSelectedEvent(null)} className="text-text-tertiary hover:text-text-secondary shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="space-y-1.5 mb-4">
              <p className="text-xs text-text-secondary">
                {format(parseISO(selectedEvent.startTime), "EEEE, MMMM d")} ·{" "}
                {format(parseISO(selectedEvent.startTime), "h:mm a")} –{" "}
                {format(parseISO(selectedEvent.endTime), "h:mm a")}
              </p>
              {selectedEvent.location && (
                <p className="text-xs text-text-tertiary">{selectedEvent.location}</p>
              )}
            </div>

            {/* Attendees */}
            {selectedEvent.attendees.length > 0 && (
              <div className="mb-4">
                <p className="text-xs text-text-tertiary mb-1.5">
                  {selectedEvent.attendees.length} attendee{selectedEvent.attendees.length !== 1 ? "s" : ""}
                </p>
                <div className="space-y-1">
                  {selectedEvent.attendees.slice(0, 4).map((a) => (
                    <div key={a.email} className="flex items-center justify-between text-xs">
                      <span className="text-text-secondary truncate">{a.displayName ?? a.email}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        a.responseStatus === "accepted"
                          ? "bg-success/10 text-success"
                          : a.responseStatus === "declined"
                          ? "bg-danger/10 text-danger"
                          : "bg-surface-2 text-text-tertiary"
                      }`}>
                        {a.responseStatus === "accepted" ? "✓" : a.responseStatus === "declined" ? "✗" : "?"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* RSVP buttons */}
            <div className="flex gap-2">
              {(["accepted", "declined", "tentative"] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => rsvpMutation.mutate({ id: selectedEvent.gcalId, status })}
                  disabled={rsvpMutation.isPending}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    status === "accepted"
                      ? "border-success/30 text-success hover:bg-success/10"
                      : status === "declined"
                      ? "border-danger/30 text-danger hover:bg-danger/10"
                      : "border-border text-text-secondary hover:bg-surface-2"
                  }`}
                >
                  {status === "accepted" ? "Accept" : status === "declined" ? "Decline" : "Maybe"}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Create event form */}
      {showForm && (
        <EventForm
          defaultStart={clickedDate}
          onClose={() => { setShowForm(false); setClickedDate(undefined); }}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ["events"] })}
        />
      )}
    </div>
  );
}