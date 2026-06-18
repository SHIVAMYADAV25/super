"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Inbox, Calendar, MessageSquare, Sun, Moon } from "lucide-react";

export default function HomePage() {
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Sync with document element on mount
  useEffect(() => {
    const root = window.document.documentElement;
    setIsDarkMode(root.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const root = window.document.documentElement;
    if (isDarkMode) {
      root.classList.remove("dark");
      setIsDarkMode(false);
    } else {
      root.classList.add("dark");
      setIsDarkMode(true);
    }
  };

  return (
    <div 
      className={`min-h-screen w-full flex flex-col items-center justify-center transition-all duration-500 bg-cover bg-center bg-no-repeat
      ${isDarkMode 
        ? "bg-[url('/BG.png')] text-white" 
        : "bg-[url('/whiteBG.png')] text-gray-900"}`}
    >
      
      {/* Navigation Header */}
      <nav className="absolute top-8 flex items-center gap-6 p-1 bg-white/30 dark:bg-black/20 backdrop-blur-xl border border-white/40 dark:border-white/10 shadow-lg rounded-2xl">
        {[
          { href: "/inbox", label: "Inbox", icon: <Inbox size={18} /> },
          { href: "/calendar", label: "Calendar", icon: <Calendar size={18} /> },
          { href: "/chat", label: "Assistant", icon: <MessageSquare size={18} /> },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10 rounded-xl transition-all"
          >
            {item.icon}
            {item.label}
          </Link>
        ))}

        {/* Theme Toggle Button */}
        <button 
          onClick={toggleTheme}
          className="p-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-all border-l border-white/20 dark:border-white/10 ml-2"
          aria-label="Toggle Theme"
        >
          {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </nav>

      {/* Optional: You can place your logo or central graphic here if needed */}
    </div>
  );
}