// "use client";

// import { useState, useEffect, useCallback, useMemo } from "react";
// import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
// import { api } from "@/src/lib/api-client";
// import { EmailListItem, Email, PaginatedResponse } from "@/src/types";
// import DOMPurify from "isomorphic-dompurify";
// import { ComposeModal } from "@/src/components/compose/compose-modal";
// import { SearchCommand } from "@/src/components/search/search-command";
// import { isToday, isYesterday, subDays, isAfter, startOfMonth } from "date-fns";
// import { Pencil, Search } from "lucide-react";
// // Import the optimized multi-pane layout detail view component
// import { EmailDetail } from "@/src/components/Email/EmailDetail";

// const TIMELINE_ORDER = ["Today", "Yesterday", "Last 7 days", "Earlier this month"];

// type TabType = "inbox"| "important" | "secondary" | "standard_feed" | "notification" | "support" | "others";

// function getTimelineGroup(dateString: string | undefined): string {
//   if (!dateString) return "Earlier this month";
//   const date = new Date(dateString);
//   if (isToday(date)) return "Today";
//   if (isYesterday(date)) return "Yesterday";
//   if (isAfter(date, subDays(new Date(), 7))) return "Last 7 days";
//   if (isAfter(date, startOfMonth(new Date()))) return "Earlier this month";
//   return "Earlier this month";
// }

// interface BadgeProp {
//   name: string;
//   style: string;
// }

// function getInlineBadgeProps(subject: string = "", labels: string[] = []): BadgeProp[] {
//   const lookups = [...labels, subject].join(" ").toLowerCase();
//   const matchedBadges: BadgeProp[] = [];

//   // 1. URGENT
//   if (
//     lookups.includes("urgent") || 
//     lookups.includes("immediately") || 
//     lookups.includes("critical") || 
//     lookups.includes("asap") || 
//     lookups.includes("attention required") ||
//     lookups.includes("failed production")
//   ) {
//     matchedBadges.push({ name: "urgent", style: "bg-[var(--tag-urgent-bg)] text-[var(--tag-urgent-text)] border border-blue-500/10" });
//   }

//   // 2. ACTION REQUIRED
//   if (
//     lookups.includes("invitation") || 
//     lookups.includes("approve") || 
//     lookups.includes("review") || 
//     lookups.includes("respond") || 
//     lookups.includes("verify") || 
//     lookups.includes("complete") || 
//     lookups.includes("action required") || 
//     lookups.includes("waiting for your response") ||
//     lookups.includes("invited you")
//   ) {
//     matchedBadges.push({ name: "action", style: "bg-[var(--tag-action-bg)] text-[var(--tag-action-text)]" });
//   }

//   // 3. JOB / INTERNSHIP
//   if (
//     lookups.includes("internship") || 
//     lookups.includes("job") || 
//     lookups.includes("career") || 
//     lookups.includes("hiring") || 
//     lookups.includes("recruiter") || 
//     lookups.includes("application") || 
//     lookups.includes("interview") ||
//     lookups.includes("sde intern")
//   ) {
//     matchedBadges.push({ name: "job", style: "bg-[var(--tag-job-bg)] text-[var(--tag-job-text)]" });
//   }

//   // 4. MEETING
//   if (
//     lookups.includes("meeting") || 
//     lookups.includes("calendar") || 
//     lookups.includes("schedule") || 
//     lookups.includes("zoom") || 
//     lookups.includes("google meet") || 
//     lookups.includes("appointment")
//   ) {
//     matchedBadges.push({ name: "meeting", style: "bg-[var(--tag-meeting-bg)] text-[var(--tag-meeting-text)]" });
//   }

//   // 5. FINANCE / BILLING
//   if (
//     lookups.includes("invoice") || 
//     lookups.includes("payment") || 
//     lookups.includes("billing") || 
//     lookups.includes("subscription") || 
//     lookups.includes("receipt") || 
//     lookups.includes("transaction") || 
//     lookups.includes("refund") ||
//     lookups.includes("token spend")
//   ) {
//     matchedBadges.push({ name: "finance", style: "bg-[var(--tag-finance-bg)] text-[var(--tag-finance-text)]" });
//   }

//   // 6. SECURITY
//   if (
//     lookups.includes("security") || 
//     lookups.includes("password") || 
//     lookups.includes("login") || 
//     lookups.includes("verification") || 
//     lookups.includes("2fa") || 
//     lookups.includes("otp") || 
//     lookups.includes("account access") || 
//     lookups.includes("privacy settings")
//   ) {
//     matchedBadges.push({ name: "security", style: "bg-[var(--tag-security-bg)] text-[var(--tag-security-text)]" });
//   }

//   // 7. DEPLOYMENT
//   if (
//     lookups.includes("deployment") || 
//     lookups.includes("production") || 
//     lookups.includes("build failed") || 
//     lookups.includes("vercel") || 
//     lookups.includes("railway") || 
//     lookups.includes("netlify") || 
//     lookups.includes("render") || 
//     lookups.includes("server") ||
//     lookups.includes("sandbox")
//   ) {
//     matchedBadges.push({ name: "deployment", style: "bg-blue-500/10 text-blue-500 dark:bg-blue-950/40 dark:text-blue-400" });
//   }

//   // 8. SOCIAL
//   if (
//     lookups.includes("linkedin") || 
//     lookups.includes("message") || 
//     lookups.includes("connection") || 
//     lookups.includes("social") ||
//     lookups.includes("category_social")
//   ) {
//     matchedBadges.push({ name: "social", style: "bg-[var(--tag-social-bg)] text-[var(--tag-social-text)]" });
//   }

//   // 9. NEWSLETTER
//   if (
//     lookups.includes("newsletter") || 
//     lookups.includes("digest") || 
//     lookups.includes("weekly") || 
//     lookups.includes("monthly") || 
//     lookups.includes("edition") || 
//     lookups.includes("update") ||
//     lookups.includes("category_updates")
//   ) {
//     matchedBadges.push({ name: "newsletter", style: "bg-[var(--tag-newsletter-bg)] text-[var(--tag-newsletter-text)]" });
//   }

