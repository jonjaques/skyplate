/** Pieces shared by the record's views. */

import { Orbit } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { useViewer } from "../../state/store";

/**
 * The record's heading. `above` is the specimen's location (a directory path, a file and
 * line), set in mono as data, not a label: the heading itself carries the name. `action` sits
 * at the heading's top right and never squeezes the tags and fields below it.
 */
export function RecordHeading({
  above,
  title,
  titleClass,
  action,
  children,
}: {
  above?: ReactNode;
  title: ReactNode;
  titleClass?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="min-w-0">
      <div className="flex min-w-0 items-start gap-3">
        <h2 className={cn("min-w-0 flex-1 text-[22px] leading-[1.15] font-bold break-words text-ink [font-stretch:80%]", titleClass)}>
          {above && (
            // A path wraps after a slash, and splits a segment only when one alone is wider
            // than the column. break-all cut "plugins/" into "pl" and "ugins/" once the
            // heading's action took its share of the 340px record.
            <span className="mb-1.5 block font-mono text-xs leading-snug font-medium text-ink-3 [font-stretch:100%] [overflow-wrap:anywhere]">
              {typeof above === "string" ? slashBreaks(above) : above}
            </span>
          )}
          <span className="break-all">{title}</span>
        </h2>
        {action}
      </div>
      {children}
    </header>
  );
}

/** "a/b/c/" with a break opportunity after every slash. */
function slashBreaks(path: string): ReactNode[] {
  return path.split(/(?<=\/)/).map((part, i) => (
    <Fragment key={i}>
      {part}
      <wbr />
    </Fragment>
  ));
}

/**
 * Back to the plate with this selection lit. Shown only where no plate is on screen: the
 * Explorer and Findings (the Charts tab has no record). The Source tab keeps its compact plate
 * beside the reader, so there the button would only take the reader away from the line.
 */
export function ShowInGalaxy() {
  const tab = useViewer((s) => s.tab);
  const setTab = useViewer((s) => s.setTab);
  if (tab === "galaxy" || tab === "source") return null;
  const go = () => {
    setTab("galaxy");
    // Below 1024px the document scrolls and the record sits under the work area, so the reader
    // pressing this is scrolled well past where the plate will be. At the top, the plate is
    // what they asked to see; on wide screens the window never scrolls and this is a no-op.
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  return (
    <Button variant="outline" size="xs" onClick={go} className="shrink-0 bg-paper text-ink-2 hover:text-ink">
      <Orbit aria-hidden />
      Show on the plate
    </Button>
  );
}
