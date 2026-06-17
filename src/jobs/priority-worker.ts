import { Worker } from "bullmq";
import { redis } from "./redis-bullmq";
import { logger } from "@/src/lib/logger";

if (process.env.NODE_ENV === "production" && redis) {
  new Worker(
    "email-enrichment",
    async (job) => {
      const { enrichEmail } = await import(
        "../server/services/priority.service"
      );

      await enrichEmail(job.data);
    },
    {
      connection: redis,
      concurrency: 3,
    },
  );

  logger.info("Email enrichment worker started");
} else {
  logger.info("BullMQ worker disabled in development");
}