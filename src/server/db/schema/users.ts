import { pgTable,text,timestamp,uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    email : text("email").notNull().unique(),
    name : text("name"),
    image:text("image"),
    createdAt : timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
    updatedAt : timestamp("updated_at",{withTimezone:true}).defaultNow().notNull(),
})

export type DbUser = typeof users.$inferSelect;
export type DbUserInsert = typeof users.$inferInsert;