

// src/server/services/calendar.service.ts — full replacement

import { CreateEventInput, ListEventInput, RSVPInput, UpdateEventInput } from "@/src/schema";
import { Attendee, CalendarEvent, CalendarType } from "@/src/types";
import { getTenant } from "../lib/corsair";
import { calendarEvents } from "../db/schema";
import { db } from "../db";
import { logger } from "@/src/lib/logger";
import { createExternalApiError, createNotFoundError } from "@/src/lib/errors";
import { and, eq } from "drizzle-orm";

// ─── helpers ──────────────────────────────────────────────────────────────────

async function getStoredCalendarType(
  userId: string,
  gcalId: string
): Promise<CalendarType> {
  const row = await db
    .select({ calendarType: calendarEvents.calendarType })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.userId, userId), eq(calendarEvents.gcalId, gcalId)))
    .limit(1);
  return (row[0]?.calendarType as CalendarType) ?? "Work";
}

type GCalEvent = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
    organizer?: boolean;
    self?: boolean;
  }>;
  status?: string;
  htmlLink?: string;
  recurringEventId?: string;
};

function mapToCalendarEvent(
  userId: string,
  event: GCalEvent,
  calendarType: CalendarType = "Work"
): CalendarEvent {
  return {
    id: event.id ?? "",
    userId,
    gcalId: event.id ?? "",
    summary: event.summary ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    startTime: event.start?.dateTime ?? event.start?.date ?? "",
    endTime: event.end?.dateTime ?? event.end?.date ?? "",
    startTimeZone: event.start?.timeZone,
    endTimeZone: event.end?.timeZone,
    attendees: (event.attendees ?? []).map((a): Attendee => ({
      email: a.email ?? "",
      displayName: a.displayName,
      responseStatus: (a.responseStatus as Attendee["responseStatus"]) ?? "needsAction",
      organizer: a.organizer,
      self: a.self,
    })),
    status: (event.status as CalendarEvent["status"]) ?? "confirmed",
    htmlLink: event.htmlLink,
    recurringEventId: event.recurringEventId,
    createdAt: new Date(),
    calendarType,
  };
}

// ─── listEvent ────────────────────────────────────────────────────────────────

export async function listEvent(
  tenantId: string,
  userId: string,
  opts: ListEventInput,
): Promise<CalendarEvent[]> {
  try {
    const tenant = getTenant(tenantId);

    const result = await tenant.googlecalendar.api.events.getMany({
      timeMin: opts.from ?? new Date().toISOString(),
      timeMax: opts.to,
      q: opts.q,
      maxResults: opts.maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });

    const items = result.items ?? [];

    // Batch-fetch stored calendarTypes from DB for this user
    let typeMap: Record<string, CalendarType> = {};
    if (items.length > 0) {
      const rows = await db
        .select({ gcalId: calendarEvents.gcalId, calendarType: calendarEvents.calendarType })
        .from(calendarEvents)
        .where(eq(calendarEvents.userId, userId));

    // console.log(rows)

      typeMap = Object.fromEntries(
        rows.map(r => [r.gcalId, (r.calendarType as CalendarType) ?? "Work"])
      );

    
    }

    // console.log(typeMap)

    // Upsert in background — preserves existing calendarType
    // void upsertEventsBatch(userId, items, typeMap);

    return items.map(e =>
      mapToCalendarEvent(userId, e, typeMap[e.id ?? ""] ?? "Work")
    );
  } catch (err) {
    logger.error("ListEvent failed", { userId, error: String(err) });
    throw createExternalApiError("Google calendar", err);
  }
}

// ─── getEvent ─────────────────────────────────────────────────────────────────

export async function getEvent(
  tenantId: string,
  userId: string,
  gcalId: string,
): Promise<CalendarEvent> {
  try {
    const tenant = getTenant(tenantId);
    const event = await tenant.googlecalendar.api.events.get({ id: gcalId });
    if (!event.id) throw createNotFoundError("Calendar event");

    const calendarType = await getStoredCalendarType(userId, gcalId);
    await upsertEvent(userId, event, calendarType);

    return mapToCalendarEvent(userId, event, calendarType);
  } catch (error) {
    if ((error as Error).message?.includes("not found")) throw error;
    logger.error("getEvent failed", { userId, gcalId, error: String(error) });
    throw createExternalApiError("Google Calendar", error);
  }
}

// ─── createEvent ──────────────────────────────────────────────────────────────

export async function createEvent(
  tenantId: string,
  userId: string,
  input: CreateEventInput,
): Promise<CalendarEvent> {
  try {
    const tenant = getTenant(tenantId);
    // console.log("start creating : " ,input)

    const event = await tenant.googlecalendar.api.events.create({
      event: {
        summary: input.summary,
        description: input.description,
        location: input.location,
        start: { dateTime: input.startTime, timeZone: input.timeZone },
        end: { dateTime: input.endTime, timeZone: input.timeZone },
        // FIX: attendees is string[] (email addresses) — wrap each string as { email }
        attendees: input.attendees?.map((email: string) => ({ email })),
      },
      sendUpdates: input.sendUpdates ?? "all",
    });

    if (!event.id) throw createExternalApiError("Google Calendar", "No event ID returned");

    // FIX: calendarType now exists on CreateEventInput (added to Zod schema)
    const calendarType: CalendarType = (input.calendarType as CalendarType) ?? "Work";
    // console.log("creating :" ,calendarType)
    await upsertEvent(userId, event, calendarType);

    logger.info("Calendar event created", { userId, gcalId: event.id, calendarType });

    return mapToCalendarEvent(userId, event, calendarType);
  } catch (error) {
    logger.error("createEvent failed", { userId, error: String(error) });
    throw createExternalApiError("Google Calendar", error);
  }
}

// ─── updateEvent ──────────────────────────────────────────────────────────────

export async function updateEvent(
  tenantId: string,
  userId: string,
  gcalId: string,
  input: UpdateEventInput,
): Promise<CalendarEvent> {
  try {
    const tenant = getTenant(tenantId);

    const updated = await tenant.googlecalendar.api.events.update({
      id: gcalId,
      event: {
        summary: input.summary,
        description: input.description,
        location: input.location,
        start: input.startTime
          ? { dateTime: input.startTime, timeZone: input.timeZone }
          : undefined,
        end: input.endTime
          ? { dateTime: input.endTime, timeZone: input.timeZone }
          : undefined,
        // FIX: attendees is string[] here too
        attendees: input.attendees?.map((email: string) => ({ email })),
      },
      sendUpdates: input.sendUpdates ?? "all",
    });

    // FIX: calendarType now exists on UpdateEventInput (added to Zod schema)
    const calendarType: CalendarType =
      (input.calendarType as CalendarType) ?? await getStoredCalendarType(userId, gcalId);

    await upsertEvent(userId, updated, calendarType);

    return mapToCalendarEvent(userId, updated, calendarType);
  } catch (error) {
    logger.error("updateEvent failed", { userId, gcalId, error: String(error) });
    throw createExternalApiError("Google Calendar", error);
  }
}

// ─── deleteEvent ──────────────────────────────────────────────────────────────

export async function deleteEvent(
  tenantId: string,
  userId: string,
  gcalId: string,
): Promise<void> {
  try {
    const tenant = getTenant(tenantId);

    await tenant.googlecalendar.api.events.delete({
      id: gcalId,
      sendUpdates: "all",
    });

    await db
      .delete(calendarEvents)
      .where(and(eq(calendarEvents.userId, userId), eq(calendarEvents.gcalId, gcalId)));

    logger.info("Calendar event deleted", { userId, gcalId });
  } catch (error) {
    logger.error("deleteEvent failed", { userId, gcalId, error: String(error) });
    throw createExternalApiError("Google Calendar", error);
  }
}

// ─── rsvpEvent ────────────────────────────────────────────────────────────────

export type RSVPStatusType = "accepted" | "declined" | "tentative" | "needsAction";

type GoogleCalendarAttendee = {
  email?: string;
  displayName?: string;
  organizer?: boolean;
  self?: boolean;
  responseStatus?: RSVPStatusType;
  [key: string]: unknown;
};

export async function rsvpEvent(
  tenantId: string,
  userId: string,
  gcalId: string,
  userEmail: string,
  input: RSVPInput,
): Promise<CalendarEvent> {
  try {
    // console.log(input);
    const tenant = getTenant(tenantId);

    const current = await tenant.googlecalendar.api.events.get({ id: gcalId });
    const attendees = (current.attendees ?? []) as GoogleCalendarAttendee[];

    const updatedAttendees = attendees.map((a) =>
      a.email === userEmail ? { ...a, responseStatus: input.status } : a
    );

    // console.log( "uupdate ",updatedAttendees)

    const updated = await tenant.googlecalendar.api.events.update({
      id: gcalId,
      event: {
        summary: current.summary,
        description: current.description,
        location: current.location,
        start: current.start,
        end: current.end,
        attendees: updatedAttendees,
      },
      sendUpdates: "all",
    });

    // console.log(updated);

    const calendarType = await getStoredCalendarType(userId, gcalId);
    await upsertEvent(userId, updated, calendarType);

    logger.info("RSVP updated", { userId, gcalId, status: input.status });

    return mapToCalendarEvent(userId, updated, calendarType);
  } catch (err) {
    logger.error("rsvpEvent failed", { userId, gcalId, error: String(err) });
    throw createExternalApiError("Google Calendar", err);
  }
}




// ─── syncEventsFromWebhook (called from webhook handler) ──────────────────────

