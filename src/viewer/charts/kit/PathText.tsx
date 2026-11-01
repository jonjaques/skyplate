/**
 * A repository path that truncates from the left, so the file name (the part a reader
 * recognizes) stays visible and the ellipsis eats the shared directory prefix instead:
 * "…/engine/GameEngine.ts", never "apps/game/src/eng…".
 *
 * The trick is a right-to-left box with an isolated left-to-right run inside it. RTL puts the
 * overflow and the ellipsis on the left; <bdi> keeps the path's own characters in order (a
 * bare RTL box would move a leading "." or trailing "/" to the wrong end). text-align: left
 * keeps a path that fits aligned with its neighbors.
 */

import { cn } from "../../lib/utils";

export function PathText({ path, className }: { path: string; className?: string }) {
  return (
    <span title={path} className={cn("block min-w-0 truncate text-left [direction:rtl]", className)}>
      <bdi>{path}</bdi>
    </span>
  );
}
