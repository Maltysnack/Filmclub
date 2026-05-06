import ErrorBoundary from "@/components/ErrorBoundary";

// Wraps every /session/[code]/* route (page, /add, /results) with an error
// boundary so a render error in any sub-state (lobby, deck, match screen,
// shortlist, kicked, all-done) shows a recoverable fallback instead of a
// blank white screen. Issue #73.
export default function SessionLayout({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
