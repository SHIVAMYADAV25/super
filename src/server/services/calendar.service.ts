// list event

import { CreateEventInput, ListEventInput, RSVPInput, UpdateEventInput } from "@/src/schema";
import { Attendee, CalendarEvent } from "@/src/types";
import { getTenant } from "../lib/corsair";
import { calendarEvents } from "../db/schema";
import { db } from "../db";
import { logger } from "@/src/lib/logger";
import { createExternalApiError, createNotFoundError } from "@/src/lib/errors";
import { and, eq } from "drizzle-orm";


export async function listEvent(
    tenantId:string,
    userId : string,
    opts : ListEventInput,
):Promise<CalendarEvent[]> {
    try{

        const tenant = getTenant(tenantId);

        // Use Corsair Google Calendar API
        const result = await tenant.googlecalendar.api.events.getMany({
            timeMin: opts.from ?? new Date().toISOString(),
            timeMax: opts.to,
            q: opts.q,
            maxResults: opts.maxResults,
            singleEvents: true,
            orderBy: "startTime",
            });

        // console.log(result)

        const items = result.items ?? [];

        // upsert into our DB cache in background
        void upsertEventsBatch(userId,items);

        return items.map(mapToCalendarEvent.bind(null,userId));
    }catch(err){
        console.dir(err, { depth: null });

        logger.error("ListEvent failed",{
        userId,
        error: err,
        });

        logger.error("ListEvent failed",{userId,error : String(err)});
        throw createExternalApiError("Google calendar", err);
    }
}


// Get single event

export async function getEvent(
    tenantId:string,
    userId : string,
    gcalId : string,
):Promise<CalendarEvent> {
    try {
        const tenant = getTenant(tenantId);

        const event = await tenant.googlecalendar.api.events.get({id : gcalId});

        if(!event.id) throw createNotFoundError("Calendar event");

        await upsertEvent(userId,event);

        return mapToCalendarEvent(userId,event);
    } catch (error) {
        if((error as Error).message?.includes("not found")) throw error;
        logger.error("getEvent failed" , {userId,gcalId,error : String(error)});
        throw createExternalApiError("Google Calendar",error)
    }
    
}

// Create event

export async function createEvent(
    tenantId:string,
    userId : string,
    input : CreateEventInput,
):Promise<CalendarEvent>{
    try {
        const tenant = getTenant(tenantId);

        const event = await tenant.googlecalendar.api.events.create({
            event:{
                summary : input.summary,
                description : input.description,
                location : input.location,
                start : {
                    dateTime: input.startTime,
                    timeZone : input.timeZone,
                },
                end:{
                    dateTime : input.endTime,
                    timeZone:input.timeZone
                },
                attendees : input.attendees?.map((email) => ({email})),
            },
            sendUpdates:input.sendUpdates ?? "all"
        })


        if(!event.id) throw createExternalApiError("Google Calendar","No event ID returned");

        logger.info("Calendar event created",{userId,gcalid : event.id});

        await upsertEvent(userId,event);

        return mapToCalendarEvent(userId,event);
    } catch (error) {
        logger.error("createEvent failed",{userId,error : String(error)});
        logger.error("createEvent failed",{userId,error});
        console.error(error);
        console.dir(error, { depth: null });
        throw createExternalApiError("Google Calendar" ,error)
    }
}


// update event

export async function updateEvent(
    tenantId:string,
    userId : string,
    gcalId : string,
    input : UpdateEventInput,
):Promise<CalendarEvent>{
    try {
        const tenant = getTenant(tenantId);

        const updated = await tenant.googlecalendar.api.events.update({
            id : gcalId,
            event : {
                summary : input.summary,
                description : input.description,
                location : input.location,
                start : input.startTime
                ? {dateTime : input.startTime,timeZone:input.timeZone}
                : undefined,

                end : input.endTime
                ? {dateTime : input.endTime , timeZone: input.timeZone}
                : undefined,
            },
            sendUpdates : input.sendUpdates ?? "all"
        });

        await upsertEvent(userId,updated);

        return mapToCalendarEvent(userId,updated);


    } catch (error) {
        logger.error("updateEvent failed",{userId,gcalId,error : String(error)});
        throw createExternalApiError("Google Calendar",error)
    }
}

// delet event

export async function deleteEvent(
    tenantId:string,
    userId : string,
    gcalId : string
):Promise<void> {
    try {
        const tenant = getTenant(tenantId);


        // Note for future shivam : "events.delete" is set to "require_approval" in Corsair config
        // The agent's MCP call will create a pending approval record
        await tenant.googlecalendar.api.events.delete({
            id : gcalId,
            sendUpdates : "all",
        });

        await db.
        delete(calendarEvents)
        .where(and(eq(calendarEvents.userId,userId),eq(calendarEvents.gcalId,gcalId)));

        logger.info("Calendar event deleted",{userId,gcalId});
    } catch (error) {
        logger.error("deletEvent failed",{userId,gcalId,error : String(error)});
        throw createExternalApiError("Google Calendar",error)
    }
}

export type RSVPStatus =
  | "accepted"
  | "declined"
  | "tentative"
  | "needsAction";

type GoogleCalendarAttendee = {
  email?: string;
  displayName?: string;
  organizer?: boolean;
  self?: boolean;
  responseStatus?: RSVPStatus;
  [key: string]: unknown;
};


// RSVP
export async function rsvpEvent(
    tenantId:string,
  userId: string,
  gcalId: string,
  userEmail: string,
  input: RSVPInput,
): Promise<CalendarEvent> {
  try {
    const tenant = getTenant(tenantId);
 
    // First fetch the current event to get the attendees list
    const current = await tenant.googlecalendar.api.events.get({ id: gcalId });
    const attendees = (current.attendees ?? []) as GoogleCalendarAttendee[];

    const updatedAttendees = attendees.map((a) =>
        a.email === userEmail
            ? {
                ...a,
                responseStatus: input.status,
            }
            : a,
        );
 
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
 
    await upsertEvent(userId, updated);
 
    logger.info("RSVP updated", { userId, gcalId, status: input.status });
 
    return mapToCalendarEvent(userId, updated);
  } catch (err) {
    logger.error("rsvpEvent failed", { userId, gcalId, error: String(err) });
    console.error(err);
    console.dir(err, { depth: null });
    throw createExternalApiError("Google Calendar", err);
  }
}


// ─── Conflict check

export async function checkConflicts(
    tenantId:string,
    userId : string,
    startTime :string,
    endTime :string
): Promise<{ hasConflict: boolean; conflictingEvents: string[] }> {
    try {
        const tenant = getTenant(tenantId);

        const result = await tenant.googlecalendar.api.calendar.getAvailability({
            timeMax : endTime,
            timeMin : startTime,
            items : [{ id : "primary"}]
        })

        // Check if there are any busy periods

        const calendars = result.calendars as Record<
        string,
        {busy ?: Array < {start :string ;end : string}>}>

        const primaryBusy = Object.values(calendars)[0]?.busy ?? [];

        if(primaryBusy.length === 0){
            return {hasConflict : false,conflictingEvents : []};
        }

        return {
            hasConflict : true,
            conflictingEvents : primaryBusy.map(
                (b) => `${new Date(b.start).toLocaleTimeString()} - ${new Date(b.end).toLocaleTimeString()}`,
            )
        }
    } catch (error) {
        // Non-fatal — just warn, don't block event creation
        logger.warn("checkConflicts failed", { userId, error: String(error) });
        return { hasConflict: false, conflictingEvents: [] };
    }
}


// ─── DB helpers ───────────────────────────────────────────────────────────────
 
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


function mapToCalendarEvent(userId: string, event: GCalEvent): CalendarEvent {
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
  };
}

async function upsertEvent(userId: string, event: GCalEvent) {
  if (!event.id) return;
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
      attendees: (event.attendees ?? []).map((a): Attendee => ({
        email: a.email ?? "",
        displayName: a.displayName,
        responseStatus: (a.responseStatus as Attendee["responseStatus"]) ?? "needsAction",
      })),
      status: (event.status as CalendarEvent["status"]) ?? "confirmed",
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
        attendees: (event.attendees ?? []).map((a): Attendee => ({
          email: a.email ?? "",
          displayName: a.displayName,
          responseStatus: (a.responseStatus as Attendee["responseStatus"]) ?? "needsAction",
        })),
        status: (event.status as CalendarEvent["status"]) ?? "confirmed",
        updatedAt: new Date(),
      },
    });
}

async function upsertEventsBatch(userId: string, events: GCalEvent[]) {
  for (const event of events) {
    try {
      await upsertEvent(userId, event);
    } catch (err) {
      logger.warn("Failed to upsert event", { gcalId: event.id, error: String(err) });
    }
  }
}