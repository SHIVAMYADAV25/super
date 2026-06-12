import { customType, json, pgTable, text, uuid,boolean, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";
import { EmailAttachment, EmailPriority } from "@/src/types";


const vector = customType<{data : number[]; driverData : string}>({
    dataType(){
        return "vector(1536)";
    },
    fromDriver(value:string):number[]{
        // Postgres returns vector as "[0.1,0.2,...]"
    return JSON.parse(value.replace(/^\[/, "[").replace(/\]$/, "]"));
    },
    toDriver( value: number[]):string {
        return `[${value.join(",")}]`
    },
});

export const emails = pgTable("emails", {
    id : uuid("id").primaryKey().defaultRandom(),
    userId : uuid("user_id")
    .notNull()
    .references(() => users.id,{onDelete :"cascade"}),
    gmailId : text("gamil_id").notNull(),
    threadId : text("thread_id"),
    fromAddr : text("from_addr"),
    toAddrs : json("to_addrs").$type<string[]>().notNull().default([]),
    ccAddrs : json("cc_addrs").$type<string[]>().notNull().default([]),
    bccAddrs : json("bcc_addrs").$type<string[]>().notNull().default([]),
    subject : text("subject"),
    snippet : text("snippet"),
    body : text("body"),
    isRead : boolean("is_read").notNull().default(false),
    labels:json("labels").$type<string[]>().notNull().default([]),
    priority : text("priority").$type<EmailPriority>().notNull().default("normal"),
    attachments : json("attachments").$type<EmailAttachment[]>().notNull().default([]),
    // Embedding generated from subject + body for semantic search
    embedding : vector("embedding"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(), 
})


export const drafts = pgTable("drafts",{
    id : uuid("id").primaryKey().defaultRandom(),
    userId : uuid("user_id")
    .notNull()
    .references(() => users.id,{onDelete : "cascade"}),
    gmailDraftId:text("gmail_draft_id"), // null until first save to Gmail
    toAddrs: json("to_addrs").$type<string[]>().notNull().default([]),
    ccAddrs: json("cc_addrs").$type<string[]>().notNull().default([]),
    subject : text('subject'),
    body : text("body"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export type DbEmail = typeof emails.$inferSelect;
export type DbEmailInsert = typeof emails.$inferInsert;
export type DbDraft = typeof drafts.$inferSelect;
export type DbDraftInsert = typeof drafts.$inferInsert;