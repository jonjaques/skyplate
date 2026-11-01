/**
 * The Charts tab: one filter row, then sections of unit trays (composition, history, risk,
 * structure, people, coupling, code intelligence). Fills the work area beside the rail and
 * owns its own vertical scroll.
 *
 * Sections whose input is missing (no git, no TypeScript) collapse to one sentence saying what
 * would produce them, rather than a wall of empty trays.
 */

import { useMemo, useState } from "react";
import { useViewer } from "../state/store";
import { useSurface } from "./kit/theme";
import { buildScope, ScopeContext, type RangeKey } from "./scope";
import { FilterRow } from "./FilterRow";
import { CompositionSection } from "./sections/Composition";
import { HistorySection } from "./sections/History";
import { RiskSection } from "./sections/Risk";
import { StructureSection } from "./sections/Structure";
import { PeopleSection } from "./sections/People";
import { CouplingSection } from "./sections/Coupling";
import { CodeSection } from "./sections/Code";

export function ChartsView() {
  const report = useViewer((s) => s.report);
  const model = useViewer((s) => s.model);
  const filters = useViewer((s) => s.filters);
  const focusDir = useViewer((s) => s.focusDir);
  const surface = useSurface();
  const [range, setRange] = useState<RangeKey>("all");

  const scope = useMemo(
    () => (report && model ? buildScope(report, model, surface, filters, focusDir, range) : null),
    [report, model, surface, filters, focusDir, range],
  );

  if (!scope) {
    return <div className="grid h-full place-items-center bg-tray text-sm text-ink-3">Loading the report…</div>;
  }

  return (
    <div className="@container h-full overflow-y-auto bg-tray" aria-label="Charts">
      <FilterRow scope={scope} range={range} onRange={setRange} />
      <ScopeContext.Provider value={scope}>
        <CompositionSection />
        <HistorySection />
        <RiskSection />
        <StructureSection />
        <PeopleSection />
        <CouplingSection />
        <CodeSection />
        <div className="h-12" />
      </ScopeContext.Provider>
    </div>
  );
}
