"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

function LoginContent() {
  const [isLoading, setIsLoading] = useState(false);
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const callbackUrl = searchParams.get("callbackUrl") ?? "/inbox";

  const errorMessages: Record<string, string> = {
    OAuthSignin: "Could not start sign in. Please try again.",
    OAuthCallback: "Sign in failed. Please try again.",
    OAuthCreateAccount: "Could not create account. Please try again.",
    AccessDenied: "Access denied. You need to grant Gmail and Calendar permissions.",
    Default: "Something went wrong. Please try again.",
  };

  const errorMessage = error ? (errorMessages[error] ?? errorMessages.Default) : null;

  async function handleSignIn() {
    setIsLoading(true);
    try {
      const result = await signIn("google", { 
        callbackUrl,
        redirect: true, 
      });
      
      if (result?.error) {
        setIsLoading(false);
      }
    } catch (err) {
      console.error("Authentication lifecycle crash:", err);
      setIsLoading(false);
    }
  }

  function dismissError() {
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    window.history.replaceState({}, "", url.toString());
  }

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-4 relative">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-accent mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-white">
              <path d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
            Super
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            The fastest email experience
          </p>
        </div>

        {/* Card */}
        <div className="bg-surface-1 border border-border rounded-2xl p-8 shadow-sm">
          <h2 className="text-lg font-medium text-text-primary mb-1">
            Sign in to continue
          </h2>
          <p className="text-sm text-text-secondary mb-6">
            Connect your Google account to access Gmail and Calendar.
          </p>

          {/* Google sign in button */}
          <button
            onClick={handleSignIn}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl
              bg-surface-2 border border-border text-text-primary text-sm font-medium
              hover:bg-surface-3 hover:border-border transition-colors duration-150
              disabled:opacity-50 disabled:cursor-not-allowed
              focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface-1"
          >
            {isLoading ? (
              <svg className="animate-spin h-4 w-4 text-text-secondary" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            )}
            {isLoading ? "Signing in..." : "Continue with Google"}
          </button>

          <p className="mt-5 text-xs text-text-tertiary text-center leading-relaxed">
            By continuing, you grant access to Gmail and Google Calendar.
            Your credentials are encrypted and never stored in plaintext.
          </p>
        </div>
      </div>

      {/* Floating Notification Pop-up Alert */}
      {errorMessage && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm w-full animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div className="bg-surface-1 border border-danger/30 rounded-xl p-4 shadow-xl shadow-danger/5 flex items-start gap-3 backdrop-blur-md">
            {/* Warning Icon */}
            <div className="p-1.5 rounded-lg bg-danger/10 text-danger shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            {/* Error Message Details */}
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-text-primary">Authentication Error</h4>
              <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
                {errorMessage}
              </p>
            </div>

            {/* Dismiss Cross Icon */}
            <button 
              onClick={dismissError}
              className="text-text-tertiary hover:text-text-primary p-0.5 rounded-md hover:bg-surface-2 transition-colors"
              aria-label="Dismiss error"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface-0" />}>
      <LoginContent />
    </Suspense>
  );
}