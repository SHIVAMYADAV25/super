import { ErrorCode } from "../types";

export class AppError extends Error {
    constructor(
        public readonly code:ErrorCode,
        message : string,
        public readonly statusCode : number = 500,
        public readonly details?:unknown,
    ){
        super(message);
        this.name = "AppError";
    }
}

// factory helpers

export const createUnauthorizedError =(message = "Not authenticated") => 
    new AppError(ErrorCode.UNAUTHORIZED,message,401);


export const createForbiddenError = (message = "Access denied") =>
    new AppError(ErrorCode.FORBIDDEN,message,403);

export const createNotFoundError = (resource:string) => 
    new AppError(ErrorCode.NOT_FOUND,`${resource} not found`,404);

export const createValidationError = (
    message : string,
    details ?: unknown
) => new AppError(ErrorCode.VALIDATION_ERROR,message,400,details);

export const createExternalApiError = (
    service : string,
    originalError ?: unknown,
)=> new AppError(
    ErrorCode.EXTERNAL_API_ERROR,
    `External API error from ${service}`,
    502,
    originalError instanceof Error ? originalError.message : originalError
);

export const createRateLimitError = () => new AppError(ErrorCode.RATE_LIMITED,"Too many request Please slow down.",429);

export const createInternalError = (message = "An unexpected error occurred") =>
    new AppError(ErrorCode.INTERNAL_ERROR,message,500);

export const isAppError = (err : unknown):err is AppError => err instanceof AppError