//   // 10. PROMOTION
//   if (
//     lookups.includes("sale") || 
//     lookups.includes("discount") || 
//     lookups.includes("offer") || 
//     lookups.includes("deal") || 
//     lookups.includes("special") || 
//     lookups.includes("coupon") || 
//     lookups.includes("promotion") ||
//     lookups.includes("category_promotions") ||
//     lookups.includes("pinterest") ||
//     lookups.includes("canva")
//   ) {
//     matchedBadges.push({ name: "promotion", style: "bg-[var(--tag-promotion-bg)] text-[var(--tag-promotion-text)]" });
//   }

//   // 11. SUPPORT
//   if (
//     lookups.includes("ticket") || 
//     lookups.includes("issue") || 
//     lookups.includes("support") || 
//     lookups.includes("help") || 
//     lookups.includes("customer service") ||
//     lookups.includes("buffer")
//   ) {
//     matchedBadges.push({ name: "support", style: "bg-tag-support-bg text-tag-support-text" });
//   }

//   // 12. EDUCATION
//   if (
//     lookups.includes("course") || 
//     lookups.includes("learn") || 
//     lookups.includes("training") || 
//     lookups.includes("certificate") || 
//     lookups.includes("workshop") || 
//     lookups.includes("bootcamp") ||
//     lookups.includes("leetcode") ||
//     lookups.includes("tutorial") ||
//     lookups.includes("instructors")
//   ) {
//     matchedBadges.push({ name: "education", style: "bg-[var(--tag-education-bg)] text-[var(--tag-education-text)]" });
//   }

//   // 13. DESIGN
//   if (
//     lookups.includes("design") || 
//     lookups.includes("figma") || 
//     lookups.includes("ui") || 
//     lookups.includes("portfolio") ||
//     lookups.includes("web designs")
//   ) {
//     matchedBadges.push({ name: "design", style: "bg-tag-design-bg text-tag-design-text" });
//   }

//   // 14. PRODUCT
//   if (
//     lookups.includes("product") || 
//     lookups.includes("roadmap") ||
//     lookups.includes("feature") ||
//     lookups.includes("shipped")
//   ) {
//     matchedBadges.push({ name: "product", style: "bg-tag-product-bg text-tag-product-text" });
//   }

//   // 15. PERSONAL (Fallback match criteria)
//   if (
//     matchedBadges.length === 0 && (
//       lookups.includes("family") || 
//       lookups.includes("friend") || 
//       lookups.includes("personal") ||
//       lookups.includes("category_personal")
//     )
//   ) {
//     matchedBadges.push({ name: "personal", style: "bg-[var(--tag-personal-bg)] text-[var(--tag-personal-text)]" });
//   }

//   return matchedBadges;
// }

// // ─── EMAIL STREAM ROW (STRUCTURAL OVERRIDES LOCKED) ──────────────────────────
// function EmailRow({
//   email,
//   isSelected,
//   onClick,
// }: {
//   email: EmailListItem;
//   isSelected: boolean;
//   onClick: () => void;
// }) {
//   const fromName = email.fromAddr?.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim() ?? email.fromAddr ?? "Unknown";
//   const badges = getInlineBadgeProps(email.subject ?? "", email.labels ?? []);
  
//   // Enforce a strict single-tag display condition by pulling only the primary matched entry
//   const displayBadge = Array.isArray(badges) && badges.length > 0 ? badges[0] : null;

//   const rowDate = email.receivedAt 
//     ? new Date(email.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
//     : "";

//   return (
//     <button
//       onClick={onClick}
//       className={`w-full flex items-center justify-between px-10 py-2.5 text-left
//         transition-colors duration-100 select-none relative outline-none
//         ${isSelected ? "bg-surface-2 text-text-primary" : "hover:bg-surface-1 text-text-secondary"}`}
//     >
//       <div className="flex items-center gap-5 min-w-0 flex-1 pr-4">
//         {/* Sender Area */}
//         <div style={{fontSize:"14px"}} className={`w-44 shrink-0 truncate text-sm tracking-super-tight flex items-center ${!email.isRead ? "text-text-primary font-semibold" : "text-text-secondary font-medium"}`}>
//           <div className="w-1.5 h-1.5 flex items-center justify-center shrink-0 mr-2">
//             {!email.isRead && <div className="w-1.5 h-1.5 rounded-full bg-[#79BAD8]" />}
//           </div>
//           <div className="truncate">
//             {fromName}
//           </div>
//         </div>

//         {/* Dynamic Label Badges + Text Context Layout */}
//         <div style={{ marginLeft: "48px" }} className="flex items-center gap-3 min-w-0 flex-1 text-sm truncate tracking-super-tight">
//           {displayBadge && (
//             <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider shrink-0 uppercase min-w-[54px] text-center ${displayBadge.style}`}>
//               {displayBadge.name}
//             </span>
//           )}
          
//           <span style={{ fontWeight: 500 }} className={`truncate ${!email.isRead ? "text-text-primary font-semibold" : "text-text-primary/90 font-medium "}`}>
//             {email.subject ?? "(no subject)"}
//           </span>
//           {email.snippet && (
//             <span className="text-text-secondary/60 font-normal truncate ml-2 text-[13px]">{email.snippet}</span>
//           )}
//         </div>
//       </div>

//       <div style={{fontSize:"13px"}} className="text-xxs tracking-super-wide text-text-tertiary font-medium shrink-0 text-right w-16 font-mono">
//         {rowDate}
//       </div>
//     </button>
//   );
// }

