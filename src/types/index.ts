export interface PaginatedResponse<T> {
    items : T[],
    nextPageToken?:string;
    total?:number;
}

export type ApiSuccess <T> = {ok:true,data:T};

export type ApiError = {
    ok:false,
    error : {code : ErrorCode; message:string;details?:unknown}
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError

export enum ErrorCode {
    UNAUTHORIZED = "UNAUTHORIZED",
    FORBIDDEN = "FORBIDDEN",
    NOT_FOUND = "NOT_FOUND",
    VALIDATION_ERROR = "VALIDATION_ERROR",
    EXTERNAL_API_ERROR = "EXTERNAL_API_ERROR",
    RATE_LIMITED = "RATE_LIMITED",
    INTERNAL_ERROR = "INTERNAL_ERROR",
    CONFLICT = "CONFLICT"
}

export interface User {
    id : string;
    email : string;
    name : string | null;
    image : string | null;
    createdAt : Date
}


export interface SessionUser {
    id : string;
    email : string;
    name ?: string |null;
    image ?: string | null;
}

export type EmailPriority = "high" | "normal"| "low";
export type EmailFolder = "INBOX" | "SENT" | "DRAFTS" | "TRASH" | "SPAM";

// export interface Email {
//     id:string;
//     userId : string;
//     gmailId : string;

// }