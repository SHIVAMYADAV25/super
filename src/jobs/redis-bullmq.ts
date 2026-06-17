import IORedis from "ioredis";

let redis: IORedis | null = null;
console.log(process.env.NODE_ENV)

if (process.env.NODE_ENV === "production") {
  redis = new IORedis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
  });
}

export { redis };