// // ─── RECENT OPENS SIDEBAR ────────────────────────────────────────────────────
// function RecentOpensSidebar({ 
//   hasSelectedEmail, 
//   onSelectRecent 
// }: { 
//   hasSelectedEmail: boolean; 
//   onSelectRecent: (id: string) => void;
// }) {
//   const items = [
//     { id: "19ec313135361f62", name: "Aman Raj", time: "34 mins ago", desc: "You have an invitation ✉️" },
//     { id: "19ec380fd7640730", name: "Devo jeet", time: "46 mins ago", desc: "You have an invitation" },
//     { id: "19eb72ca19b44781", name: "Vercel", time: "Tue 4:11 PM", desc: "Re: Introduction to 02/20 Dashlane Webinar", section: "Yesterday" },
//     { id: "19ebdbff53eefec5", name: "Railway", time: "Tue 4:09 PM", desc: "Appreciating The Product-Focused Direction!", section: "Yesterday" },
//     { id: "19ebfa42a7c88910", name: "Faizan Khan", time: "Tue 2:54 PM", desc: "Partnership & Sponsorship Media Kit", section: "Yesterday" },
//     { id: "19ebfa42a7c88910", name: "Faizan Khan", time: "Tue 2:48 PM", desc: "Follow-Up & Intro When Ready For Affiliate Conve...", section: "Yesterday" },
//     { id: "19ebc4a3232e0742", name: "virendaryadav36455-glitch", time: "Mon 5:36 PM", desc: "Re: Jason <> Alex", section: "Last 7 days" }
//   ];

//   return (
//     <div className={`w-[280px] h-full flex flex-col pt-6 select-none shrink-0 relative transition-colors duration-150 overflow-hidden
//       ${hasSelectedEmail 
//         ? "bg-surface-0 border-l border-neutral-200 dark:border-neutral-800/20" 
//         : "bg-surface-sidebar border-l border-neutral-200/60 dark:border-neutral-900/60"}`}>
      
//       <div className="px-6 pb-4 shrink-0">
//         <h2 className="text-xs font-semibold text-text-primary tracking-tight">Recent Opens</h2>
//       </div>

//       <div className="flex-1 overflow-y-auto px-6 space-y-5 pb-4 custom-thin-scrollbar">
//         <div className="space-y-3.5">
//           {items.filter(i => !i.section).map((item, idx) => (
//             <div key={idx} onClick={() => onSelectRecent(item.id)} className="min-w-0 cursor-pointer block group">
//               <div className="flex items-baseline justify-between gap-2 mb-0.5">
//                 <p className="text-xs font-medium text-text-primary/90 group-hover:text-accent transition-colors truncate">{item.name}</p>
//                 <span className="text-[10px] text-text-tertiary/70 shrink-0 font-mono">{item.time}</span>
//               </div>
//               <p className="text-xs text-text-secondary truncate leading-normal">{item.desc}</p>
//             </div>
//           ))}
//         </div>

//         {["Yesterday", "Last 7 days"].map((section) => (
//           <div key={section} className="space-y-2.5 pt-1">
//             <h3 className="text-[10px] font-bold tracking-super-wide text-text-tertiary uppercase font-mono">{section}</h3>
//             <div className="space-y-3.5">
//               {items.filter(i => i.section === section).map((item, idx) => (
//                 <div key={idx} onClick={() => onSelectRecent(item.id)} className="min-w-0 cursor-pointer block group">
//                   <div className="flex items-baseline justify-between gap-2 mb-0.5">
//                     <p className="text-xs font-medium text-text-primary/90 group-hover:text-accent transition-colors truncate">{item.name}</p>
//                     <span className="text-[10px] text-text-tertiary/70 shrink-0 font-mono">{item.time}</span>
//                   </div>
//                   <p className="text-xs text-text-secondary truncate leading-normal">{item.desc}</p>
//                 </div>
//               ))}
//             </div>
//           </div>
//         ))}
//       </div>
      
//       <div className="px-6 py-3 border-t border-neutral-200 dark:border-neutral-800/40 flex items-center justify-between text-[10px] tracking-super-wide text-text-tertiary/80 uppercase font-mono shrink-0 bg-transparent">
//         <span>Superhuman</span>
//         <div className="flex gap-2.5 opacity-40">
//           <span>🎁</span><span>❓</span><span>📅</span>
//         </div>
//       </div>
//     </div>
//   );
// }

// // ─── MASTER INTEGRATED CANVAS CONTROLLER ─────────────────────────────────────
// export default function InboxPage() {
//   const [activeTab, setActiveTab] = useState<TabType>("inbox");
//   const [selectedId, setSelectedId] = useState<string | null>(null);
//   const [selectedIndex, setSelectedIndex] = useState(0);
//   const [composeOpen, setComposeOpen] = useState(false);
//   const [replyTo, setReplyTo] = useState<Email | null>(null);
//   const [searchOpen, setSearchOpen] = useState(false);

//   const queryClient = useQueryClient();

//   useEffect(() => {
//     const es = new EventSource("/api/events/stream");
//     const refresh = () => { queryClient.invalidateQueries({ queryKey: ["emails"] }); };
//     es.addEventListener("email_enriched", refresh);
//     es.addEventListener("new_email", refresh);
//     return () => {
//       es.removeEventListener("email_enriched", refresh);
//       es.removeEventListener("new_email", refresh);
//       es.close();
//     };
//   }, [queryClient]);

//   const { data, isLoading, isError, refetch } = useQuery<PaginatedResponse<EmailListItem>>({
//     queryKey: ["emails"],
//     queryFn: () => api.get<PaginatedResponse<EmailListItem>>(`/api/emails`),
//   });

//   const archiveMutation = useMutation({
//     mutationFn: (gmailId: string) => api.post(`/api/emails/${gmailId}/archive`, {}),
//     onMutate: async (gmailId) => {
//       const key = ["emails"];
//       await queryClient.cancelQueries({ queryKey: key });
//       const prev = queryClient.getQueryData<PaginatedResponse<EmailListItem>>(key);
//       if (prev) {
//         queryClient.setQueryData<PaginatedResponse<EmailListItem>>(key, {
//           ...prev,
//           items: prev.items.filter((e) => e.gmailId !== gmailId),
//         });
//       }
//       return { prev };
//     },
//     onError: (_err, _id, ctx) => {
//       if (ctx?.prev) queryClient.setQueryData(["emails"], ctx.prev);
//     },
//   });

