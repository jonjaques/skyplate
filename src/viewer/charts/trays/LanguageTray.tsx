/**
 * Language composition tray: total code lines, one stacked bar of the palette slots (2px
 * surface gaps, the data end rounded), and a keyed list with each slot's share.
 *
 * The bar shows slots in slot order, not by size in the current scope: the slot order is the
 * color-safety order, and a drawer that happens to have more CSS than JavaScript should not
 * shuffle the bar. Every language without a slot folds into "N others" in gray, as it does
 * in the galaxy.
 */

import { useMemo, useRef, useState } from "react";
import { formatInt } from "../../lib/format";
import { cn } from "../../lib/utils";
import { composition, languageShares } from "../data";
import { Swatch } from "../kit/Legend";
import { slotColor, useSurface } from "../kit/theme";
import { ChartTooltip, type Tip } from "../kit/Tooltip";
import { Headline, TrayEmpty, TrayShell, useTrayScope } from "./shared";
import { formatShare } from "../kit/marks";

export function LanguageTray() {
  const { report, model, scope, dirPath } = useTrayScope();
  const surface = useSurface();
  const barRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  const { comp, languages } = useMemo(() => {
    if (!report || !model || !scope) return { comp: null, languages: 0 };
    const shares = languageShares(report, model, scope.ids);
    return { comp: composition(shares), languages: shares.length };
  }, [report, model, scope]);

  if (!comp) return <TrayShell title="Language composition" />;
  const label = dirPath ? `Language composition in ${dirPath}` : "Language composition";
  if (comp.total === 0) {
    return (
      <TrayShell title="Language composition" label={label}>
        <TrayEmpty>
          No code lines in view. {scope?.narrowed ? "Widen the filters or close the drawer to see the languages." : "Every file here is data, media or binary."}
        </TrayEmpty>
      </TrayShell>
    );
  }

  // Parts under a third of a percent would be thinner than the gap that separates them.
  const drawn = comp.parts.filter((p) => p.code / comp.total >= 0.003);
  const width = barRef.current?.clientWidth ?? 0;

  function showPart(i: number, el: HTMLElement) {
    const part = drawn[i];
    const box = barRef.current?.getBoundingClientRect();
    if (!part || !box) return;
    const r = el.getBoundingClientRect();
    const rows =
      part.slot === -1
        ? part.languages.slice(0, 4).map((l) => ({ value: formatInt(l.code), label: l.name }))
        : [{ value: formatInt(part.code), label: "code lines" }];
    setTip({
      x: r.left - box.left + r.width / 2,
      y: r.bottom - box.top + 4,
      title: `${part.label}, ${formatShare(part.code / comp!.total)}`,
      rows,
    });
  }

  return (
    <TrayShell
      title="Language composition"
      label={label}
      // The bar counts languages with code lines; the rail and record count every language
      // in view, including images and other files with no code lines. Saying which keeps
      // "33" beside "34" from reading as a mistake.
      aside={
        comp.languageCount < languages
          ? `${formatInt(comp.languageCount)} with code`
          : `${formatInt(comp.languageCount)} ${comp.languageCount === 1 ? "language" : "languages"}`
      }
    >
      <Headline value={formatInt(comp.total)} caption="code lines" scope={dirPath ? `in ${dirPath}` : undefined} />
      <div ref={barRef} className="relative mt-3" onPointerLeave={() => setTip(null)}>
        <div className="flex h-4 gap-[2px]" role="img" aria-label={drawn.map((p) => `${p.label} ${formatShare(p.code / comp.total)}`).join(", ")}>
          {drawn.map((p, i) => (
            <div
              key={p.slot}
              className="h-full min-w-px first:rounded-l-none last:rounded-r-[4px] hover:brightness-110"
              style={{ flex: `${p.code} 0 0`, background: slotColor(p.slot, surface) }}
              onPointerEnter={(e) => showPart(i, e.currentTarget)}
            />
          ))}
        </div>
        <ChartTooltip tip={tip} width={width} />
      </div>
      {/* Two columns of up to four rows when the tray is wide. A narrow tray has room for one
          column of four: the first three keys, then a line saying how many more there are
          (they are still in the bar, with their tooltips, and in the Charts tab). */}
      <ul className="mt-3 grid grid-cols-1 gap-x-3 gap-y-1 text-xs @min-[250px]:grid-cols-2">
        {comp.parts.map((p, i) => (
          <li
            key={p.slot}
            className={cn("flex min-w-0 items-center gap-1.5", comp.parts.length > 4 && i >= 3 && "@max-[249px]:hidden")}
          >
            <Swatch color={slotColor(p.slot, surface)} />
            <span className="min-w-0 truncate text-ink">{p.label}</span>
            <span className="figures ml-auto shrink-0 font-mono text-[11px] text-ink-3">{formatShare(p.code / comp.total)}</span>
          </li>
        ))}
        {comp.parts.length > 4 && (
          <li className="flex min-w-0 items-center gap-1.5 text-ink-3 @min-[250px]:hidden">
            <span className="min-w-0 truncate">and {comp.parts.length - 3} more in the bar</span>
            <span className="figures ml-auto shrink-0 font-mono text-[11px]">
              {formatShare(comp.parts.slice(3).reduce((s, p) => s + p.code, 0) / comp.total)}
            </span>
          </li>
        )}
      </ul>
    </TrayShell>
  );
}
