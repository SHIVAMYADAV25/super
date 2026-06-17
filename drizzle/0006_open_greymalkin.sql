ALTER TABLE "emails" RENAME COLUMN "gamil_id" TO "gmail_id";--> statement-breakpoint
ALTER TABLE "emails" DROP CONSTRAINT "emails_user_gmail_unique";--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_user_gmail_unique" UNIQUE("user_id","gmail_id");