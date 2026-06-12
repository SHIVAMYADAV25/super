import { json, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { Attendee, EventStatus } from "@/src/types";


export const calendarEvents = pgTable("calendar_events",{
    id : uuid("id").primaryKey().defaultRandom(),
    userId : uuid("user_id")
    .notNull()
    .references(() => users.id ,{onDelete :"cascade"}),
    gcalId : text("gcal_id").notNull(),
    summary : text("summary"),
    description : text("description"),
    location : text("location"),
    // stored ad ISO string with optional timezone
    startTime : text("start_time").notNull(),
    endTime : text("end_time").notNull(),
    startTimeZone : text("start_time_zone"),
    endTimeZone : text("end_time_zone"),
    attendees : json("attendees").$type<Attendee[]>().notNull().default([]),
    status : text("status").$type<EventStatus>().notNull().default("confirmed"),
    htmlLink :text("html_link"),
    recurringEventId: text("recurring_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export type DbCalendarEvent = typeof calendarEvents.$inferSelect;
export type DbCalendarEventInsert = typeof calendarEvents.$inferInsert;