/**
 * Re-fetch upcoming events and upsert them into the DB.
 *
 * Google's Calendar push channel notification carries no event id — it's
 * just "something changed, go sync". listEvent() above only ever reads
 * through to the Google API and returns a mapped view; it doesn't persist
 * (its upsertEventsBatch call is commented out). This function is the one
 * that actually calls upsertEventsBatch() so the webhook-triggered sync
 * sticks in calendar_events, same as createEvent/getEvent do for direct
 * user actions.
 */
export async function syncEventsFromWebhook(
  tenantId: string,
  userId: string,
  maxResults = 50,
): Promise<number> {
  try {
    const tenant = getTenant(tenantId);

    const result = await tenant.googlecalendar.api.events.getMany({
      timeMin: new Date().toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });

    const items = result.items ?? [];
    if (items.length === 0) return 0;

    const rows = await db
      .select({ gcalId: calendarEvents.gcalId, calendarType: calendarEvents.calendarType })
      .from(calendarEvents)
      .where(eq(calendarEvents.userId, userId));

    const typeMap: Record<string, CalendarType> = Object.fromEntries(
      rows.map((r) => [r.gcalId, (r.calendarType as CalendarType) ?? "Work"]),
    );

    await upsertEventsBatch(userId, items, typeMap);

    return items.length;
  } catch (err) {
    logger.error("syncEventsFromWebhook failed", { userId, error: String(err) });
    return 0;
  }
}

// ─── checkConflicts ───────────────────────────────────────────────────────────

export async function checkConflicts(
  tenantId: string,
  userId: string,
  startTime: string,
  endTime: string,
): Promise<{ hasConflict: boolean; conflictingEvents: string[] }> {
  try {
    const tenant = getTenant(tenantId);

    const result = await tenant.googlecalendar.api.calendar.getAvailability({
      timeMax: endTime,
      timeMin: startTime,
      items: [{ id: "primary" }],
    });

    const calendars = result.calendars as Record<
      string,
      { busy?: Array<{ start: string; end: string }> }
    >;

    const primaryBusy = Object.values(calendars)[0]?.busy ?? [];

    if (primaryBusy.length === 0) {
      return { hasConflict: false, conflictingEvents: [] };
    }

    return {
      hasConflict: true,
      conflictingEvents: primaryBusy.map(
        (b) => `${new Date(b.start).toLocaleTimeString()} - ${new Date(b.end).toLocaleTimeString()}`
      ),
    };
  } catch (error) {
    logger.warn("checkConflicts failed", { userId, error: String(error) });
    return { hasConflict: false, conflictingEvents: [] };
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function upsertEvent(
  userId: string,
  event: GCalEvent,
  calendarType: CalendarType = "Work"
) {
  if (!event.id) return;
//   console.log(calendarType);

  const attendeeValues = (event.attendees ?? []).map((a): Attendee => ({
    email: a.email ?? "",
    displayName: a.displayName,
    responseStatus: (a.responseStatus as Attendee["responseStatus"]) ?? "needsAction",
    organizer: a.organizer,
    self: a.self,
  }));

  await db
    .insert(calendarEvents)
    .values({
      userId,
      gcalId: event.id,
      summary: event.summary ?? null,
      description: event.description ?? null,
      location: event.location ?? null,
      startTime: event.start?.dateTime ?? event.start?.date ?? "",
      endTime: event.end?.dateTime ?? event.end?.date ?? "",
      startTimeZone: event.start?.timeZone ?? null,
      endTimeZone: event.end?.timeZone ?? null,
      attendees: attendeeValues,
      status: (event.status as CalendarEvent["status"]) ?? "confirmed",
      calendarType,
      htmlLink: event.htmlLink ?? null,
      recurringEventId: event.recurringEventId ?? null,
    })
    .onConflictDoUpdate({
      target: [calendarEvents.userId, calendarEvents.gcalId],
      set: {
        summary: event.summary ?? null,
        description: event.description ?? null,
        startTime: event.start?.dateTime ?? event.start?.date ?? "",
        endTime: event.end?.dateTime ?? event.end?.date ?? "",
        attendees: attendeeValues,
        status: (event.status as CalendarEvent["status"]) ?? "confirmed",
        // Preserve/update calendarType using the value passed to upsertEvent.
        // Webhook syncs pass the existing stored type from typeMap,
        // while user actions may pass a newly selected type.
        calendarType,
        updatedAt: new Date(),
      },
    });
}

async function upsertEventsBatch(
  userId: string,
  events: GCalEvent[],
  typeMap: Record<string, CalendarType> = {}
) {
  for (const event of events) {
    try {
        // console.log(event.id ,"         ",typeMap[event.id])
      await upsertEvent(userId, event, typeMap[event.id ?? ""] ?? "Work");
    } catch (err) {
      logger.warn("Failed to upsert event", { gcalId: event.id, error: String(err) });
    }
  }
}