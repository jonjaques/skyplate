/**
 * Code intelligence (TypeScript and JavaScript, from the compiler): symbols by kind, the most
 * referenced symbols, unused exports by directory, and function complexity.
 *
 * The symbol tables ship in their own data file so the report's first paint never waits on
 * them; this section asks for them when it mounts and keeps its place while they load.
 */

import { useEffect, useMemo } from "react";
import { SymbolFlag, type CodeSymbols, type SymbolKind } from "../../../shared/schema";
import { baseName, formatInt, plural } from "../../lib/format";
import { ensureSymbols } from "../../state/loaders";
import { useViewer } from "../../state/store";
import { isUnusedExport, log2Dist, sum } from "../data";
import { BarList, type BarItem } from "../kit/BarList";
import { Figure } from "../kit/Figure";
import { Log2Histogram } from "../kit/Log2Histogram";
import { measureColor, slotColor } from "../kit/theme";
import { useScope } from "../scope";
import { Section, SectionNote, span } from "../Section";
import { formatShare } from "../kit/marks";

const KIND_LABEL: Record<SymbolKind, string> = {
  function: "Functions",
  method: "Methods",
  constructor: "Constructors",
  getter: "Getters",
  setter: "Setters",
  property: "Properties",
  variable: "Variables",
  class: "Classes",
  interface: "Interfaces",
  type: "Type aliases",
  enum: "Enums",
  namespace: "Namespaces",
  component: "React components",
  hook: "React hooks",
  module: "Modules",
};

const CALLABLE = new Set<SymbolKind>(["function", "method", "constructor", "getter", "setter", "component", "hook"]);

export function CodeSection() {
  const { report } = useScope();
  const status = useViewer((s) => s.symbolsStatus);
  const symbols = useViewer((s) => s.symbols);

  useEffect(() => {
    if (report.symbols) void ensureSymbols();
  }, [report]);

  if (!report.symbols) {
    // A sentence, not a missing section: a reader who has seen another report's symbol charts
    // should learn why this one has none, and what would produce them.
    return (
      <Section id="code" title="Code intelligence">
        <SectionNote>
          No symbol tables in this report. Code intelligence (symbols, references, unused exports, function complexity)
          comes from the TypeScript compiler, so it covers TypeScript and JavaScript files, and is left out when there are
          none or when the report is written with <code className="font-mono text-[12px] whitespace-nowrap">--no-symbols</code>.
        </SectionNote>
      </Section>
    );
  }
  const st = report.symbols.stats;
  const note = `${plural(st.symbols, "symbol")} and ${plural(st.references, "reference")} in ${plural(st.files, "file")}, from the TypeScript compiler ${report.symbols.engine.version}`;
  return (
    <Section id="code" title="Code intelligence" note={note}>
      {status === "ready" && symbols ? (
        <CodeCharts symbols={symbols} />
      ) : (
        <SectionNote role="status">
          {status === "error"
            ? `The symbol tables could not be loaded (${report.symbols.url}). The rest of the report is unaffected; reload to try again.`
            : "Loading the symbol tables…"}
        </SectionNote>
      )}
    </Section>
  );
}

function CodeCharts({ symbols }: { symbols: CodeSymbols }) {
  const { files } = useScope();
  const inScope = useMemo(() => {
    const t = symbols.symbols;
    const out: number[] = [];
    for (let i = 0; i < t.name.length; i++) if (files.mask[t.file[i]!] && t.kind[i] !== "module") out.push(i);
    return out;
  }, [symbols, files]);
  return (
    <>
      <SymbolsByKind symbols={symbols} ids={inScope} />
      <MostReferenced symbols={symbols} ids={inScope} />
      <UnusedExports symbols={symbols} ids={inScope} />
      <FunctionComplexity symbols={symbols} ids={inScope} />
    </>
  );
}