//   const emails = data?.items ?? [];

//   useEffect(() => {
//     const open = () => setComposeOpen(true);
//     const openSearch = () => setSearchOpen(true);
//     window.addEventListener("compose:open", open);
//     window.addEventListener("search:open", openSearch);
//     return () => {
//       window.removeEventListener("compose:open", open);
//       window.removeEventListener("search:open", openSearch);
//     };
//   }, []);

//   const filteredEmails = useMemo(() => {
//     return emails.filter((email) => {
//       const labels = email.labels ?? [];
//       const subject = (email.subject ?? "").toLowerCase();

//       switch (activeTab) {
//         case "inbox":
//           return labels.includes("INBOX");
//         case "important":
//           return labels.includes("IMPORTANT") || labels.includes("CATEGORY_PERSONAL") || email.priority === "high";
//         case "secondary":
//           return labels.includes("CATEGORY_PROMOTIONS") || email.priority === "low";
//         case "standard_feed":
//           return email.priority === "normal" && !labels.includes("CATEGORY_UPDATES") && !labels.includes("CATEGORY_PROMOTIONS");
//         case "notification":
//           return labels.includes("CATEGORY_UPDATES");
//         case "support":
//           return subject.includes("support") || subject.includes("issue");
//         case "others":
//           return labels.includes("CATEGORY_SOCIAL");
//         default:
//           return true;
//       }
//     });
//   }, [emails, activeTab]);

//   const groupedEmails = useMemo(() => {
//     const groups: Record<string, EmailListItem[]> = {};
//     const sortedEmails = [...filteredEmails].sort((a, b) => {
//       if (!a.receivedAt) return 1;
//       if (!b.receivedAt) return -1;
//       return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
//     });

//     sortedEmails.forEach((email) => {
//       if (!email.gmailId) return;
//       const groupName = getTimelineGroup(email.receivedAt);
//       if (!groups[groupName]) groups[groupName] = [];
//       groups[groupName].push(email);
//     });
//     return groups;
//   }, [filteredEmails]);

//   const chronologicalKeys = useMemo(() => {
//     const keys = Object.keys(groupedEmails);
//     return TIMELINE_ORDER.filter(k => keys.includes(k)).concat(
//       keys.filter(k => !TIMELINE_ORDER.includes(k))
//     );
//   }, [groupedEmails]);

//   const tabCounts = useMemo(() => {
//     return {
//       inbox: emails.filter(e => !e.isRead && e.labels?.includes("INBOX")).length || null,
//       important: emails.filter(e => !e.isRead && (e.labels?.includes("IMPORTANT") || e.labels?.includes("CATEGORY_PERSONAL") || e.priority === "high")).length || null,
//       standard_feed: emails.filter(e => !e.isRead && e.priority === "normal" && !e.labels?.includes("CATEGORY_UPDATES") && !e.labels?.includes("CATEGORY_PROMOTIONS")).length || null,
//       notification: emails.filter(e => !e.isRead && e.labels?.includes("CATEGORY_UPDATES")).length || null,
//       support: emails.filter(e => !e.isRead && ((e.subject ?? "").toLowerCase().includes("support") || (e.subject ?? "").toLowerCase().includes("issue"))).length || null,
//       secondary: emails.filter(e => !e.isRead && (e.labels?.includes("CATEGORY_PROMOTIONS") || e.priority === "low")).length || null,
//       others: emails.filter(e => !e.isRead && e.labels?.includes("CATEGORY_SOCIAL")).length || null,
//     };
//   }, [emails]);

//   const handleKeyDown = useCallback((e: KeyboardEvent) => {
//     const tag = (e.target as HTMLElement)?.tagName;
//     if (tag === "INPUT" || tag === "TEXTAREA") return;

//     if (e.key === "j" || e.key === "ArrowDown") {
//       e.preventDefault();
//       const next = Math.min(selectedIndex + 1, filteredEmails.length - 1);
//       if (filteredEmails[next]) {
//         setSelectedIndex(next);
//         setSelectedId(filteredEmails[next].gmailId ?? null);
//       }
//     }
//     if (e.key === "k" || e.key === "ArrowUp") {
//       e.preventDefault();
//       const prev = Math.max(selectedIndex - 1, 0);
//       if (filteredEmails[prev]) {
//         setSelectedIndex(prev);
//         setSelectedId(filteredEmails[prev].gmailId ?? null);
//       }
//     }
//     if (e.key === "e" && selectedId) {
//       archiveMutation.mutate(selectedId);
//       setSelectedId(null);
//     }
//     if (e.key === "r" && selectedId) {
//       const activeEmail = filteredEmails.find((em) => em.gmailId === selectedId);
//       if (activeEmail) {
//         setReplyTo({
//           id: activeEmail.id,
//           userId: "",
//           gmailId: activeEmail.gmailId,
//           threadId: activeEmail.threadId,
//           fromAddr: activeEmail.fromAddr,
//           toAddrs: [],
//           ccAddrs: [],
//           subject: activeEmail.subject,
//           snippet: activeEmail.snippet,
//           body: null,
//           isRead: activeEmail.isRead,
//           labels: activeEmail.labels,
//           priority: activeEmail.priority,
//           attachments: [],
//           receivedAt: activeEmail.receivedAt,
//         });
//         setComposeOpen(true);
//       }
//     }
//   }, [filteredEmails, selectedId, selectedIndex, archiveMutation]);

//   useEffect(() => {
//     window.addEventListener("keydown", handleKeyDown);
//     return () => window.removeEventListener("keydown", handleKeyDown);
//   }, [handleKeyDown]);

//   return (
//     <div className="w-full h-full bg-surface-0 flex box-border relative transition-colors duration-150">
      
//       {/* Central Thread Container Module — Switches to hidden when active to open detail view full-screen */}
//       <div className={`flex-1 flex flex-col min-w-0 overflow-hidden h-full transition-all duration-300
//         ${selectedId ? "hidden" : "flex"}`}>
        
