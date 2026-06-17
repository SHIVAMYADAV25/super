ALTER TABLE "users" ADD COLUMN "google_sub" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gmail_history_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gmail_watch_expiration" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "calendar_channel_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "calendar_resource_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "calendar_watch_expiration" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub");