import { nanoid } from "nanoid";


/**
 * Generate a unique request ID for tracing.
 * Attach to all log entries for correlation.
 */
export function generateRequestId(): string{
    return nanoid(12);
}


/**
 * Extract request ID from header or generate a new one.
 */
export function getRequestId(headers:Headers):string{
    return headers.get("x-request-id") ?? generateRequestId();
}