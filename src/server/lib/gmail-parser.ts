// import { EmailAttachment } from "@/src/types";

// interface GmailHeader{
//     name ?: string;
//     value ?: string;
// }

// interface GmailBody{
//     data ?: string;
//     size ?: number;
//     attachmentId ?: string;
// }

// interface GmailPart{
//     partId ?: string;
//     mimeType ?:string;
//     filename ?: string;
//     headers ?: GmailHeader[];
//     body ?: GmailBody;
//     parts ?: GmailPart[];
// }


// // interface GmailMessage {
// //     id ?: string;
// //     threadId ?: string;
// //     labelIds ?: string[];
// //     snippet ?: string;
// //     internalDate ?: string | number | Date | null;
// //     payload ?: GmailPart;
// //     raw ?: string;
// // }

// export interface GmailMessage {
//   id?: string;
//   threadId?: string;
//   labelIds?: string[];
//   snippet?: string;
//   internalDate?: string | number | Date | null;
//   payload?: GmailPart;
//   raw?: string;
// }

// // header exactration

// export function extractHeader(
//     headers : GmailHeader[] | undefined,
//     name : string,
// ): string | null{
//     if(!headers) return null;
//     const found = headers.find(
//         (h) => h.name?.toLowerCase() === name.toLowerCase(),
//     );

//     return found?.value ?? null;
// }

// // parse address into array (mistry)

// function parseAddressList(value:string | null):string[]{
//     if(!value) return [];

//     // Handles "Name <email@example.com>, email2@example.com"
//     return value
//     .split(/,\s*/)
//     .map((addr) => {
//         const match = addr.match(/<(.+?)?/);
//         return (match ? match[1] : addr).trim();
//     })
//     .filter(Boolean);
// }

// // body extraction
// function decodeBase64Url(data :string):string{
//     // gmail use Url-safe base64
//     const base64 = data.replace(/-/g,"+").replace(/_/g,"/");
//     try{
//         return Buffer.from(base64,"base64").toString("utf-8");
//     }catch{
//         return "";
//     }
// }



// function extractBodyFromParts(
//     parts : GmailPart[],
//     preferHtml ?: true,
// ):{text : string ; html : string  | null}{
//     let text = "";
//     let html : string | null = null;

//     for(const part of parts){
//         if(part.parts && part.parts.length > 0){
//             // recurse into multipart
//             const nested = extractBodyFromParts(part.parts,preferHtml);
//             if(nested.text) text = nested.text;
//             if(nested.html) html = nested.html;
//             continue
//         }

//         if(!part.body?.data) continue;

//         const decoded = decodeBase64Url(part.body.data);

//         if(part.mimeType === "text/html"){
//             html =  decoded
//         }else if(part.mimeType === "text/plain"){
//             text =  decoded
//         }
//     }

//     return {text,html};
// }


// function extractBody(payload:GmailPart) : {text : string;html : string | null}{
//     // sigle-part message
//     if(!payload.parts || payload.parts.length === 0){
//         if(payload.body?.data){
//             const decoded = decodeBase64Url(payload.body.data);
//             if(payload.mimeType === "text/html"){
//                 return {text : decoded.replace(/<[^>]+>/g, " "),html:decoded}
//             }
//             return {text : decoded,html : null};  
//         }
//         return {text:"",html:null}
//     }

//     return extractBodyFromParts(payload.parts);
// }

// // Attachment extraction

// function extractAttachments(payload : GmailPart) : EmailAttachment[]{
//     const attachments:EmailAttachment[] = [];

//     function walk(parts : GmailPart[]){
//         for (const part of parts){
//             if(part.filename && part.filename.length > 0 && part.body){
//                 attachments.push({
//                     filename : part.filename,
//                     mimeType:part.mimeType ?? "application/octet-stream",
//                     size : part.body.size ?? 0,
//                     attachmentId : part.body.attachmentId,
//                 });
//             }

//             if(part.parts) walk(part.parts);
//         }
//     }

//     if(payload.parts) walk(payload.parts);
//     return attachments;
// }

