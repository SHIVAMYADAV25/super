type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
    level : LogLevel;
    message : string;
    timestamp : string;
    requestId ?: string;
    [key : string] : unknown;
}

function log(level : LogLevel,message : string, meta?: Record<string,unknown>):void{
    const entry : LogEntry = {
        level,
        message,
        timestamp : new Date().toISOString(),
        ...meta,
    }

    if(process.env.NODE_ENV === "production"){
        const output = JSON.stringify(entry);
        if(level === "error" || level === "warn"){
            console.error(output);
        }else{
            console.log(output)
        }
        return;
    }

    const prefix = `[${entry.timestamp}] [${level.toUpperCase()}]`;
    const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    const msg = `${prefix} ${message}${metaStr}`;

    switch(level){
        case "error":
            console.error(msg);
            break;
        case "warn":
            console.warn(msg);
            break;
        default:
            console.log(msg);
    }
}

export const logger = {
    debug : (message : string, meta ?: Record<string,unknown>) =>
        log("debug", message, meta),

    info : (message : string, meta ?: Record<string,unknown>) =>
        log("info", message, meta),

    warn : (message : string, meta ?: Record<string,unknown>) =>
        log("warn", message, meta),

    error : (message : string, meta ?: Record<string,unknown>) =>
        log("error", message, meta),
}