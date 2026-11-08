/**
 * Findings: the plain-language observations a report leads with.
 *
 *   buildFindings(report, symbols?) → Finding[]     (most severe first)
 *
 * Every finding is computed from numbers already in the report and cites the files,
 * directories or authors it is about; when its input is missing (no git, no TypeScript, no
 * cycles) it is simply absent. Titles state the fact; details say why a reader should care.
 *
 * Thresholds, and why:
 * - Activity is judged against the newest commit, not the wall clock: in a project nobody has
 *   touched for two years, everyone is "inactive" by the clock and the finding would say
 *   nothing. A separate finding covers the project itself going quiet.
 * - 12 months without a commit makes an author inactive and a region stale; 90% of a file's
 *   added lines makes its owner the only person who knows it. Both are deliberately strict so
 *   the finding names real islands, not every file with a dominant author.
 * - Truck factor 1 is critical and 2 a warning: below 3, one resignation or one
 *   reorganization can leave most of the code without anyone who knows it.
 * - Very large is over 1,000 code lines and very complex over 100 decision points in a file:
 *   round numbers past which a file no longer fits in one reading.
 * - Churn concentration and hotspots need MIN_HISTORY (10) analyzed commits. The truck factor,
 *   knowledge islands and stale regions are left out of shallow clones altogether, however
 *   many commits were fetched: the boundary commit "adds" every file, so ownership and ages
 *   would describe whoever made it. history-truncated says so in the report.
 */

import { SymbolFlag, type CodeSymbols, type Finding, type Report, type Severity } from "../shared/schema";
import { unreferenced } from "../shared/calls";
import { duplicateGroups, isOwnCode, MIN_HISTORY, wastedBytes } from "./stats";

