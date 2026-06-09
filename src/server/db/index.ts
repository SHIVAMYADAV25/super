
import { env } from "@/src/env";
import { drizzle } from "drizzle-orm/singlestore/driver";
import {Pool} from "pg"
import * as schema from "./schema"


// Singleton pool — reused across serverless invocations via module cache
const globalForPg = globalThis as unknown as {pool : Pool | undefined};


export const pool = 
    globalForPg.pool ??
    new Pool({
        connectionString: env.DATABASE_URL,
        max:10,
        idleTimeoutMillis:30_000,
        connectionTimeoutMillis:5_000,
    })

if(process.env.NODE_ENV !== "production"){
    globalForPg.pool = pool;
}

// Drizzle ORM instance - used for all typed queries in our own tables
export const db = drizzle(pool,{schema})

export type Db = typeof db;