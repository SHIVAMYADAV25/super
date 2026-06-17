export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV === "production" &&
    process.env.REDIS_URL
  ) {
    await import("./src/jobs/priority-worker");
  }
}