import { NextResponse } from "next/server";
import { ApiResponse, ErrorCode } from "../types";
import { isAppError } from "./errors";
import { ZodError } from "zod";
import { logger } from "./logger";

export function success <T>(data : T,status = 200):NextResponse<ApiResponse<T>> {
    return NextResponse.json({ok : true,data},{status})
}

export function errorResponse(
    code : ErrorCode,
    message : string,
    status : number,
    details ?: unknown,
): NextResponse<ApiResponse<never>>{
    return NextResponse.json(
        {ok : false,error:{code,message,details}},
        {status},
    )
}

export function handleRouteError(
    err: unknown,
    requestId ?: string
): NextResponse<ApiResponse<never>>{
    // zod validation add karna hai
    if(err instanceof ZodError){
        return errorResponse(
            ErrorCode.VALIDATION_ERROR,
            "validation failed",
            400,
            err.flatten().fieldErrors,
        )
    }

    // our typed app error
    if(isAppError(err)){
        if(err.statusCode >= 500){
            logger.error("AppError", {code : err.code,message : err.message,requestId});
        }
        return errorResponse(err.code,err.message,err.statusCode,err.details);
    }

    // unknown error -  never leak internals
    logger.error("unhandled route error", {
        error : err instanceof Error ? err.message : String(err),
        stack : err instanceof Error ? err.stack : undefined,
        requestId,
    })

    return errorResponse(ErrorCode.INTERNAL_ERROR,"An unexpected error occurred",500);
}