"use client"
import React from "react";

/**
 * Advanced Email Body Parser
 * - Extracted text nodes from HTML layouts cleanly using DOMParser
 * - Filters out empty structural domain spacer lines (e.g., l.engage.canva.com)
 * - Suppresses floating tracker line fragments (?lid=...)
 */
export function formatEmailBodyText(rawBody: string | null | undefined): React.ReactNode[] {
  if (!rawBody) return [<span key="empty" className="text-text-secondary opacity-60 italic">(No content)</span>];

  let textContent = rawBody;

  // Process text using DOMParser if code signatures are detected
  if (rawBody.includes("<") || rawBody.includes("{") || rawBody.includes("@media")) {
    try {
      if (typeof window !== "undefined") {
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<body>${rawBody}</body>`, "text/html");
        
        const styles = doc.querySelectorAll("style, script, head, link, meta");
        styles.forEach(s => s.remove());
        
        textContent = doc.body.textContent || doc.body.innerText || rawBody;
      }
    } catch (e) {
      console.error("DOMParser error handler active:", e);
    }
  }

  const lines = textContent.replace(/\r\n/g, "\n").split("\n");
  const processedLines: string[] = [];
  let emptyLineCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // ─── FILTER STAGE A: BLOCK UNWANTED LAYOUT AND BOILERPLATE JUNK ───
    if (
      trimmed.startsWith("a {text-decoration:") || 
      trimmed.startsWith("sup { font-size:") || 
      trimmed === "96" ||
      trimmed.startsWith("Copy of (") ||
      trimmed.startsWith("****")
    ) {
      continue;
    }

    // ─── FILTER STAGE B: BLOCK REPETITIVE NAKED MARKETING SPOS/PIXELS ───
    // Drops lines that are just bare marketing subdomains with no actual textual message content
    if (
      trimmed === "( l.engage.canva.com )" || 
      trimmed === "l.engage.canva.com" ||
      trimmed === "( recommendations.pinterest.com )"
    ) {
      continue;
    }

    // ─── FILTER STAGE C: CLEAN STRAY BROKEN TRACKER LINK FRAGMENTS ───
    // Discards unattached parameters or loose brackets caused by text wrapping splits
    if (
      trimmed.startsWith("?lid=") || 
      trimmed.startsWith("(?lid=") || 
      trimmed.startsWith("?utm_") ||
      trimmed === "(" || 
      trimmed === ")"
    ) {
      continue;
    }

    // Paragraph spacing compaction filter logic
    if (trimmed.length === 0) {
      emptyLineCount++;
      if (emptyLineCount <= 1) {
        processedLines.push("");
      }
    } else {
      emptyLineCount = 0;
      processedLines.push(line);
    }
  }

  // Render processed items using premium Cobalt color overrides
  return processedLines.map((line, lineIdx) => {
    if (line === "") {
      return <div key={`spacer-${lineIdx}`} className="h-3 select-none" />;
    }

    // Process markdown link formats: [Text](url)
    const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    markdownLinkRegex.lastIndex = 0;

    while ((match = markdownLinkRegex.exec(line)) !== null) {
      const matchIndex = match.index;
      if (matchIndex > lastIndex) {
        elements.push(line.substring(lastIndex, matchIndex));
      }

      const linkText = match[1].trim();
      const rawUrl = match[2];
      let cleanLabel = linkText;

      if (linkText.startsWith("http") || linkText.length > 40) {
        try {
          cleanLabel = new URL(rawUrl).hostname;
        } catch {
          cleanLabel = "View Link";
        }
      }

      elements.push(
        <a
          key={`md-link-${matchIndex}`}
          href={rawUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#0066cc] dark:text-[#58a6ff] hover:underline font-medium break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {cleanLabel}
        </a>
      );
      lastIndex = markdownLinkRegex.lastIndex;
    }

    if (lastIndex < line.length) {
      const remainingText = line.substring(lastIndex);
      const bareUrlRegex = /(https?:\/\/[^\s]+)/g;
      let bareLastIndex = 0;
      let bareMatch;
      const bareElements: React.ReactNode[] = [];

      while ((bareMatch = bareUrlRegex.exec(remainingText)) !== null) {
        if (bareMatch.index > bareLastIndex) {
          bareElements.push(remainingText.substring(bareLastIndex, bareMatch.index));
        }

        const urlStr = bareMatch[1];
        
        // Unpack tracker expressions smoothly from LinkedIn links
        let cleanUrlTarget = urlStr;
        const queryIndex = urlStr.search(/[?&]lipi=/);
        if (queryIndex !== -1) {
          cleanUrlTarget = urlStr.substring(0, queryIndex);
        }

        let urlLabel = cleanUrlTarget;
        try {
          urlLabel = new URL(cleanUrlTarget).hostname;
        } catch {
          urlLabel = "Link";
        }

        bareElements.push(
          <a
            key={`bare-link-${bareMatch.index}`}
            href={urlStr}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#0066cc] dark:text-[#58a6ff] hover:underline font-medium break-all"
            onClick={(e) => e.stopPropagation()}
          >
            {urlLabel}
          </a>
        );
        bareLastIndex = bareUrlRegex.lastIndex;
      }

      if (bareLastIndex < remainingText.length) {
        bareElements.push(remainingText.substring(bareLastIndex));
      }
      elements.push(...bareElements);
    }

    return (
      <p 
        key={`line-${lineIdx}`} 
        className="text-sm text-text-primary/95 font-normal leading-relaxed tracking-normal antialiased min-h-[1.25rem]"
      >
        {elements.length > 0 ? elements : line}
      </p>
    );
  });
}