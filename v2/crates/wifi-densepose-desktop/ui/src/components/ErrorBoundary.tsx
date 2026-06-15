import React from "react";

interface Props {
  children: React.ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches render-time exceptions in the page tree and shows a recoverable
 * message instead of unmounting to a blank screen. Resets when the user
 * navigates (keyed by page in App).
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Page error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "var(--space-5)", maxWidth: 720 }}>
          <div
            role="alert"
            style={{
              background: "rgba(224, 96, 96, 0.1)",
              border: "1px solid rgba(224, 96, 96, 0.3)",
              borderRadius: 10,
              padding: "var(--space-4) var(--space-5)",
            }}
          >
            <h2 className="heading-md" style={{ marginBottom: "var(--space-2)", color: "var(--status-error)" }}>
              This page hit an error
            </h2>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: "var(--space-3)" }}>
              The rest of the app is fine — switch pages from the sidebar, or reload.
            </p>
            <pre
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--text-muted)",
                whiteSpace: "pre-wrap",
                margin: 0,
              }}
            >
              {this.state.error.message}
            </pre>
            <button
              type="button"
              className="btn-secondary"
              style={{ marginTop: "var(--space-4)" }}
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
