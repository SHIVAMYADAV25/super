import { customType, json, pgTable, text, uuid,boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { users } from "./users";
import { EmailAttachment, EmailPriority } from "@/src/types";
import { EMBEDDING_DIM } from "@/src/server/lib/llm-provider";


const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    // EMBEDDING_DIM is derived from ACTIVE_EMBEDDING_MODEL in llm-provider.ts.
    // Changing LLM_EMBEDDING_MODEL in .env automatically updates the column type
    // used in ORM queries (raw SQL casts must also use EMBEDDING_DIM — see
    // search.service.ts).
    return `vector(${EMBEDDING_DIM})`;
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value.replace(/^\[/, "[").replace(/\]$/, "]"));
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
});

export const emails = pgTable(
  "emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    gmailId: text("gmail_id").notNull(),

    threadId: text("thread_id"),
    fromAddr: text("from_addr"),

    toAddrs: json("to_addrs").$type<string[]>().notNull().default([]),
    ccAddrs: json("cc_addrs").$type<string[]>().notNull().default([]),
    bccAddrs: json("bcc_addrs").$type<string[]>().notNull().default([]),

    subject: text("subject"),
    snippet: text("snippet"),
    body: text("body"),

    isRead: boolean("is_read").notNull().default(false),

    labels: json("labels").$type<string[]>().notNull().default([]),

    priority: text("priority")
      .$type<EmailPriority>()
      .notNull()
      .default("normal"),

    attachments: json("attachments")
      .$type<EmailAttachment[]>()
      .notNull()
      .default([]),

    embedding: vector("embedding"),

    receivedAt: timestamp("received_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table: { userId: any; gmailId: any; }) => ({
    emailsUserGmailUnique: unique("emails_user_gmail_unique").on(
      table.userId,
      table.gmailId
    ),
  })
);


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