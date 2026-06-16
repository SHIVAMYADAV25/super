// src/schema/index.ts — full replacement
// Changes vs your current file:
//   1. Added calendarType to CreateEventBaseSchema and UpdateEventSchema
//   2. Fixed attendees: array of email strings (matching your existing CreateEventInput type)
//   3. Exported CalendarTypeEnum for reuse

import z from "zod";

export const SessionUserSchema = z.object({
    id: z.string().min(1),
    email : z.string().email(),
    name : z.string().nullable().optional(),
    image : z.string().url().nullable().optional(),
})

export const OAuthCallbackSchema = z.object({
    code : z.string().min(1),
    state : z.string().min(1),
})

// EMAIL

export const SendEmailSchema = z.object({
    to :z
    .array(z.string().email("Invalid Recipient email"))
    .min(1,"Atleast one recipient required"),
    cc : z.array(z.string().email("Invalid CC email")).optional().default([]),
    bcc : z.array(z.string().email("Invalid BCC email")).optional().default([]),
    body : z.string().min(1,"Email body is required"),
    subject : z.string().min(1,"Subject is required").max(998,"Subject too long"),
    draftId : z.string().uuid().optional(),
});

export const ListEmailsSchema = z.object({
    folder : z
    .enum(["INBOX","SENT","DRAFT","TRASH","SPAM"])
    .optional()
    .default("INBOX"),
    q : z.string().max(500).optional(),
    limit : z.coerce.number().int().min(1).max(100).optional().default(50),
    labelIds : z.array(z.string()).optional(), 
    pageToken: z.string().optional(),
    priority: z.enum(["all", "high", "normal", "low"]).optional().default("all"),
})

export const EmailIdSchema = z.object({
    id : z.string().min(1,"Email ID is required"),
});

export const MarkEmailSchema = z.object({
    isRead : z.boolean().optional(),
    labels : z.
    object({
        add : z.array(z.string()).optional().default([]),
        remove : z.array(z.string()).optional().default([]),
    })
    .optional(),
})

export const SaveDraftSchema = z.object({
    to : z.array(z.string().email()).optional().default([]),
    cc : z.array(z.string().email()).optional().default([]),
    subject : z.string().max(998).optional().default(""),
    body : z.string().optional().default(""),
})

export const UpdateDraftSchema = SaveDraftSchema;

// ─── Calendar ─────────────────────────────────────────────────────────────────

// ── NEW: shared enum used by both Create and Update schemas ──────────────────
export const CalendarTypeEnum = z.enum([
  "Work",
  "Personal",
  "Meetings",
  "Study",
  "Deadlines",
]);

const CreateEventBaseSchema = z.object({
  summary: z.string().min(1, "Event title is required").max(500),
  description: z.string().max(8192).optional(),
  location: z.string().max(500).optional(),
  startTime: z.string().datetime({
    message: "Invalid start time (ISO 8601 required)",
  }),
  endTime: z.string().datetime({
    message: "Invalid end time (ISO 8601 required)",
  }),
  timeZone: z.string().optional(),
  // attendees is array of email strings — matches your CreateEventInput type
  attendees: z
    .array(z.string().email("Invalid attendee email"))
    .max(100)
    .optional()
    .default([]),
  sendUpdates: z
    .enum(["all", "externalOnly", "none"])
    .optional()
    .default("all"),

  // ── NEW: user-chosen calendar category, stored in DB ──────────────────────
  calendarType: CalendarTypeEnum.optional().default("Work"),
});

export const CreateEventSchema = CreateEventBaseSchema.refine(
  (data) => new Date(data.endTime) > new Date(data.startTime),
  {
    message: "End time must be after start time",
    path: ["endTime"],
  }
);

export const UpdateEventSchema = CreateEventBaseSchema.partial().extend({
  sendUpdates: z
    .enum(["all", "externalOnly", "none"])
    .optional()
    .default("all"),
  // ── NEW: allow updating calendarType independently ─────────────────────
  calendarType: CalendarTypeEnum.optional(),
});

export const ListEventSchema = z.object({
    from : z.string().datetime().optional(),
    to : z.string().datetime().optional(),
    q : z.string().max(500).optional(),
    maxResults : z.coerce.number().int().min(1).max(250).optional().default(50),
})

export const RSVPSchema = z.object({
    status : z.enum(["accepted","declined","tentative"])
});

// search

export const searchSchema = z.object({
    q : z.string().min(1,"Search query is required").max(500),
    mode : z.enum(["text","semantic","both"]).optional().default("both"),
    limit : z.coerce.number().int().min(1).max(50).optional().default(20),
});

// chat

export const ChatMessageSchema = z.object({
    prompt:z.string()
    .min(1,"Message cannot be empty")
    .max(2000,"Message too long (max 2000 chars"),
    conversationHistory : z
    .array(
        z.object({
            role: z.enum(["user" , "assistant"]),
            content : z.string()
        }),
    )
    .max(20)
    .optional()
    .default([]),
})

export type SendEmailInput = z.infer<typeof SendEmailSchema>;
export type ListEmailsInput = z.infer<typeof ListEmailsSchema>;
export type SaveDraftInput = z.input<typeof SaveDraftSchema>;
export type CreateEventInput = z.infer<typeof CreateEventSchema>;
export type UpdateEventInput = z.infer<typeof UpdateEventSchema>;
export type ListEventInput = z.infer<typeof ListEventSchema>;
export type RSVPInput = z.infer<typeof RSVPSchema>;
export type SearchInput = z.infer<typeof searchSchema>;
export type ChatInput = z.infer<typeof ChatMessageSchema>;
export type MarkEmailInput = z.input<typeof MarkEmailSchema>;