//         {/* Flat Top Bar Folder Filters */}
//         <div className="flex items-center justify-between px-10 pt-3 pb-2 bg-surface-0 select-none border-b border-neutral-200 dark:border-neutral-800/40">
//           <div className="flex items-center gap-6 overflow-x-auto scrollbar-none max-w-full pr-4">
//             {([
//               { id: "inbox", label: "Inbox", count: tabCounts.inbox },
//               { id: "important", label: "Important", count: tabCounts.important },
//               { id: "secondary", label: "Secondary", count: tabCounts.secondary },
//               { id: "standard_feed", label: "Standard Feed", count: tabCounts.standard_feed },
//               { id: "notification", label: "Notification", count: tabCounts.notification },
//               { id: "support", label: "Support", count: tabCounts.support },
//               { id: "others", label: "Others", count: tabCounts.others }
//             ] as const).map((tab) => (
//               <button
//                 key={tab.id}
//                 onClick={() => {
//                   setActiveTab(tab.id);
//                   setSelectedId(null);
//                   setSelectedIndex(0);
//                 }}
//                 className={`text-sm font-semibold transition-all relative pb-2 outline-none shrink-0
//                   ${activeTab === tab.id ? "text-text-primary" : "text-text-secondary/50 hover:text-text-secondary"}`}
//               >
//                 <span className="inline-flex items-baseline gap-1">
//                   {tab.label}
//                   {tab.count !== null && (
//                     <span className="text-xxs font-normal opacity-60 font-mono">{tab.count}</span>
//                   )}
//                 </span>
//                 {activeTab === tab.id && (
//                   <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-full animate-fade-in" />
//                 )}
//               </button>
//             ))}
//           </div>

//           <div className="flex items-center gap-4 text-text-tertiary/80 shrink-0">
//             <button onClick={() => setComposeOpen(true)} className="hover:text-text-secondary p-1 outline-none"><span className="text-sm"><Pencil size={18}/></span></button>
//             <button onClick={() => setSearchOpen(true)} className="hover:text-text-secondary p-1 outline-none"><span className="text-sm"><Search size={18}/></span></button>
//           </div>
//         </div>

//         {/* Linear Unified Chronological Feed List Block */}
//         <div className="flex-1 overflow-y-auto custom-thin-scrollbar">
//           {isLoading && (
//             <div className="p-10 space-y-4 animate-pulse" />
//           )}

//           {isError && (
//             <div className="flex flex-col items-center justify-center h-48 px-10 text-center">
//               <p className="text-sm text-text-secondary mb-3">Couldn't load email index streams.</p>
//               <button onClick={() => refetch()} className="text-xs text-accent hover:underline">Retry →</button>
//             </div>
//           )}

//           {!isLoading && !isError && chronologicalKeys.length === 0 && (
//             <div className="flex flex-col items-center justify-center h-64 text-center px-10">
//               <p className="text-sm text-text-secondary font-medium">Clear feed inside this view panel.</p>
//             </div>
//           )}

//           {!isLoading && !isError && chronologicalKeys.map((groupTitle) => {
//             const items = groupedEmails[groupTitle] || [];
//             if (items.length === 0) return null;

//             return (
//               <div key={groupTitle} className="mb-2">
//                 <div className="px-10 py-1.5 bg-surface-0 sticky top-0 z-10">
//                   <h2 className="text-xxs font-bold tracking-super-wide text-text-tertiary uppercase font-mono pt-1 ml-3">
//                     {groupTitle}
//                   </h2>
//                 </div>
                
//                 <div className="mt-0.5">
//                   {items.map((email, idx) => (
//                     <EmailRow
//                       key={email.gmailId}
//                       email={email}
//                       isSelected={email.gmailId === selectedId}
//                       onClick={() => {
//                         setSelectedId(email.gmailId);
//                         setSelectedIndex(idx);
//                       }}
//                     />
//                   ))}
//                 </div>
//               </div>
//             );
//           })}
//         </div>
//       </div>

//       {/* Imported High-Fidelity Multi-Pane Full-Page Email View Component */}
//       {selectedId && (
//         <div className="flex-1 h-full z-20 animate-fade-in absolute inset-0 md:relative">
//           <EmailDetail
//             gmailId={selectedId}
//             onClose={() => setSelectedId(null)}
//             onReply={(email) => { setReplyTo(email); setComposeOpen(true); }}
//             onArchive={(id) => archiveMutation.mutate(id)}
//           />
//         </div>
//       )}

//       {/* Unified Connected Recent Opens Sidebar panel widget — Switches to hidden when an email is read to give the canvas maximum width space */}
//       <div className={selectedId ? "hidden" : "block"}>
//         <RecentOpensSidebar 
//           hasSelectedEmail={!!selectedId} 
//           onSelectRecent={(id) => setSelectedId(id)} 
//         />
//       </div>

//       {/* Global Compose Overlay Modal Portal Component */}
//       {composeOpen && (
//         <ComposeModal
//           replyTo={replyTo}
//           onClose={() => { setComposeOpen(false); setReplyTo(null); }}
//           onSent={() => { setComposeOpen(false); setReplyTo(null); queryClient.invalidateQueries({ queryKey: ["emails"] }); }}
//         />
//       )}
//     </div>
//   );
// }

"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api-client";
import type { EmailListItem, Email, PaginatedResponse, SSEEvent } from "@/src/types";
import { ComposeModal } from "@/src/components/compose/compose-modal";
import { SearchCommand } from "@/src/components/search/search-command";
import { isToday, isYesterday, subDays, isAfter, startOfMonth } from "date-fns";
import { Pencil, Search } from "lucide-react";
import { EmailDetail } from "@/src/components/Email/EmailDetail";

const TIMELINE_ORDER = ["Today", "Yesterday", "Last 7 days", "Earlier this month"];

function getTimelineGroup(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "Earlier this month";
  const date = new Date(dateInput);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  if (isAfter(date, subDays(new Date(), 7))) return "Last 7 days";
  if (isAfter(date, startOfMonth(new Date()))) return "Earlier this month";
  return "Earlier this month";
}