function SymbolsByKind({ symbols, ids }: { symbols: CodeSymbols; ids: number[] }) {
  const { surface } = useScope();
  const counts = useMemo(() => {
    const m = new Map<SymbolKind, number>();
    for (const i of ids) {
      const k = symbols.symbols.kind[i]!;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [symbols, ids]);
  const items: BarItem[] = counts.map(([k, n]) => ({ key: k, label: KIND_LABEL[k], value: n, valueText: formatInt(n), color: measureColor(surface), tip: [{ value: formatShare(n / ids.length), label: "of symbols" }] }));
  return (
    <Figure
      className={span(4)}
      title="Symbols by kind"
      subtitle={`${plural(ids.length, "declaration")} in the files in view`}
      height={items.length * 28}
      empty={ids.length === 0 ? "No TypeScript or JavaScript symbols among the files in view." : null}
      table={() => ({ columns: [{ label: "Kind" }, { label: "Symbols", align: "right", mono: true }], rows: counts.map(([k, n]) => [KIND_LABEL[k], n]) })}
    >
      {() => <BarList items={items} label="Symbols by kind" labelWidth="40%" />}
    </Figure>
  );
}

function MostReferenced({ symbols, ids }: { symbols: CodeSymbols; ids: number[] }) {
  const { report, surface } = useScope();
  const t = symbols.symbols;
  const top = useMemo(() => [...ids].filter((i) => t.refs[i]! > 0).sort((a, b) => t.refs[b]! - t.refs[a]!).slice(0, 14), [ids, t]);
  const items: BarItem[] = top.map((i) => ({
    key: i,
    label: `${t.name[i]} · ${baseName(report.files[t.file[i]!]!.path)}`,
    mono: true,
    value: t.refs[i]!,
    valueText: formatInt(t.refs[i]!),
    color: measureColor(surface),
    target: { kind: "symbol", id: i },
    tip: [
      { value: t.kind[i]!, label: "kind" },
      { value: formatInt(t.callers[i]!), label: "distinct callers" },
      { value: formatInt(t.files[i]!), label: "files referencing it" },
    ],
  }));
  return (
    <Figure
      className={span(8)}
      title="Most referenced symbols"
      subtitle="Resolved references from anywhere in the repository; click one to select it and light its callers"
      height={items.length * 28}
      empty={top.length === 0 ? "No referenced symbols among the files in view." : null}
      table={() => ({
        columns: [{ label: "Symbol", mono: true }, { label: "Kind" }, { label: "File", mono: true, width: "36%" }, { label: "References", align: "right", mono: true }, { label: "Callers", align: "right", mono: true }],
        rows: top.map((i) => [t.name[i]!, t.kind[i]!, report.files[t.file[i]!]!.path, t.refs[i]!, t.callers[i]!]),
      })}
    >
      {() => <BarList items={items} label="Most referenced symbols" labelWidth="46%" />}
    </Figure>
  );
}

function UnusedExports({ symbols, ids }: { symbols: CodeSymbols; ids: number[] }) {
  const { report, model, surface } = useScope();
  const t = symbols.symbols;
  const { rows, total, exported } = useMemo(() => {
    const by = new Map<number, number>();
    let total = 0;
    let exported = 0;
    for (const i of ids) {
      if (t.flags[i]! & SymbolFlag.exported) exported++;
      if (!isUnusedExport(t.flags[i]!)) continue;
      total++;
      const d = model.topDir[t.file[i]!]!;
      by.set(d, (by.get(d) ?? 0) + 1);
    }
    return { rows: [...by.entries()].sort((a, b) => b[1] - a[1]), total, exported };
  }, [ids, t, model]);
  const shown = rows.slice(0, 12);
  const restN = sum(rows.slice(12).map(([, n]) => n));
  const items: BarItem[] = shown.map(([d, n]) => ({
    key: d,
    label: d === 0 ? "Root files" : report.dirs[d]!.name,
    mono: true,
    value: n,
    valueText: formatInt(n),
    color: measureColor(surface),
    target: { kind: "dir", id: d },
    tip: [{ value: formatShare(n / total), label: "of unused exports" }],
  }));
  if (restN) items.push({ key: "rest", label: `${rows.length - 12} more directories`, value: restN, valueText: formatInt(restN), color: slotColor(-1, surface), rest: true });
  return (
    <Figure
      className={span(6)}
      title="Unused exports by directory"
      subtitle={total ? `${plural(total, "export")} (${formatShare(total / Math.max(1, exported))} of exports) that nothing outside their own file references` : "Exports nothing outside their own file references"}
      height={items.length * 28}
      empty={total === 0 ? "No unused exports among the files in view: everything exported is used elsewhere." : null}
      table={() => ({ columns: [{ label: "Directory", mono: true }, { label: "Unused exports", align: "right", mono: true }], rows: rows.map(([d, n]) => [d === 0 ? "Root files" : report.dirs[d]!.path, n]) })}
    >
      {() => <BarList items={items} label="Unused exports by top-level directory" labelWidth="36%" />}
    </Figure>
  );
}

function FunctionComplexity({ symbols, ids }: { symbols: CodeSymbols; ids: number[] }) {
  const { surface } = useScope();
  const t = symbols.symbols;
  const dist = useMemo(() => log2Dist(ids.filter((i) => CALLABLE.has(t.kind[i]!) && t.complexity[i]! > 0).map((i) => t.complexity[i]!)), [ids, t]);
  return (
    <Figure
      className={span(6)}
      title="Function complexity"
      subtitle={`Cyclomatic complexity of ${plural(dist.count, "function")}, methods and components included, on doubling bins`}
      height={220}
      empty={dist.count === 0 ? "No functions with bodies among the files in view." : null}
      table={() => ({
        columns: [{ label: "Complexity", mono: true }, { label: "Functions", align: "right", mono: true }],
        rows: dist.bins.map((c, i) => [{ text: i === 0 ? "0–1" : `${formatInt(2 ** i)}–${formatInt(2 ** (i + 1) - 1)}`, sort: i }, c]),
      })}
    >
      {(width) => (
        <Log2Histogram
          bins={dist.bins}
          width={width}
          height={220}
          color={measureColor(surface)}
          unit="functions"
          measure="complexity"
          markers={[
            { value: dist.median, label: `median ${formatInt(dist.median)}` },
            { value: dist.p90, label: `p90 ${formatInt(dist.p90)}` },
          ]}
        />
      )}
    </Figure>
  );
}