// // Main parser


// export interface ParsedEmail {
//   gmailId: string;
//   threadId: string | null;
//   fromAddr: string | null;
//   toAddrs: string[];
//   ccAddrs: string[];
//   subject: string | null;
//   snippet: string | null;
//   body: string | null;
//   bodyHtml: string | null;
//   isRead: boolean;
//   labels: string[];
//   attachments: EmailAttachment[];
//   receivedAt: Date | null;
// }

// export function parseGmailMessage(msg:GmailMessage):ParsedEmail{
//     const headers =  msg.payload?.headers ?? [];
//     const {text,html} = msg.payload ? extractBody(msg.payload) : {text : "",html : null};

//     const internalDate = msg.internalDate;
//     let receivedAt : Date | null = null;
//     if(internalDate){
//         const ts  = typeof internalDate === "number"
//         ? internalDate
//         : typeof internalDate === "string"
//         ? parseInt(internalDate,10)
//         : internalDate instanceof Date
//         ? internalDate.getTime()
//         : null;

//     if(ts) receivedAt = new Date(ts)
//     }

//     return {
//     gmailId: msg.id ?? "",
//     threadId: msg.threadId ?? null,
//     fromAddr: extractHeader(headers, "From"),
//     toAddrs: parseAddressList(extractHeader(headers, "To")),
//     ccAddrs: parseAddressList(extractHeader(headers, "Cc")),
//     subject: extractHeader(headers, "Subject"),
//     snippet: msg.snippet ?? null,
//     body: text || (html ? html.replace(/<[^>]+>/g, " ") : null),
//     bodyHtml: html,
//     isRead: !(msg.labelIds ?? []).includes("UNREAD"),
//     labels: msg.labelIds ?? [],
//     attachments: msg.payload ? extractAttachments(msg.payload) : [],
//     receivedAt,
//   };
// }


// // MIME builder for send


// export interface BuilderMimeOption{
//     from ?: string;
//     to : string[];
//     cc ?: string[];
//     bcc ?: string[];
//     subject : string;
//     body : string;
//     threadId ?: string;
// }

// /**
//  * Build a base64url-encoded RFC 2822 MIME message for Gmail API
//  */

// export function buildRawMimeMessage(opts : BuilderMimeOption):string{
//     const lines : string[] = [];

//     if(opts.from) lines.push(`From : ${opts.from}`);
//     lines.push(`TO : ${opts.to.join(", ")}`);
//     if(opts.cc?.length) lines.push(`Cc : ${opts.cc.join(", ")}`);
//     if(opts.bcc?.length) lines.push(`Bcc : ${opts.bcc.join(", ")}`);
//     lines.push(`Subject : ${opts.subject}`);
//     lines.push(`MIME-Version : 1.0`);
//     lines.push(`Content-Type:text/html; charset=UTF-8`);
//     lines.push(`Content-Transfer-Encoding: 7bit`);
//     lines.push(``);
//     lines.push(opts.body);

//     const raw = lines.join("\r\n");

//     // Gmail require URL-safe base64 (no padding)

//     return Buffer.from(raw)
//     .toString("base64")
//     .replace(/\+/g, "-")
//     .replace(/\//g, "_")
//     .replace(/=+$/, "");
// }

import type { EmailAttachment } from "@/src/types";

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailBody {
  data?: string;
  size?: number;
  attachmentId?: string;
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailPart[];
}

export interface GmailMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string | number | Date | null;
  payload?: GmailPart;
  raw?: string;
}

export function extractHeader(headers: GmailHeader[] | undefined, name: string): string | null {
  if (!headers) return null;
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function parseAddressList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/,\s*/)
    .map((addr) => {
      const match = addr.match(/<([^>]+)>/);
      return (match ? match[1] : addr).trim();
    })
    .filter(Boolean);
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function extractBodyFromParts(parts: GmailPart[]): { text: string; html: string | null } {
  let text = "";
  let html: string | null = null;

  for (const part of parts) {
    if (part.parts?.length) {
      const nested = extractBodyFromParts(part.parts);
      if (nested.text) text = nested.text;
      if (nested.html) html = nested.html;
      continue;
    }
    if (!part.body?.data) continue;

    const decoded = decodeBase64Url(part.body.data);
    if (part.mimeType === "text/html") html = decoded;
    else if (part.mimeType === "text/plain") text = decoded;
  }

  return { text, html };
}

