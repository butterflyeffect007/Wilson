import React from "react";

type Props = { children: React.ReactNode; label?: string; compact?: boolean };
type State = { error: Error | null };

/** Catches render crashes so a section shows a calm warning instead of a blank screen. */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error(`[Wilson:${this.props.label ?? "ui"}]`, error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className={`wl-warn ${this.props.compact ? "text-[12px] px-3 py-2" : "m-4 text-[14px] px-4 py-3"} rounded-2xl`}>
        <span>Something hiccuped{this.props.label ? ` in ${this.props.label}` : ""}. Your chats are safe.</span>{" "}
        <button type="button" className="underline underline-offset-2 ml-1" onClick={() => this.setState({ error: null })}>Try again</button>
        {!this.props.compact && <button type="button" className="underline underline-offset-2 ml-3" onClick={() => location.reload()}>Reload</button>}
      </div>
    );
  }
}
