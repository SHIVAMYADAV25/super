import {
  pgTable,
  text,
  timestamp,
  uuid,
  json,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { AgentAction } from "@/src/types";


export const agentLogs = pgTable("agent_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  response: text("response"),
  actions: json("actions").$type<AgentAction[]>().notNull().default([]),
  durationMs: text("duration_ms"), // stored as string to avoid precision loss
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DbAgentLog = typeof agentLogs.$inferSelect;
export type DbAgentLogInsert = typeof agentLogs.$inferInsert;