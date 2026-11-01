/**
 * Keeps one work area's failure inside that work area. A plate that cannot get a WebGL context,
 * or a chart that meets data it did not expect, should cost the reader that view, not the whole
 * report: the rail, the record and the other tabs keep working.
 */

import { Component, type ReactNode } from "react";

interface Props {
  /** Shown in the message: "The galaxy could not be drawn." */
  what: string;
  /** Dark surfaces (the plate) need light text. */
  tone?: "paper" | "plate";
  children: ReactNode;
}

export class Boundary extends Component<Props, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const plate = this.props.tone === "plate";
    return (
      <div className={plate ? "absolute inset-0 bg-plate p-8 text-plate-ink" : "h-full bg-paper p-8 text-ink"} role="alert">
        <h2 className="text-[17px] font-semibold [font-stretch:85%]">{this.props.what} could not be drawn</h2>
        <p className={plate ? "mt-2 max-w-[60ch] text-plate-muted" : "mt-2 max-w-[60ch] text-ink-2"}>
          The rest of the report still works. The browser reported: <span className="font-mono text-xs">{error.message}</span>
        </p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className={plate ? "mt-4 text-sm text-plate-ink underline underline-offset-2" : "mt-4 text-sm underline underline-offset-2"}
        >
          Try again
        </button>
      </div>
    );
  }
}
