/** Pieces shared by the record's views. */

import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * The record's heading. `above` is the specimen's location (a directory path, a file and
 * line), set in mono as data, not a label: the heading itself carries the name.
 */
export function RecordHeading({
  above,
  title,
  titleClass,
  children,
}: {
  above?: ReactNode;
  title: ReactNode;
  titleClass?: string;
  children?: ReactNode;
}) {
  return (
    <header className="min-w-0">
      <h2 className={cn("text-[22px] leading-[1.15] font-bold break-words text-ink [font-stretch:80%]", titleClass)}>
        {above && <span className="mb-1.5 block font-mono text-xs leading-snug font-medium break-all text-ink-3 [font-stretch:100%]">{above}</span>}
        <span className="break-all">{title}</span>
      </h2>
      {children}
    </header>
  );
}
