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
    id: string;          // DB UUID
    googleSub: string;   // Google User ID
    email : string;
    name ?: string |null;
    image ?: string | null;
}

export type EmailPriority = "high" | "normal"| "low";
export type EmailFolder = "INBOX" | "SENT" | "DRAFTS" | "TRASH" | "SPAM";

export interface Email {
    id:string;
    userId : string;
    gmailId : string;
    threadId : string | null;
    fromAddr : string | null;
    toAddrs : string[];
    ccAddrs : string[];
    subject : string | null;
    snippet : string | null;
    body : string | null;
    isRead : boolean;
    labels : string[];
    priority : EmailPriority;
    receivedAt : Date | null;
    attachments : EmailAttachment[];
}

export interface EmailAttachment{
    filename : string;
    mimeType : string;
    size : number;
    attachmentId ?: string;
}
export interface EmailListItem{
    id:string;
    gmailId: string;
    threadId: string | null;
    fromAddr: string | null;
    subject: string | null;
    snippet: string | null;
    isRead: boolean;
    labels: string[];
    priority: EmailPriority;
    receivedAt: Date | null;
}

export interface SendEmailInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  draftId?: string;
}

// ─── Calendar ──────────────────────────────────────────────────────────────────
 
export type RSVPStatus = "accepted" | "declined" | "tentative" | "needsAction";
export type EventStatus = "confirmed" | "tentative" | "cancelled";

export interface RSVPInput {
  status: RSVPStatus;
}

export interface Attendee {
  email: string;
  displayName?: string;
  responseStatus: RSVPStatus;
  self?: boolean;
  organizer?: boolean;
}

export interface CalendarEvent {
  id: string;
  userId: string;
  gcalId: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  startTime: string; // ISO
  endTime: string; // ISO
  startTimeZone?: string;
  endTimeZone?: string;
  attendees: Attendee[];
  status: EventStatus;
  htmlLink?: string;
  createdAt: Date;
  recurringEventId?: string | null;
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  location?: string;
  startTime: string; // ISO
  endTime: string; // ISO
  timeZone?: string;
  attendees?: string[]; // email addresses
  sendUpdates?: "all" | "externalOnly" | "none";
}

// ─── Search ────────────────────────────────────────────────────────────────────
 
export type SearchMode = "text" | "semantic" | "both";
 
export interface SearchResult {
  type: "email" | "event";
  id: string;
  title: string;
  snippet: string;
  date: Date | null;
  relevanceScore?: number;
}

// ─── Agent Chat ────────────────────────────────────────────────────────────────
 
export type ActionType = "email_sent" | "event_created" | "event_updated";
 
export interface AgentAction {
  type: ActionType;
  summary: string;
  resourceId?: string;
}
 
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: AgentAction[];
  createdAt: Date;
}

// ─── Webhook SSE ───────────────────────────────────────────────────────────────
 
export interface SSEEvent {
  type: "new_email" | "new_event" | "updated_event" | "heartbeat" | "email_enriched";
  data?: unknown;
}