import { logger } from "@/src/lib/logger";
import { pool } from "@/src/server/db";
import { NextResponse } from "next/server";

export async function GET() {
    const checks:Record<string,"ok" | "error" > = {};

    try{
        await pool.query("SELECT 1");
        checks.db = "ok";
    }catch (err) {
        logger.error("Health check: DB unreachable", { error: String(err) });
        checks.db = "error";
    }

    const allHealthy = Object.values(checks).every((v) => v === "ok");

    return NextResponse.json({
        ok : allHealthy,
        checks,
        ts : Date.now(),
        env : process.env.NODE_ENV,
    },
    { status : allHealthy ? 200 : 503},
    )

}