interface Badge { name: string; style: string }

function getPrimaryBadge(subject = "", labels: string[] = []): Badge | null {
  const text = [...labels, subject].join(" ").toLowerCase();

  const rules: Array<{ name: string; style: string; keywords: string[] }> = [
    { name: "urgent",     style: "bg-red-500/10 text-red-500 dark:bg-red-950/40 dark:text-red-400",         keywords: ["urgent","immediately","critical","asap","attention required","failed production"] },
    { name: "action",     style: "bg-amber-500/10 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400", keywords: ["invitation","approve","review","respond","verify","complete","action required","invited you"] },
    { name: "job",        style: "bg-violet-500/10 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400", keywords: ["internship","job","career","hiring","recruiter","application","interview"] },
    { name: "meeting",    style: "bg-cyan-500/10 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-400",     keywords: ["meeting","calendar","schedule","zoom","google meet","appointment"] },
    { name: "finance",    style: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400", keywords: ["invoice","payment","billing","subscription","receipt","transaction","refund"] },
    { name: "security",   style: "bg-orange-500/10 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400", keywords: ["security","password","verification","2fa","otp","account access"] },
    { name: "deployment", style: "bg-blue-500/10 text-blue-500 dark:bg-blue-950/40 dark:text-blue-400",     keywords: ["deployment","production","build failed","vercel","railway","netlify","render"] },
    { name: "social",     style: "bg-pink-500/10 text-pink-600 dark:bg-pink-950/40 dark:text-pink-400",     keywords: ["linkedin","connection","social","category_social"] },
    { name: "newsletter", style: "bg-indigo-500/10 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400", keywords: ["newsletter","digest","weekly","monthly","edition","category_updates"] },
    { name: "promotion",  style: "bg-rose-500/10 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",     keywords: ["sale","discount","offer","deal","coupon","promotion","category_promotions"] },
    { name: "support",    style: "bg-slate-500/10 text-slate-600 dark:bg-slate-950/40 dark:text-slate-400", keywords: ["ticket","issue","support","customer service"] },
    { name: "education",  style: "bg-teal-500/10 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400",     keywords: ["course","learn","training","certificate","workshop","bootcamp","tutorial"] },
  ];

  return rules.find((r) => r.keywords.some((kw) => text.includes(kw))) ?? null;
}

type TabType = "inbox" | "important" | "secondary" | "standard_feed" | "notification" | "support" | "others";

function filterByTab(emails: EmailListItem[], tab: TabType): EmailListItem[] {
  return emails.filter((e) => {
    const labels = e.labels ?? [];
    const subject = (e.subject ?? "").toLowerCase();
    switch (tab) {
      case "inbox":         return labels.includes("INBOX");
      case "important":     return labels.includes("IMPORTANT") || labels.includes("CATEGORY_PERSONAL") || e.priority === "high";
      case "secondary":     return labels.includes("CATEGORY_PROMOTIONS") || e.priority === "low";
      case "standard_feed": return e.priority === "normal" && !labels.includes("CATEGORY_UPDATES") && !labels.includes("CATEGORY_PROMOTIONS");
      case "notification":  return labels.includes("CATEGORY_UPDATES");
      case "support":       return subject.includes("support") || subject.includes("issue");
      case "others":        return labels.includes("CATEGORY_SOCIAL");
      default:              return true;
    }
  });
}

function EmailRow({ email, isSelected, onClick }: { email: EmailListItem; isSelected: boolean; onClick: () => void }) {
  const fromName = email.fromAddr?.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim() ?? email.fromAddr ?? "Unknown";
  const badge = getPrimaryBadge(email.subject ?? "", email.labels ?? []);
  const rowDate = email.receivedAt
    ? new Date(email.receivedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()
    : "";

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between px-10 py-2.5 text-left transition-colors duration-100 select-none relative outline-none
        ${isSelected ? "bg-surface-2 text-text-primary" : "hover:bg-surface-1 text-text-secondary"}`}
    >
      <div className="flex items-center gap-5 min-w-0 flex-1 pr-4">
        <div style={{ fontSize: "14px" }}
          className={`w-44 shrink-0 truncate text-sm tracking-super-tight flex items-center
            ${!email.isRead ? "text-text-primary font-semibold" : "text-text-secondary font-medium"}`}>
          <div className="w-1.5 h-1.5 flex items-center justify-center shrink-0 mr-2">
            {!email.isRead && <div className="w-1.5 h-1.5 rounded-full bg-[#79BAD8]" />}
          </div>
          <div className="truncate">{fromName}</div>
        </div>

        <div style={{ marginLeft: "48px" }} className="flex items-center gap-3 min-w-0 flex-1 text-sm truncate tracking-super-tight">
          {badge && (
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider shrink-0 uppercase min-w-[54px] text-center ${badge.style}`}>
              {badge.name}
            </span>
          )}
          <span style={{ fontWeight: 500 }}
            className={`truncate ${!email.isRead ? "text-text-primary font-semibold" : "text-text-primary/90 font-medium"}`}>
            {email.subject ?? "(no subject)"}
          </span>
          {email.snippet && (
            <span className="text-text-secondary/60 font-normal truncate ml-2 text-[13px]">{email.snippet}</span>
          )}
        </div>
      </div>

      <div style={{ fontSize: "13px" }}
        className="text-xxs tracking-super-wide text-text-tertiary font-medium shrink-0 text-right w-16 font-mono">
        {rowDate}
      </div>
    </button>
  );
}

