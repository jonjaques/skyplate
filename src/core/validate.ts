/**
 * Report integrity checks: everything the viewer assumes without checking.
 *
 *   validateReport(report, symbols?) → string[]     (empty when the report is sound)
 *
 * The viewer indexes typed arrays by these integers and hands the layout straight to the GPU,
 * so one out-of-range id or one NaN is not a wrong number on screen but a crash or a blank
 * galaxy. Every rule here is one the schema states in prose (src/shared/schema.ts); this is
 * where it becomes executable. Messages name the first offending row, and each rule reports
 * at most a few rows so a systematic bug does not produce forty thousand lines.
 */

import { REF_KINDS, type CodeSymbols, type EdgeKind, type Report } from "../shared/schema";

const EDGE_KINDS = new Set<EdgeKind>(["import", "include", "require", "reference", "link"]);
const PER_RULE = 5;

export function validateReport(report: Report, symbols?: CodeSymbols): string[] {
  const errors: string[] = [];
  const counts = new Map<string, number>();
  const fail = (rule: string, message: string) => {
    const c = (counts.get(rule) ?? 0) + 1;
    counts.set(rule, c);
    if (c <= PER_RULE) errors.push(message);
    else if (c === PER_RULE + 1) errors.push(`${rule}: further errors suppressed`);
  };

  const files = report.files;
  const dirs = report.dirs;
  const nf = files.length;
  const nd = dirs.length;
  const fileOk = (i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < nf;
  const dirOk = (i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < nd;

  // ── No NaN or Infinity anywhere ──
  const walk = (v: unknown, at: string) => {
    if (typeof v === "number") {
      if (!Number.isFinite(v)) fail("finite", `non-finite number ${v} at ${at}`);
    } else if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) walk(v[i], `${at}[${i}]`);
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
    }
  };
  walk(report, "report");
  if (symbols) walk(symbols, "symbols");

  // ── Totals ──
  if (report.totals.files !== nf) fail("totals", `totals.files ${report.totals.files} ≠ files.length ${nf}`);
  if (report.totals.dirs !== nd) fail("totals", `totals.dirs ${report.totals.dirs} ≠ dirs.length ${nd}`);
  const sum = { bytes: 0, lines: 0, code: 0, comment: 0, blank: 0 };
  for (const f of files) {
    sum.bytes += f.bytes;
    sum.lines += f.lines;
    sum.code += f.code;
    sum.comment += f.comment;
    sum.blank += f.blank;
  }
  for (const k of ["bytes", "lines", "code", "comment", "blank"] as const) {
    if (report.totals[k] !== sum[k]) fail("totals", `totals.${k} ${report.totals[k]} ≠ sum over files ${sum[k]}`);
  }
  if (report.totals.languages !== report.languages.length) fail("totals", `totals.languages ${report.totals.languages} ≠ languages.length ${report.languages.length}`);

  // ── Files ──
  const seenInDir = new Uint8Array(nf);
  files.forEach((f, i) => {
    if (f.id !== i) fail("file-id", `files[${i}].id is ${f.id}`);
    if (!dirOk(f.dir)) fail("file-dir", `files[${i}].dir ${f.dir} out of range`);
    if (f.code + f.comment + f.blank !== f.lines) fail("file-lines", `files[${i}] (${f.path}): code+comment+blank ${f.code + f.comment + f.blank} ≠ lines ${f.lines}`);
    if (f.binary && f.lines !== 0) fail("file-lines", `files[${i}] (${f.path}) is binary with ${f.lines} lines`);
    if (f.cycle < -1 || (f.cycle >= 0 && f.cycle >= report.graph.cycles.length)) fail("file-cycle", `files[${i}].cycle ${f.cycle} out of range`);
    if (f.rank < 0 || f.rank > 1) fail("file-rank", `files[${i}].rank ${f.rank} outside 0-1`);
    if (f.hotspot < 0 || f.hotspot > 1) fail("file-hotspot", `files[${i}].hotspot ${f.hotspot} outside 0-1`);
    else if (f.hotspot > 0 && !f.git) fail("file-hotspot", `files[${i}] (${f.path}) has hotspot ${f.hotspot} but no git data`);
    if (f.src < -1 || (f.src >= 0 && f.src >= (report.source?.chunks.length ?? 0))) fail("file-src", `files[${i}].src ${f.src} out of range`);
    if (f.secret && f.src >= 0) fail("file-secret", `files[${i}] (${f.path}) is secret but embedded`);
    if (f.asset !== undefined && !/^data\/assets\/\d+\.[a-z0-9]+$/.test(f.asset)) fail("file-asset", `files[${i}].asset ${f.asset} is not a data/assets URL`);
    if (f.git) {
      if (!report.git) fail("file-git", `files[${i}] has git data but the report has no git section`);
      else if (!Number.isInteger(f.git.owner) || f.git.owner < 0 || f.git.owner >= report.git.authors.length) fail("file-git", `files[${i}].git.owner ${f.git.owner} out of range`);
      if (f.git.ownership < 0 || f.git.ownership > 1) fail("file-git", `files[${i}].git.ownership ${f.git.ownership} outside 0-1`);
    }
  });

  // ── Directories ──
  const sums = dirs.map(() => ({ files: 0, bytes: 0, lines: 0, code: 0 }));
  dirs.forEach((d, i) => {
    if (d.id !== i) fail("dir-id", `dirs[${i}].id is ${d.id}`);
    if (i === 0 ? d.parent !== -1 : !dirOk(d.parent) || d.parent >= i) fail("dir-parent", `dirs[${i}].parent ${d.parent} invalid`);
    if (i > 0 && dirOk(d.parent) && d.depth !== dirs[d.parent]!.depth + 1) fail("dir-depth", `dirs[${i}].depth ${d.depth} ≠ parent depth + 1`);
    for (const c of d.dirs) if (!dirOk(c) || dirs[c]!.parent !== i) fail("dir-children", `dirs[${i}].dirs lists ${c}, which is not its child`);
    for (const f of d.files) {
      if (!fileOk(f)) fail("dir-files", `dirs[${i}].files lists ${f}, out of range`);
      else {
        if (files[f]!.dir !== i) fail("dir-files", `dirs[${i}].files lists ${f}, whose dir is ${files[f]!.dir}`);
        if (seenInDir[f]) fail("dir-files", `file ${f} is listed by more than one directory`);
        seenInDir[f] = 1;
      }
    }
  });
  for (let f = 0; f < nf; f++) if (!seenInDir[f]) fail("dir-files", `file ${f} (${files[f]!.path}) is in no directory's files`);
  for (const f of files) {
    if (!dirOk(f.dir)) continue;
    for (let d = f.dir, guard = 0; d >= 0 && guard <= nd; d = dirs[d]!.parent, guard++) {
      const s = sums[d]!;
      s.files++;
      s.bytes += f.bytes;
      s.lines += f.lines;
      s.code += f.code;
      if (!dirOk(dirs[d]!.parent) && dirs[d]!.parent !== -1) break;
    }
  }
  dirs.forEach((d, i) => {
    const s = sums[i]!;
    if (d.totalFiles !== s.files || d.totalBytes !== s.bytes || d.totalLines !== s.lines || d.totalCode !== s.code) {
      fail("dir-totals", `dirs[${i}] (${d.path || "/"}) totals ${d.totalFiles}/${d.totalBytes}/${d.totalLines}/${d.totalCode} ≠ sums ${s.files}/${s.bytes}/${s.lines}/${s.code} (files/bytes/lines/code)`);
    }
  });

  // ── Languages and categories ──
  const lang = new Map<string, { files: number; bytes: number; lines: number; code: number; comment: number; blank: number }>();
  const cat = new Map<string, { files: number; bytes: number; lines: number }>();
  for (const f of files) {
    const l = lang.get(f.language) ?? { files: 0, bytes: 0, lines: 0, code: 0, comment: 0, blank: 0 };
    l.files++;
    l.bytes += f.bytes;
    l.lines += f.lines;
    l.code += f.code;
    l.comment += f.comment;
    l.blank += f.blank;
    lang.set(f.language, l);
    const c = cat.get(f.category) ?? { files: 0, bytes: 0, lines: 0 };
    c.files++;
    c.bytes += f.bytes;
    c.lines += f.lines;
    cat.set(f.category, c);
  }
  const slots = new Set<number>();
  const listed = new Set<string>();
  for (const l of report.languages) {
    if (listed.has(l.id)) fail("languages", `language ${l.id} listed twice`);
    listed.add(l.id);
    const s = lang.get(l.id);
    if (!s) fail("languages", `language ${l.id} has no files`);
    else if (s.files !== l.files || s.bytes !== l.bytes || s.lines !== l.lines || s.code !== l.code || s.comment !== l.comment || s.blank !== l.blank) {
      fail("languages", `language ${l.id} totals differ from its files`);
    }
    if (l.code + l.comment + l.blank !== l.lines) fail("languages", `language ${l.id}: code+comment+blank ≠ lines`);
    if (!Number.isInteger(l.slot) || l.slot < -1 || l.slot > 6) fail("slots", `language ${l.id} slot ${l.slot} outside -1..6`);
    else if (l.slot >= 0) {
      if (slots.has(l.slot)) fail("slots", `slot ${l.slot} assigned twice`);
      slots.add(l.slot);
    }
  }
  for (const id of lang.keys()) if (!listed.has(id)) fail("languages", `files use language ${id}, which report.languages does not list`);
  const catListed = new Set<string>();
  for (const c of report.categories) {
    catListed.add(c.category);
    const s = cat.get(c.category);
    if (!s || s.files !== c.files || s.bytes !== c.bytes || s.lines !== c.lines) fail("categories", `category ${c.category} totals differ from its files`);
  }
  for (const c of cat.keys()) if (!catListed.has(c)) fail("categories", `files use category ${c}, which report.categories does not list`);

  const ENTRY_SOURCES = new Set(["package main", "package bin", "package exports", "package script", "knip entry", "workflow step", "agent hook", "t3 script", "tool config", "type declarations"]);
  for (const f of files) {
    if (f.entry !== undefined && !ENTRY_SOURCES.has(f.entry)) fail("files", `${f.path} has entry ${f.entry}`);
    if (f.publicApi !== undefined && f.publicApi !== true) fail("files", `${f.path} has publicApi ${f.publicApi}`);
  }

  // ── Edges and graph ──
  const e = report.edges;
  if (e.from.length !== e.to.length || e.from.length !== e.kind.length) fail("edges", `edge columns differ in length: ${e.from.length}/${e.to.length}/${e.kind.length}`);
  const pairs = new Set<number>();
  for (let i = 0; i < e.from.length; i++) {
    const a = e.from[i]!;
    const b = e.to[i]!;
    if (!fileOk(a) || !fileOk(b)) fail("edges", `edge ${i} (${a} → ${b}) out of range`);
    if (a === b) fail("edges", `edge ${i} is a self-edge on ${a}`);
    if (!EDGE_KINDS.has(e.kind[i]!)) fail("edges", `edge ${i} has kind ${e.kind[i]}`);
    const key = a * nf + b;
    if (pairs.has(key)) fail("edges", `edge ${i} (${a} → ${b}) is a duplicate`);
    pairs.add(key);
  }
  if (e.typeOnly) {
    let prev = -1;
    for (const row of e.typeOnly) {
      if (!Number.isInteger(row) || row <= prev || row >= e.from.length) fail("edges", `typeOnly row ${row} is out of range or out of order`);
      else if (e.kind[row] === "link") fail("edges", `typeOnly row ${row} is a doc link, which has no types to erase`);
      prev = row;
    }
  }
  // Every counted statement lands in exactly one of the three graph totals, and doc links in
  // none, so the per-file counts must add up to them; a file that counts its links would not.
  const statements = files.reduce((s, f) => s + f.imports, 0);
  const counted = report.graph.resolved + report.graph.external + report.graph.unresolved;
  if (statements !== counted) fail("imports", `files' imports sum to ${statements}, but graph resolved + external + unresolved is ${counted}`);
  for (const loop of report.graph.typeLoops ?? []) {
    if (loop.length < 2 || loop.some((f) => !fileOk(f))) fail("cycles", `a type-only loop lists ${loop.length} file(s), some out of range`);
  }
  report.graph.cycles.forEach((c, i) => {
    if (c.id !== i) fail("cycles", `cycles[${i}].id is ${c.id}`);
    for (const f of c.files) if (!fileOk(f) || files[f]!.cycle !== i) fail("cycles", `cycles[${i}] lists file ${f}, whose cycle is ${files[f]?.cycle}`);
  });
  const mods = report.graph.modules;
  for (const m of mods) if (!dirOk(m.dir)) fail("modules", `module dir ${m.dir} out of range`);
  if (report.graph.moduleMatrix.length !== mods.length || report.graph.moduleMatrix.some((r) => r.length !== mods.length)) {
    fail("modules", `moduleMatrix is not ${mods.length}×${mods.length}`);
  }

  // ── Layout ──
  const lay = report.layout;
  if (lay.graph.length !== nf * 3) fail("layout", `layout.graph has ${lay.graph.length} numbers, expected ${nf * 3}`);
  if (!(lay.radius >= 0)) fail("layout", `layout.radius is ${lay.radius}, expected a non-negative number`);

  // ── Git ──
  const git = report.git;
  if (git) {
    const na = git.authors.length;
    git.authors.forEach((a, i) => a.id !== i && fail("authors", `authors[${i}].id is ${a.id}`));
    const c = git.commits;
    const n = c.hash.length;
    for (const [k, col] of Object.entries(c) as [string, unknown[]][]) if (col.length !== n) fail("commits", `commits.${k} has ${col.length} rows, hash has ${n}`);
    if (git.analyzedCommits !== n) fail("commits", `analyzedCommits ${git.analyzedCommits} ≠ commit rows ${n}`);
    for (let i = 0; i < n; i++) {
      if (!Number.isInteger(c.author[i]) || c.author[i]! < 0 || c.author[i]! >= na) fail("commits", `commits.author[${i}] ${c.author[i]} out of range`);
      if (i > 0 && c.time[i]! > c.time[i - 1]!) fail("commits-order", `commit ${i} is newer than commit ${i - 1}; the table must be newest first`);
      for (const f of c.files[i] ?? []) if (!fileOk(f)) fail("commits", `commits.files[${i}] lists ${f}, out of range`);
      if (c.width && (!Number.isInteger(c.width[i]) || c.width[i]! < (c.files[i]?.length ?? 0))) fail("commits", `commits.width[${i}] ${c.width[i]} must be an integer at least as large as its current-file count`);
    }
    for (const p of git.coupling) if (!fileOk(p.a) || !fileOk(p.b)) fail("coupling", `coupling pair ${p.a}/${p.b} out of range`);
    for (const a of git.truckFactor.authors) if (!Number.isInteger(a) || a < 0 || a >= na) fail("truck-factor", `truck-factor author ${a} out of range`);
    if (git.punchcard.length !== 7 || git.punchcard.some((r) => r.length !== 24)) fail("punchcard", "punchcard is not 7×24");
    for (const [id, series] of Object.entries(git.languageChurn.series)) {
      if (series.length !== git.languageChurn.months.length) fail("language-churn", `languageChurn.series.${id} length ≠ months`);
    }
    dirs.forEach((d, i) => d.commits !== undefined && (d.commits < 0 || d.commits > n) && fail("dir-commits", `dirs[${i}].commits ${d.commits} outside 0..${n}`));
  }

  // ── Duplicates ──
  report.stats.duplicates.forEach((d, i) => {
    if (d.files.length < 2) fail("duplicates", `stats.duplicates[${i}] has ${d.files.length} file(s); a duplicate set needs two`);
    for (const id of d.files) {
      if (!fileOk(id)) fail("duplicates", `stats.duplicates[${i}] lists file ${id}, out of range`);
      else if (files[id]!.hash !== d.hash || files[id]!.bytes !== d.bytes) fail("duplicates", `stats.duplicates[${i}] lists ${files[id]!.path}, whose hash or size differs from the set's`);
    }
  });

  // ── Findings ──
  for (const f of report.findings) {
    for (const id of f.files ?? []) if (!fileOk(id)) fail("findings", `finding ${f.id} cites file ${id}, out of range`);
    for (const id of f.dirs ?? []) if (!dirOk(id)) fail("findings", `finding ${f.id} cites dir ${id}, out of range`);
    for (const id of f.authors ?? []) if (!git || id < 0 || id >= git.authors.length) fail("findings", `finding ${f.id} cites author ${id}, out of range`);
  }

  // ── Source ──
  if (report.source) {
    const embedded = files.filter((f) => f.src >= 0).length;
    if (embedded !== report.source.embedded) fail("source", `source.embedded ${report.source.embedded} ≠ files with src ${embedded}`);
  }

  // ── Symbols ──
  if (symbols) validateSymbols(symbols, nf, fail);
  if (report.symbols && symbols && report.symbols.stats.symbols !== symbols.stats.symbols) fail("symbols", "report.symbols.stats differs from symbols.stats");
  return errors;
}

