/**
 * The Source tab: the reader beside a compact galaxy plate, in a resizable split.
 *
 * The plate stays on screen while reading because the code-intelligence lighting is the point:
 * select a function in the text and its callers light up across the codebase without leaving
 * the line. Below 1024px the split turns vertical (reader on top) so neither side is cramped.
 *
 * Sizes follow react-resizable-panels v4: a "%" string is a share of the group, a bare number
 * is pixels. The minimums are pixels on purpose, so neither side can be dragged into a sliver.
 */

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/ui/resizable";
import { useBreakpoint } from "../shell/media";
import { GalaxyView } from "../shell/mounts";
import { SourceReader } from "./SourceReader";

export function SourceTab() {
  const bp = useBreakpoint();
  const vertical = bp === "narrow" || bp === "compact";
  return (
    <ResizablePanelGroup orientation={vertical ? "vertical" : "horizontal"} className="h-full min-h-0">
      <ResizablePanel defaultSize="64%" minSize={vertical ? 240 : 360}>
        <SourceReader />
      </ResizablePanel>
      <ResizableHandle withHandle className="bg-rule" />
      <ResizablePanel defaultSize="36%" minSize={vertical ? 180 : 220}>
        <div className="relative h-full w-full overflow-hidden bg-plate">
          <GalaxyView compact />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