function RecentOpensSidebar({ hasSelectedEmail, onSelectRecent }: { hasSelectedEmail: boolean; onSelectRecent: (id: string) => void }) {
  const items = [
    { id: "19ec313135361f62", name: "Aman Raj",    time: "34 mins ago",  desc: "You have an invitation ✉️" },
    { id: "19ec380fd7640730", name: "Devo jeet",   time: "46 mins ago",  desc: "You have an invitation" },
    { id: "19eb72ca19b44781", name: "Vercel",       time: "Tue 4:11 PM", desc: "Re: Intro to Dashlane Webinar", section: "Yesterday" },
    { id: "19ebdbff53eefec5", name: "Railway",      time: "Tue 4:09 PM", desc: "Product-Focused Direction", section: "Yesterday" },
    { id: "19ebfa42a7c88910", name: "Faizan Khan",  time: "Tue 2:54 PM", desc: "Partnership & Sponsorship Kit", section: "Yesterday" },
    { id: "19ebc4a3232e0742", name: "virendaryadav", time: "Mon 5:36 PM", desc: "Re: Jason <> Alex", section: "Last 7 days" },
  ];

  return (
    <div className={`w-[280px] h-full flex flex-col pt-6 select-none shrink-0 relative transition-colors duration-150 overflow-hidden
      ${hasSelectedEmail ? "bg-surface-0 border-l border-neutral-200 dark:border-neutral-800/20" : "bg-surface-sidebar border-l border-neutral-200/60 dark:border-neutral-900/60"}`}>
      <div className="px-6 pb-4 shrink-0">
        <h2 className="text-xs font-semibold text-text-primary tracking-tight">Recent Opens</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-6 space-y-5 pb-4 custom-thin-scrollbar">
        <div className="space-y-3.5">
          {items.filter((i) => !i.section).map((item, idx) => (
            <div key={idx} onClick={() => onSelectRecent(item.id)} className="min-w-0 cursor-pointer block group">
              <div className="flex items-baseline justify-between gap-2 mb-0.5">
                <p className="text-xs font-medium text-text-primary/90 group-hover:text-accent transition-colors truncate">{item.name}</p>
                <span className="text-[10px] text-text-tertiary/70 shrink-0 font-mono">{item.time}</span>
              </div>
              <p className="text-xs text-text-secondary truncate leading-normal">{item.desc}</p>
            </div>
          ))}
        </div>

        {["Yesterday", "Last 7 days"].map((section) => (
          <div key={section} className="space-y-2.5 pt-1">
            <h3 className="text-[10px] font-bold tracking-super-wide text-text-tertiary uppercase font-mono">{section}</h3>
            <div className="space-y-3.5">
              {items.filter((i) => i.section === section).map((item, idx) => (
                <div key={idx} onClick={() => onSelectRecent(item.id)} className="min-w-0 cursor-pointer block group">
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <p className="text-xs font-medium text-text-primary/90 group-hover:text-accent transition-colors truncate">{item.name}</p>
                    <span className="text-[10px] text-text-tertiary/70 shrink-0 font-mono">{item.time}</span>
                  </div>
                  <p className="text-xs text-text-secondary truncate leading-normal">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="px-6 py-3 border-t border-neutral-200 dark:border-neutral-800/40 flex items-center justify-between text-[10px] tracking-super-wide text-text-tertiary/80 uppercase font-mono shrink-0">
        <span>Supermail</span>
        <div className="flex gap-2.5 opacity-40">
          <span>🎁</span><span>❓</span><span>📅</span>
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { id: "inbox",         label: "Inbox" },
  { id: "important",     label: "Important" },
  { id: "secondary",     label: "Secondary" },
  { id: "standard_feed", label: "Standard Feed" },
  { id: "notification",  label: "Notification" },
  { id: "support",       label: "Support" },
  { id: "others",        label: "Others" },
] as const;

export default function InboxPage() {
  const [activeTab, setActiveTab] = useState<TabType>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Email | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const queryClient = useQueryClient();

  // SSE — single persistent connection, surgical updates only
  useEffect(() => {
    const es = new EventSource("/api/events/stream");

    es.addEventListener("message", (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as SSEEvent;

        if (event.type === "new_email") {
          if (event.data.email) {
            // Surgical prepend of the single new email
            queryClient.setQueryData<PaginatedResponse<EmailListItem>>(["emails"], (old) => {
              if (!old) return old;
              const exists = old.items.some((i) => i.gmailId === event.data.email.gmailId);
              if (exists) return old;
              return { ...old, items: [event.data.email, ...old.items] };
            });
          } else {
            // Webhook had no historyId — do a full refetch as fallback
            void queryClient.invalidateQueries({ queryKey: ["emails"] });
          }
        }

        if (event.type === "email_enriched") {
          // Patch ONLY this row's priority — no refetch, no flicker
          queryClient.setQueryData<PaginatedResponse<EmailListItem>>(["emails"], (old) => {
            if (!old) return old;
            return {
              ...old,
              items: old.items.map((item) =>
                item.gmailId === event.data.gmailId
                  ? { ...item, priority: event.data.priority }
                  : item,
              ),
            };
          });
        }
      } catch { /* malformed payload — ignore */ }
    });

    return () => es.close();
  }, [queryClient]);

  const { data, isLoading, isError, refetch } = useQuery<PaginatedResponse<EmailListItem>>({
    queryKey: ["emails"],
    queryFn: () => api.get<PaginatedResponse<EmailListItem>>("/api/emails"),
    staleTime: 5 * 60 * 1000,
  });

  const archiveMutation = useMutation({
    mutationFn: (gmailId: string) => api.post(`/api/emails/${gmailId}/archive`, {}),
    onMutate: async (gmailId) => {
      await queryClient.cancelQueries({ queryKey: ["emails"] });
      const prev = queryClient.getQueryData<PaginatedResponse<EmailListItem>>(["emails"]);
      if (prev) {
        queryClient.setQueryData<PaginatedResponse<EmailListItem>>(["emails"], {
          ...prev,
          items: prev.items.filter((e) => e.gmailId !== gmailId),
        });
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["emails"], ctx.prev);
    },
  });

  const emails = data?.items ?? [];

  useEffect(() => {
    const openCompose = () => setComposeOpen(true);
    const openSearch = () => setSearchOpen(true);
    window.addEventListener("compose:open", openCompose);
    window.addEventListener("search:open", openSearch);
    return () => {
      window.removeEventListener("compose:open", openCompose);
      window.removeEventListener("search:open", openSearch);
    };
  }, []);

  const filteredEmails = useMemo(() => filterByTab(emails, activeTab), [emails, activeTab]);

  const groupedEmails = useMemo(() => {
    const groups: Record<string, EmailListItem[]> = {};
    const sorted = [...filteredEmails].sort((a, b) => {
      if (!a.receivedAt) return 1;
      if (!b.receivedAt) return -1;
      return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
    });
    for (const email of sorted) {
      if (!email.gmailId) continue;
      const g = getTimelineGroup(email.receivedAt?.toString());
      if (!groups[g]) groups[g] = [];
      groups[g].push(email);
    }
    return groups;
  }, [filteredEmails]);

  const chronologicalKeys = useMemo(() => {
    const keys = Object.keys(groupedEmails);
    return TIMELINE_ORDER.filter((k) => keys.includes(k)).concat(keys.filter((k) => !TIMELINE_ORDER.includes(k)));
  }, [groupedEmails]);

  const tabCounts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.id, filterByTab(emails, t.id).filter((e) => !e.isRead).length])),
    [emails],
  );

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;

    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(selectedIndex + 1, filteredEmails.length - 1);
      if (filteredEmails[next]) { setSelectedIndex(next); setSelectedId(filteredEmails[next].gmailId); }
    }
    if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = Math.max(selectedIndex - 1, 0);
      if (filteredEmails[prev]) { setSelectedIndex(prev); setSelectedId(filteredEmails[prev].gmailId); }
    }
    if (e.key === "e" && selectedId) { archiveMutation.mutate(selectedId); setSelectedId(null); }
    if (e.key === "r" && selectedId) {
      const active = filteredEmails.find((em) => em.gmailId === selectedId);
      if (active) {
        setReplyTo({ id: active.id, userId: "", gmailId: active.gmailId, threadId: active.threadId, fromAddr: active.fromAddr, toAddrs: [], ccAddrs: [], subject: active.subject, snippet: active.snippet, body: null, isRead: active.isRead, labels: active.labels, priority: active.priority, attachments: [], receivedAt: active.receivedAt });
        setComposeOpen(true);
      }
    }
  }, [filteredEmails, selectedId, selectedIndex, archiveMutation]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="w-full h-full bg-surface-0 flex box-border relative transition-colors duration-150">

      <div className={`flex-1 flex flex-col min-w-0 overflow-hidden h-full transition-all duration-300 ${selectedId ? "hidden" : "flex"}`}>

        <div className="flex items-center justify-between px-10 pt-3 pb-2 bg-surface-0 select-none border-b border-neutral-200 dark:border-neutral-800/40">
          <div className="flex items-center gap-6 overflow-x-auto scrollbar-none max-w-full pr-4">
            {TABS.map((tab) => {
              const count = (tabCounts[tab.id] as number) ?? 0;
              return (
                <button key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setSelectedId(null); setSelectedIndex(0); }}
                  className={`text-sm font-semibold transition-all relative pb-2 outline-none shrink-0
                    ${activeTab === tab.id ? "text-text-primary" : "text-text-secondary/50 hover:text-text-secondary"}`}>
                  <span className="inline-flex items-baseline gap-1">
                    {tab.label}
                    {count > 0 && <span className="text-xxs font-normal opacity-60 font-mono">{count}</span>}
                  </span>
                  {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-full" />}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-4 text-text-tertiary/80 shrink-0">
            <button onClick={() => setComposeOpen(true)} className="hover:text-text-secondary p-1 outline-none"><Pencil size={18} /></button>
            <button onClick={() => setSearchOpen(true)} className="hover:text-text-secondary p-1 outline-none"><Search size={18} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-thin-scrollbar">
          {isLoading && (
            <div className="p-10 space-y-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-8 bg-surface-1 rounded animate-pulse opacity-50" style={{ animationDelay: `${i * 50}ms` }} />
              ))}
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center justify-center h-48 px-10 text-center">
              <p className="text-sm text-text-secondary mb-3">Couldn't load emails.</p>
              <button onClick={() => refetch()} className="text-xs text-accent hover:underline">Retry →</button>
            </div>
          )}

          {!isLoading && !isError && chronologicalKeys.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-center px-10">
              <p className="text-sm text-text-secondary font-medium">All clear.</p>
            </div>
          )}

          {!isLoading && !isError && chronologicalKeys.map((groupTitle) => {
            const items = groupedEmails[groupTitle] ?? [];
            if (!items.length) return null;
            return (
              <div key={groupTitle} className="mb-2">
                <div className="px-10 py-1.5 bg-surface-0 sticky top-0 z-10">
                  <h2 className="text-xxs font-bold tracking-super-wide text-text-tertiary uppercase font-mono pt-1 ml-3">{groupTitle}</h2>
                </div>
                <div className="mt-0.5">
                  {items.map((email, idx) => (
                    <EmailRow key={email.gmailId} email={email} isSelected={email.gmailId === selectedId}
                      onClick={() => { setSelectedId(email.gmailId); setSelectedIndex(idx); }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedId && (
        <div className="flex-1 h-full z-20 animate-fade-in absolute inset-0 md:relative">
          <EmailDetail gmailId={selectedId} onClose={() => setSelectedId(null)}
            onReply={(email) => { setReplyTo(email); setComposeOpen(true); }}
            onArchive={(id) => archiveMutation.mutate(id)} />
        </div>
      )}

      <div className={selectedId ? "hidden" : "block"}>
        <RecentOpensSidebar hasSelectedEmail={!!selectedId} onSelectRecent={(id) => setSelectedId(id)} />
      </div>

      {composeOpen && (
        <ComposeModal replyTo={replyTo}
          onClose={() => { setComposeOpen(false); setReplyTo(null); }}
          onSent={() => { setComposeOpen(false); setReplyTo(null); void queryClient.invalidateQueries({ queryKey: ["emails"] }); }} />
      )}

      {searchOpen && <SearchCommand onClose={() => setSearchOpen(false)} />}
    </div>
  );
}