function validateSymbols(s: CodeSymbols, nf: number, fail: (rule: string, message: string) => void): void {
  const fileOk = (i: number) => Number.isInteger(i) && i >= 0 && i < nf;
  const t = s.symbols;
  const ns = t.name.length;
  const symOk = (i: number) => Number.isInteger(i) && i >= 0 && i < ns;
  for (const [k, col] of Object.entries(t) as [string, unknown[]][]) if (col.length !== ns) fail("symbols", `symbols.${k} has ${col.length} rows, name has ${ns}`);
  for (let i = 0; i < ns; i++) {
    if (!fileOk(t.file[i]!)) fail("symbols", `symbols.file[${i}] ${t.file[i]} out of range`);
    if (t.parent[i] !== -1 && !symOk(t.parent[i]!)) fail("symbols", `symbols.parent[${i}] ${t.parent[i]} out of range`);
  }
  const r = s.refs;
  const nr = r.symbol.length;
  for (const [k, col] of Object.entries(r) as [string, unknown[]][]) if (col.length !== nr) fail("refs", `refs.${k} has ${col.length} rows, symbol has ${nr}`);
  for (let i = 0; i < nr; i++) {
    if (!symOk(r.symbol[i]!)) fail("refs", `refs.symbol[${i}] ${r.symbol[i]} out of range`);
    if (!fileOk(r.file[i]!)) fail("refs", `refs.file[${i}] ${r.file[i]} out of range`);
    if (!symOk(r.from[i]!)) fail("refs", `refs.from[${i}] ${r.from[i]} out of range`);
    if (!Number.isInteger(r.kind[i]) || r.kind[i]! < 0 || r.kind[i]! >= REF_KINDS.length) fail("refs", `refs.kind[${i}] ${r.kind[i]} out of range`);
  }
  const c = s.calls;
  const nc = c.from.length;
  for (const [k, col] of Object.entries(c) as [string, unknown[]][]) if (col.length !== nc) fail("calls", `calls.${k} has ${col.length} rows, from has ${nc}`);
  for (let i = 0; i < nc; i++) {
    if (!symOk(c.from[i]!) || !symOk(c.to[i]!)) fail("calls", `calls row ${i} (${c.from[i]} → ${c.to[i]}) out of range`);
    if (!Number.isInteger(c.kind[i]) || c.kind[i]! < 0 || c.kind[i]! >= REF_KINDS.length) fail("calls", `calls.kind[${i}] ${c.kind[i]} out of range`);
  }
  const start = s.fileRefStart;
  if (start.length !== nf + 1) fail("file-ref-start", `fileRefStart has ${start.length} entries, expected files + 1 = ${nf + 1}`);
  else {
    if (start[0] !== 0) fail("file-ref-start", `fileRefStart[0] is ${start[0]}, expected 0`);
    if (start[nf] !== nr) fail("file-ref-start", `fileRefStart[files] is ${start[nf]}, expected refs length ${nr}`);
    for (let f = 0; f < nf; f++) {
      if (start[f + 1]! < start[f]!) fail("file-ref-start", `fileRefStart decreases at ${f}`);
      for (let i = start[f]!; i < start[f + 1]! && i < nr; i++) if (r.file[i] !== f) fail("file-ref-start", `ref ${i} is in file ${f}'s slice but belongs to file ${r.file[i]}`);
    }
  }
  if (s.moduleSymbol.length !== nf) fail("module-symbol", `moduleSymbol has ${s.moduleSymbol.length} entries, expected ${nf}`);
  for (let f = 0; f < s.moduleSymbol.length; f++) {
    const m = s.moduleSymbol[f]!;
    if (m !== -1 && !symOk(m)) fail("module-symbol", `moduleSymbol[${f}] ${m} out of range`);
  }
}