function extractBody(payload: GmailPart): { text: string; html: string | null } {
  if (!payload.parts?.length) {
    if (payload.body?.data) {
      const decoded = decodeBase64Url(payload.body.data);
      if (payload.mimeType === "text/html") {
        return { text: decoded.replace(/<[^>]+>/g, " "), html: decoded };
      }
      return { text: decoded, html: null };
    }
    return { text: "", html: null };
  }
  return extractBodyFromParts(payload.parts);
}

function extractAttachments(payload: GmailPart): EmailAttachment[] {
  const attachments: EmailAttachment[] = [];

  function walk(parts: GmailPart[]) {
    for (const part of parts) {
      if (part.filename && part.filename.length > 0 && part.body) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType ?? "application/octet-stream",
          size: part.body.size ?? 0,
          attachmentId: part.body.attachmentId,
        });
      }
      if (part.parts) walk(part.parts);
    }
  }

  if (payload.parts) walk(payload.parts);
  return attachments;
}

export interface ParsedEmail {
  gmailId: string;
  threadId: string | null;
  fromAddr: string | null;
  toAddrs: string[];
  ccAddrs: string[];
  subject: string | null;
  snippet: string | null;
  body: string | null;
  bodyHtml: string | null;
  isRead: boolean;
  labels: string[];
  attachments: EmailAttachment[];
  receivedAt: Date | null;
}

export function parseGmailMessage(msg: GmailMessage): ParsedEmail {
  const headers = msg.payload?.headers ?? [];
  const { text, html } = msg.payload ? extractBody(msg.payload) : { text: "", html: null };

  let receivedAt: Date | null = null;
  const internalDate = msg.internalDate;
  if (internalDate != null) {
    const ts =
      typeof internalDate === "number"
        ? internalDate
        : typeof internalDate === "string"
          ? parseInt(internalDate, 10)
          : internalDate instanceof Date
            ? internalDate.getTime()
            : null;
    if (ts && !isNaN(ts)) receivedAt = new Date(ts);
  }

  return {
    gmailId: msg.id ?? "",
    threadId: msg.threadId ?? null,
    fromAddr: extractHeader(headers, "From"),
    toAddrs: parseAddressList(extractHeader(headers, "To")),
    ccAddrs: parseAddressList(extractHeader(headers, "Cc")),
    subject: extractHeader(headers, "Subject"),
    snippet: msg.snippet ?? null,
    body: text || (html ? html.replace(/<[^>]+>/g, " ") : null),
    bodyHtml: html,
    isRead: !(msg.labelIds ?? []).includes("UNREAD"),
    labels: msg.labelIds ?? [],
    attachments: msg.payload ? extractAttachments(msg.payload) : [],
    receivedAt,
  };
}

export interface BuildMimeOptions {
  from?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
}

/** Build a base64url-encoded RFC 2822 MIME message for the Gmail API. */
export function buildRawMimeMessage(opts: BuildMimeOptions): string {
  const lines: string[] = [];

  if (opts.from) lines.push(`From: ${opts.from}`);
  lines.push(`To: ${opts.to.join(", ")}`);
  if (opts.cc?.length) lines.push(`Cc: ${opts.cc.join(", ")}`);
  if (opts.bcc?.length) lines.push(`Bcc: ${opts.bcc.join(", ")}`);
  lines.push(`Subject: ${opts.subject}`);
  lines.push(`MIME-Version: 1.0`);
  lines.push(`Content-Type: text/html; charset=UTF-8`);
  lines.push(`Content-Transfer-Encoding: 7bit`);
  lines.push("");
  lines.push(opts.body);

  const raw = lines.join("\r\n");

  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}