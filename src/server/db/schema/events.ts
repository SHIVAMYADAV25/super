// calendar_events schema — add calendarType column
// Migration: ALTER TABLE calendar_events ADD COLUMN calendar_type text NOT NULL DEFAULT 'Work';

import { json, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { Attendee, EventStatus } from "@/src/types";

export type CalendarType = "Work" | "Personal" | "Meetings" | "Study" | "Deadlines";

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    gcalId: text("gcal_id").notNull(),

    summary: text("summary"),
    description: text("description"),
    location: text("location"),

    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),

    startTimeZone: text("start_time_zone"),
    endTimeZone: text("end_time_zone"),

    attendees: json("attendees").$type<Attendee[]>().notNull().default([]),

    status: text("status").$type<EventStatus>().notNull().default("confirmed"),

    // ── NEW: user-chosen calendar category ──────────────────────────────────
    calendarType: text("calendar_type")
      .$type<CalendarType>()
      .notNull()
      .default("Work"),

    htmlLink: text("html_link"),
    recurringEventId: text("recurring_event_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userGcalUnique: uniqueIndex("calendar_events_user_gcal_idx").on(
      table.userId,
      table.gcalId
    ),
  })
);

export type DbCalendarEvent = typeof calendarEvents.$inferSelect;
export type DbCalendarEventInsert = typeof calendarEvents.$inferInsert;