const YEAR = 365 * 86_400;
const nf = new Intl.NumberFormat("en-US");
const fmt = (n: number) => nf.format(Math.round(n));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function list(names: string[], max = 3): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${fmt(rest)} more`;
  if (shown.length <= 2) return shown.join(" and ");
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, notice: 2, info: 3 };

type Input = Omit<Report, "findings"> & { findings?: Finding[] };

export function buildFindings(report: Input, symbols?: CodeSymbols): Finding[] {
  const out: Finding[] = [];
  const files = report.files;
  const own = files.filter(isOwnCode);
  const path = (id: number) => files[id]!.path;
  const git = report.git;
  const humanName = (a: number) => git?.authors[a]?.name ?? `author ${a}`;

  // ── Churn concentration and hotspots ──
  // A handful of commits is not a history (see MIN_HISTORY). The pipeline already leaves every
  // hotspot at 0 below it; the guard stays here so a report built some other way cannot turn
  // a complexity ranking into a "top hotspot".
  const history = !!git && git.analyzedCommits >= MIN_HISTORY;
  const churned = history ? own.filter((f) => f.git && f.category !== "lockfile").map((f) => ({ f, churn: f.git!.added + f.git!.deleted })) : [];
  const totalChurn = churned.reduce((s, c) => s + c.churn, 0);
  if (churned.length >= 20 && totalChurn > 0) {
    churned.sort((a, b) => b.churn - a.churn || a.f.id - b.f.id);
    const top1 = Math.max(1, Math.ceil(churned.length * 0.01));
    const top5 = Math.max(1, Math.ceil(churned.length * 0.05));
    const share = (k: number) => churned.slice(0, k).reduce((s, c) => s + c.churn, 0) / totalChurn;
    const s1 = share(top1);
    const s5 = share(top5);
    out.push({
      id: "hotspot-concentration",
      severity: s5 >= 0.5 ? "warning" : s5 >= 0.3 ? "notice" : "info",
      title: `5% of files (${fmt(top5)}) carry ${pct(s5)} of all line churn`,
      detail: `The top 1% (${plural(top1, "file")}) alone take ${pct(s1)}. Change that concentrates in a few files is where defects and review effort cluster, so these repay attention first.`,
      files: churned.slice(0, Math.min(top5, 20)).map((c) => c.f.id),
      metric: { label: "Churn in the top 5% of files", value: Math.round(s5 * 1000) / 10, unit: "%" },
    });
  }

  const hot = (history ? files : []).filter((f) => f.hotspot > 0).sort((a, b) => b.hotspot - a.hotspot || a.id - b.id).slice(0, 5);
  if (hot.length) {
    const top = hot[0]!;
    const severe = hot.some((f) => f.git!.commits >= 50 && f.complexity >= 100);
    out.push({
      id: "top-hotspots",
      severity: severe ? "warning" : "notice",
      title: `${top.path} is the top hotspot: ${plural(top.git!.commits, "commit")}, complexity ${fmt(top.complexity)}`,
      detail: `Hotspots change often and are complex (churn × complexity), so each change to them carries the most risk.${hot.length > 1 ? ` Next: ${list(hot.slice(1).map((f) => f.path), 4)}.` : ""}`,
      files: hot.map((f) => f.id),
      metric: { label: "Commits to the top hotspot", value: top.git!.commits },
    });
  }

  // ── Import cycles ──
  const cycles = report.graph.cycles;
  if (cycles.length) {
    const largest = cycles[0]!;
    const central = largest.files[0]!;
    const inCycles = cycles.reduce((s, c) => s + c.files.length, 0);
    out.push({
      id: "import-cycles",
      severity: largest.files.length >= 10 ? "warning" : "notice",
      title:
        cycles.length === 1
          ? `One import cycle ties ${plural(largest.files.length, "file")} together`
          : `${fmt(cycles.length)} import cycles; the largest ties ${plural(largest.files.length, "file")} together`,
      detail: `Files in a cycle can only be understood, tested and changed together (${plural(inCycles, "file")} sit in one). The largest cycle's most central member is ${path(central)}; breaking its imports untangles the most.`,
      files: largest.files.slice(0, 20),
      metric: { label: "Files in the largest cycle", value: largest.files.length },
    });
  }

  // ── Loops through types ──
  // One step below a runtime cycle at the same size: nothing breaks at evaluation, but the
  // files still have to be read together. With cycles computed over runtime edges, a
  // TypeScript monorepo whose every loop ran through `import type` had no finding left to say
  // its types were knotted.
  const loops = report.graph.typeLoops ?? [];
  if (loops.length) {
    const largest = loops[0]!;
    const inside = new Set(largest);
    const e = report.edges;
    const typed = (e.typeOnly ?? []).filter((row) => inside.has(e.from[row]!) && inside.has(e.to[row]!));
    const shown = typed.slice(0, 3).map((row) => `${path(e.from[row]!)} → ${path(e.to[row]!)}`);
    const more = typed.length > shown.length ? ` and ${fmt(typed.length - shown.length)} more` : "";
    out.push({
      id: "type-only-loops",
      severity: largest.length >= 10 ? "notice" : "info",
      title:
        loops.length === 1
          ? `One import loop closes only through \`import type\`, tying ${plural(largest.length, "file")} together`
          : `${fmt(loops.length)} import loops close only through \`import type\`; the largest ties ${plural(largest.length, "file")} together`,
      detail: `Nothing runs through them, so no evaluation order breaks, but the files in one still have to be understood together. The largest closes through ${plural(typed.length, "type-only import")}: ${shown.join(", ")}${more}. The loop exists only through those, so it ends when they do, usually by moving the types they name; no module needs reordering.`,
      files: largest.slice(0, 20),
      metric: { label: "Files in the largest type-only loop", value: largest.length },
    });
  }

  // ── Git: people and time ──
  if (git && git.analyzedCommits > 0) {
    // A shallow clone's oldest fetched commit "creates" every file, so ownership, ages and
    // the truck factor would all describe whoever made that commit. history-truncated below
    // says why these findings are missing.
    const people = !git.shallow;
    const tf = git.truckFactor;
    if (people && tf.value >= 1) {
      const names = tf.authors.map(humanName);
      out.push({
        id: "truck-factor",
        severity: tf.value === 1 ? "critical" : tf.value === 2 ? "warning" : "info",
        title: tf.value <= 3 ? `Truck factor is ${tf.value}: ${list(names, 3)}` : `Truck factor is ${tf.value}`,
        detail: `If ${tf.value === 1 ? `${names[0]} leaves` : `${list(names, 5)} leave`}, more than half of the files would have no remaining author who knows them (degree-of-authorship model, Avelino et al. 2016).`,
        authors: tf.authors,
        metric: { label: "Truck factor", value: tf.value },
      });
    }

    const ref = git.last;
    const inactive = new Set(git.authors.filter((a) => !a.bot && a.last < ref - YEAR).map((a) => a.id));
    const tracked = own.filter((f) => f.git);
    const islands = tracked.filter((f) => f.git!.ownership >= 0.9 && inactive.has(f.git!.owner)).sort((a, b) => b.code - a.code || a.id - b.id);
    if (people && islands.length) {
      const owners = [...new Set(islands.map((f) => f.git!.owner))];
      const share = islands.length / Math.max(1, tracked.length);
      out.push({
        id: "knowledge-islands",
        severity: share >= 0.2 ? "warning" : "notice",
        title: `${plural(islands.length, "file")} ${islands.length === 1 ? "is" : "are"} 90%+ written by people inactive for over a year`,
        detail: `That is ${pct(share)} of the code with history. Their main authors (${list(owners.map(humanName), 3)}) last committed more than 12 months before the newest commit, so whoever changes these files now works without the person who knows them best.`,
        files: islands.slice(0, 20).map((f) => f.id),
        authors: owners.slice(0, 20),
        metric: { label: "Files owned by inactive authors", value: islands.length },
      });
    }

    const root = report.dirs[0];
    if (people && root) {
      const lastTouch = new Map<number, number>();
      for (const f of files) {
        if (!f.git) continue;
        let d = f.dir;
        while (d > 0 && report.dirs[d]!.parent !== 0) d = report.dirs[d]!.parent;
        if (d <= 0) continue;
        lastTouch.set(d, Math.max(lastTouch.get(d) ?? 0, f.git.modified));
      }
      const stale = root.dirs.filter((d) => (lastTouch.get(d) ?? Infinity) < ref - YEAR);
      if (stale.length) {
        stale.sort((a, b) => report.dirs[b]!.totalFiles - report.dirs[a]!.totalFiles || a - b);
        const names = stale.map((d) => `${report.dirs[d]!.path}/`);
        out.push({
          id: "stale-regions",
          severity: "notice",
          title: `${plural(stale.length, "top-level directory", "top-level directories")} unchanged for over a year: ${list(names, 3)}`,
          detail: "Nothing under them changed in the 12 months before the newest commit. Untouched code is either finished or forgotten; check that it is still used, owned and built.",
          dirs: stale,
          metric: { label: "Stale top-level directories", value: stale.length },
        });
      }
    }

    const now = Math.floor(Date.now() / 1000);
    if (git.last > 0 && now - git.last > YEAR) {
      const months = Math.floor((now - git.last) / (30.44 * 86_400));
      out.push({
        id: "project-inactive",
        severity: "notice",
        title: `No commits in the last ${fmt(months)} months`,
        detail: `The newest commit is from ${new Date(git.last * 1000).toISOString().slice(0, 10)}. Activity-based findings here are measured against that date, not today.`,
        metric: { label: "Months since the last commit", value: months },
      });
    }

    if (git.truncated) {
      out.push({
        id: "history-truncated",
        severity: "notice",
        title: git.shallow
          ? `History is shallow: only ${plural(git.analyzedCommits, "commit")} ${git.analyzedCommits === 1 ? "was" : "were"} fetched`
          : `History was capped at the newest ${fmt(git.analyzedCommits)} of ${fmt(git.totalCommits)} commits`,
        detail: git.shallow
          ? "Ages, creation dates and ownership only see the fetched commits, and the oldest one makes every file look newly added, so the truck factor, knowledge islands and stale regions are left out. Re-run on a full clone for real history."
          : "Older commits are not counted, so ownership and file ages lean toward recent work. Raise --max-commits to analyze more.",
        metric: { label: "Commits analyzed", value: git.analyzedCommits },
      });
    }
  }

  // ── Structure ──
  const god = own.filter((f) => f.fanIn >= 10).sort((a, b) => b.fanIn - a.fanIn || a.id - b.id).slice(0, 5);
  if (god.length) {
    const top = god[0]!;
    out.push({
      id: "god-files",
      severity: top.fanIn >= 100 ? "warning" : "notice",
      title: `${top.path} is imported by ${plural(top.fanIn, "file")}`,
      detail: `A change to the most depended-on files reaches everything that imports them, so they deserve the strictest review and the best tests.${god.length > 1 ? ` Next: ${list(god.slice(1).map((f) => `${f.path} (${fmt(f.fanIn)})`), 4)}.` : ""}`,
      files: god.map((f) => f.id),
      metric: { label: "Importing files", value: top.fanIn },
    });
  }

  const large = own.filter((f) => f.code > 1000).sort((a, b) => b.code - a.code || a.id - b.id);
  if (large.length) {
    const top = large[0]!;
    out.push({
      id: "large-files",
      severity: top.code > 5000 ? "warning" : "notice",
      title: `${plural(large.length, "file")} ${large.length === 1 ? "exceeds" : "exceed"} 1,000 lines of code; the largest is ${top.path} (${fmt(top.code)})`,
      detail: "Files this long usually hold several responsibilities, which makes them harder to review, test and change without side effects.",
      files: large.slice(0, 20).map((f) => f.id),
      metric: { label: "Files over 1,000 code lines", value: large.length },
    });
  }

  const complex = own.filter((f) => f.complexity > 100).sort((a, b) => b.complexity - a.complexity || a.id - b.id);
  if (complex.length) {
    const top = complex[0]!;
    out.push({
      id: "complex-files",
      severity: top.complexity > 300 ? "warning" : "notice",
      title: `${plural(complex.length, "file")} ${complex.length === 1 ? "has" : "have"} a complexity over 100; ${top.path} tops the list at ${fmt(top.complexity)}`,
      detail: "Complexity counts decision points (if, loops, case, &&, catch). Past about 100 in one file there are more paths than anyone can hold in their head or test exhaustively.",
      files: complex.slice(0, 20).map((f) => f.id),
      metric: { label: "Files over complexity 100", value: complex.length },
    });
  }

  // From the full grouping, not report.stats.duplicates: that list is capped, and totals taken
  // from it would undercount exactly the repositories with the most duplication.
  const dups = duplicateGroups(files).filter((d) => d.bytes >= 256);
  if (dups.length) {
    const wasted = dups.reduce((s, d) => s + wastedBytes(d), 0);
    const copies = dups.reduce((s, d) => s + d.files.length, 0);
    const worst = dups[0]!; // duplicateGroups ranks by bytes repeated
    out.push({
      id: "duplicate-files",
      severity: wasted >= 1024 * 1024 || dups.length >= 20 ? "notice" : "info",
      title: `${plural(dups.length, "set")} of identical files (${fmt(copies)} copies, ${bytes(wasted)} repeated)`,
      detail: `Identical copies drift apart when one is fixed and the others are not, unless they are deliberate (vendored or generated). The costliest set is ${list(worst.files.map(path), 3)}.`,
      files: worst.files.slice(0, 20),
      metric: { label: "Bytes in repeated copies", value: wasted, unit: "B" },
    });
  }

  // ── Tests and TODOs ──
  const sources = own.filter((f) => f.category === "code").length;
  const tests = own.length - sources;
  if (sources >= 10) {
    const ratio = tests / sources;
    if (tests === 0 || ratio < 0.25) {
      const biggest = own.filter((f) => f.category === "code").sort((a, b) => b.code - a.code || a.id - b.id).slice(0, 5);
      out.push({
        id: "low-test-ratio",
        severity: ratio < 0.1 ? "warning" : "notice",
        title: tests === 0 ? `No test files among ${plural(sources, "source file")}` : `Test files are ${pct(ratio)} of source files (${fmt(tests)} for ${fmt(sources)})`,
        detail: "Tests are recognized by path and name conventions (test/, *_test.go, *.spec.ts…). A low ratio means changes are verified by hand, or by tests that live somewhere this report cannot see.",
        files: biggest.map((f) => f.id),
        metric: { label: "Test files per source file", value: Math.round(ratio * 100) / 100 },
      });
    }
  }

  const todoFiles = own.filter((f) => f.todos > 0).sort((a, b) => b.todos - a.todos || a.id - b.id);
  const todos = todoFiles.reduce((s, f) => s + f.todos, 0);
  if (todos > 0) {
    const top = todoFiles[0]!;
    out.push({
      id: "todo-dense",
      severity: todos >= 50 ? "notice" : "info",
      title: `${plural(todos, "TODO/FIXME marker")} in ${plural(todoFiles.length, "file")}; ${top.path} has the most (${fmt(top.todos)})`,
      detail: "Markers are known, unfinished work the authors wrote down. Dense clusters show where they knew the code fell short.",
      files: todoFiles.slice(0, 20).map((f) => f.id),
      metric: { label: "TODO/FIXME/HACK/XXX markers", value: todos },
    });
  }

  // ── Code intelligence ──
  if (symbols) {
    const s = symbols.symbols;
    const unusedByFile = new Map<number, number>();
    const deadByFile = new Map<number, number>();
    const nowhere = unreferenced(symbols);
    let unused = 0;
    let dead = 0;
    // An export of a declared entry point (FileRecord.entry: a config a tool loads, a script a
    // runtime runs, a package's exports) is read by whatever loads it: unreferenced, not dead.
    // Counted apart so "referenced nowhere" means deletable.
    let inEntries = 0;
    // A published package's API (FileRecord.publicApi) is used by its consumers, not by this
    // repository: an export there is neither dead nor something to make private.
    let publicApi = 0;
    // Exports declared in test files are counted apart rather than as dead code: specs export
    // fixtures and helpers to one another, and a test runner (not an import) is what uses
    // them. symbols.stats.unusedExports counts them, so the detail names the difference
    // instead of leaving two numbers that disagree for no visible reason.
    let unusedInTests = 0;
    for (let i = 0; i < s.name.length; i++) {
      const flags = s.flags[i]!;
      if (!(flags & SymbolFlag.unusedExport)) continue;
      if (flags & SymbolFlag.test) {
        unusedInTests++;
        continue;
      }
      unused++;
      unusedByFile.set(s.file[i]!, (unusedByFile.get(s.file[i]!) ?? 0) + 1);
      if (report.files[s.file[i]!]!.publicApi) publicApi++;
      else if (nowhere[i] && report.files[s.file[i]!]!.entry) inEntries++;
      else if (nowhere[i]) {
        dead++;
        deadByFile.set(s.file[i]!, (deadByFile.get(s.file[i]!) ?? 0) + 1);
      }
    }
    if (unused > 0) {
      // Files with dead exports first (nothing references them at all), then the ones whose
      // exports are only used at home: the first kind is deletable, the second only needs to
      // lose `export`, and a list ranked by the total put the second kind on top.
      const top = [...unusedByFile].sort((a, b) => (deadByFile.get(b[0]) ?? 0) - (deadByFile.get(a[0]) ?? 0) || b[1] - a[1] || a[0] - b[0]);
      const tests = unusedInTests > 0 ? ` Another ${plural(unusedInTests, "is", "are")} declared in test files and not counted here.` : "";
      const local = unused - dead - inEntries - publicApi;
      const parts = [
        dead > 0 ? `${fmt(dead)} ${dead === 1 ? "is" : "are"} referenced nowhere at all` : "",
        local > 0 ? `${fmt(local)} ${local === 1 ? "is" : "are"} used inside ${local === 1 ? "its" : "their"} own file and only need${local === 1 ? "s" : ""} to lose \`export\`` : "",
        inEntries > 0 ? `${fmt(inEntries)} ${inEntries === 1 ? "belongs" : "belong"} to declared entry points (configs, scripts, package exports), which whatever loads them may read` : "",
        publicApi > 0 ? `${fmt(publicApi)} ${publicApi === 1 ? "is" : "are"} a published package's API, for its consumers outside this repository` : "",
      ].filter(Boolean);
      const split = `Of these, ${parts.join("; ")}.`;
      out.push({
        id: "unused-exports",
        severity: unused >= 20 ? "notice" : "info",
        title: `${plural(unused, "exported symbol")} ${unused === 1 ? "is" : "are"} never used outside ${unused === 1 ? "its" : "their"} own file`,
        detail: `${split} Dead exports widen the surface a change has to consider. Some may be public API used outside this repository; ${path(top[0]![0])} has the most (${fmt(top[0]![1])}).${tests}`,
        files: top.slice(0, 20).map(([f]) => f),
        metric: { label: "Unused exports", value: unused },
      });
    }

    // Ranked by how many files use a symbol, then by references: a test helper called 56
    // times inside its one spec file is not the project's vocabulary.
    const ranked: number[] = [];
    for (let i = 0; i < s.name.length; i++) {
      if (s.kind[i] !== "module" && s.refs[i]! > 0 && !(s.flags[i]! & SymbolFlag.test)) ranked.push(i);
    }
    ranked.sort((a, b) => s.files[b]! - s.files[a]! || s.refs[b]! - s.refs[a]! || a - b);
    if (ranked.length) {
      const top = ranked.slice(0, 5);
      const first = top[0]!;
      out.push({
        id: "most-referenced",
        severity: "info",
        title: `${s.name[first]} is the most widely used symbol: ${plural(s.refs[first]!, "reference")} from ${plural(s.files[first]!, "file")}`,
        detail: `Heavily referenced symbols are the project's vocabulary; renaming or changing their signature touches every caller.${top.length > 1 ? ` Next: ${list(top.slice(1).map((i) => `${s.name[i]} (${plural(s.files[i]!, "file")})`), 4)}.` : ""}`,
        files: [...new Set(top.map((i) => s.file[i]!))],
        metric: { label: "References", value: s.refs[first]! },
      });
    }

    const deprecated: number[] = [];
    for (let i = 0; i < s.name.length; i++) if (s.flags[i]! & SymbolFlag.deprecated && s.refs[i]! > 0) deprecated.push(i);
    if (deprecated.length) {
      deprecated.sort((a, b) => s.refs[b]! - s.refs[a]! || a - b);
      const refs = deprecated.reduce((sum, i) => sum + s.refs[i]!, 0);
      out.push({
        id: "deprecated-in-use",
        severity: refs >= 20 ? "warning" : "notice",
        title: `${plural(deprecated.length, "deprecated symbol")} ${deprecated.length === 1 ? "is" : "are"} still referenced ${plural(refs, "time")}`,
        detail: `Marked @deprecated but still in use: ${list(deprecated.map((i) => `${s.name[i]} (${fmt(s.refs[i]!)})`), 4)}. Each remaining reference is migration work left to do.`,
        files: [...new Set(deprecated.slice(0, 20).map((i) => s.file[i]!))],
        metric: { label: "References to deprecated symbols", value: refs },
      });
    }
  }

  // ── Repository hygiene ──
  // Committed credential-like files are a warning even when they all sit under test or fixture
  // directories (vite has 16 such .env files). Telling a fixture value from a real key means
  // reading the file, which nothing in Skyplate does, and real keys do get committed as
  // "test" config; a warning someone dismisses costs less than one that never fired.
  const secrets = files.filter((f) => f.secret);
  if (secrets.length) {
    const committed = secrets.filter((f) => f.git);
    out.push({
      id: "secret-files",
      severity: committed.length ? "warning" : "notice",
      title: `${plural(secrets.length, "file")} ${secrets.length === 1 ? "looks" : "look"} like credentials: ${list(secrets.map((f) => f.path), 3)}`,
      detail: `Judged by name and key markers only; their contents were not embedded in this report. Check that each is meant to be here${committed.length ? `: ${plural(committed.length, "is", "are")} in git history, where a key stays readable even after the file is deleted` : ""}.`,
      files: secrets.slice(0, 50).map((f) => f.id),
      metric: { label: "Credential-like files", value: secrets.length },
    });
  }

  const totalLines = report.totals.lines;
  const genLines = files.filter((f) => f.generated || f.vendored).reduce((s, f) => s + f.lines, 0);
  const genFiles = files.filter((f) => f.generated || f.vendored);
  if (totalLines > 0 && genLines / totalLines >= 0.05) {
    const share = genLines / totalLines;
    const biggest = [...genFiles].sort((a, b) => b.lines - a.lines || a.id - b.id).slice(0, 10);
    out.push({
      id: "generated-share",
      severity: share >= 0.25 ? "notice" : "info",
      title: `${pct(share)} of lines are generated or vendored (${plural(genFiles.length, "file")})`,
      detail: "They are left out of hotspots, ownership, the truck factor, test ratios and language colors, so the rest of this report describes the project's own code.",
      files: biggest.map((f) => f.id),
      metric: { label: "Generated or vendored lines", value: Math.round(share * 1000) / 10, unit: "%" },
    });
  }

  return out
    .map((f, i) => ({ f, i }))
    .sort((a, b) => SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity] || a.i - b.i)
    .map(({ f }) => f);
}
