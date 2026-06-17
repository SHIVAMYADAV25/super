import { pgTable,text,timestamp,uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    email : text("email").notNull().unique(),
    name : text("name"),
    image:text("image"),
    createdAt : timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
    updatedAt : timestamp("updated_at",{withTimezone:true}).defaultNow().notNull(),

    // Google's stable user id ("sub" claim) — this is the Corsair tenant
    // key (via getTenantId()). Webhooks arrive with only the tenantId
    // string, so we need a way back to this row; storing it directly here
    // is far simpler than reverse-parsing "user_<sub>" and joining on email.
    googleSub: text("google_sub").unique(),

    // ── Gmail watch tracking ────────────────────────────────────────────
    // Cursor for Gmail's history.list — set on every successful watch()
    // call (initial value) and advanced after each webhook we process.
    // Required because Gmail push notifications only carry a historyId,
    // never the actual message — we diff from this cursor to find out
    // what changed.
    gmailHistoryId: text("gmail_history_id"),
    // Epoch ms when the current Gmail watch() expires (max 7 days).
    // Used by the renewal cron to know who needs re-subscribing.
    gmailWatchExpiration: timestamp("gmail_watch_expiration", { withTimezone: true }),

    // ── Calendar push channel tracking ──────────────────────────────────
    // Opaque channel id Google assigns to our calendar watch — needed if
    // we ever want to call channels.stop() to cancel a stale subscription.
    calendarChannelId: text("calendar_channel_id"),
    calendarResourceId: text("calendar_resource_id"),
    // Epoch ms when the current Calendar push channel expires (max ~1 month).
    calendarWatchExpiration: timestamp("calendar_watch_expiration", { withTimezone: true }),
})

export type DbUser = typeof users.$inferSelect;
export type DbUserInsert = typeof users.$inferInsert;