"use client";

import Link from "next/link";
import { Inbox, Calendar, MessageSquare } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#c4c9d2] dark:bg-[#525252] transition-colors duration-300">
      
      {/* Navigation Header */}
      <nav className="absolute top-8 flex gap-2 p-1.5 bg-white/50 dark:bg-black/20 backdrop-blur-md rounded-2xl border border-white/40 shadow-sm">
        {[
          { href: "/inbox", label: "Inbox", icon: <Inbox size={18} /> },
          { href: "/calendar", label: "Calendar", icon: <Calendar size={18} /> },
          { href: "/chat", label: "Assistant", icon: <MessageSquare size={18} /> },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-white/60 dark:hover:bg-white/10 rounded-xl transition-all"
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Centered Image */}
      {/* Replace 'your-image-path.png' with the actual source of your icon */}
      <div className="w-64 h-64 relative flex items-center justify-center">
        <img 
          src="/logo.png" 
          alt="App Icon" 
          className="w-full h-full object-contain drop-shadow-2xl"
        />
      </div>
    </div>
  );
}