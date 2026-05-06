"use client";

import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Path to redirect to when the user hits "Go home". Defaults to "/". */
  fallbackHref?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time errors in any child component and shows a friendly
 * recovery UI instead of crashing the entire route. Wraps the session page
 * (and anywhere else with complex conditional rendering) so a bug in one
 * sub-state doesn't take the whole experience down.
 *
 * On recovery: "Try again" resets the boundary; if the error re-throws on
 * the next render, the user sees the fallback again. "Go home" navigates
 * away cleanly so they're never stuck.
 *
 * Note: error boundaries do NOT catch errors in event handlers, async code,
 * or server-side rendering. Those need their own try/catch handling.
 */
export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface in dev tools / Vercel runtime logs
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-6"
        style={{ background: "var(--bg)", color: "var(--text)" }}>
        <div className="max-w-sm w-full text-center">
          <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
          <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
            The session hit an unexpected error. Try again, or head home.
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={this.reset}
              className="w-full py-3 rounded-xl text-sm font-semibold"
              style={{ background: "var(--accent)", color: "#0c0c0e" }}>
              Try again
            </button>
            <a
              href={this.props.fallbackHref ?? "/"}
              className="w-full py-3 rounded-xl text-sm font-medium text-center"
              style={{ background: "var(--surface)", color: "var(--text)" }}>
              Go home
            </a>
          </div>
        </div>
      </div>
    );
  }
}
