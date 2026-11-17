import ts from "typescript";
import { readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { args, output, portable, required, sourcePattern, write, type Measurement } from "./common";
import { score, type Location, type OracleRow, type Selection } from "./scoring";

function nodeAt(source: ts.SourceFile, position: number): ts.Node {
  let result: ts.Node = source;
  function visit(node: ts.Node): void {
    if (node.getStart(source) <= position && node.end > position) {
      result = node;
      ts.forEachChild(node, visit);
    }
  }
  ts.forEachChild(source, visit);
  return result;
}

// Classify syntax independently of Skyplate's RefKind and reference walker.
function invocation(node: ts.Node): boolean {
  let expression = node;
  let parent: ts.Node | undefined = expression.parent;
  if (parent && ts.isPropertyAccessExpression(parent) && parent.name === expression) {
    expression = parent;
    parent = parent.parent;
  }
  while (parent && (ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent)
    || ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent) || ts.isSatisfiesExpression(parent))) {
    if (parent.expression !== expression) break;
    expression = parent;
    parent = parent.parent;
  }
  if (!parent) return false;
  return ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === expression)
    || (ts.isTaggedTemplateExpression(parent) && parent.tag === expression)
    || ts.isDecorator(parent)
    || ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) && parent.tagName === expression);
}

function skip(node: ts.Node): boolean {
  const parent = node.parent;
  return !!parent && (ts.isJsxClosingElement(parent)
    || ((ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) && parent.name === node && !!parent.propertyName));
}

function run(): void {
  const flags = args(["project", "input", "corpus", "samples", "out"]);
  const root = realpathSync(required(flags, "project"));
  const out = output(flags, root);
  if (ts.version !== "5.9.3") throw new Error("Install the eval package first; the oracle requires TypeScript 5.9.3");
  const analysis = JSON.parse(readFileSync(required(flags, "input"), "utf8")) as Measurement;
  if (!analysis.data) throw new Error("The analyzer skipped code intelligence");
  const { symbols: S, refs: R } = analysis.data;
  const samples = JSON.parse(readFileSync(flags.samples ?? join(import.meta.dir, "samples.json"), "utf8")) as Record<string, Selection[]>;
  const selection = samples[required(flags, "corpus")];
  if (!selection) throw new Error("Unknown corpus in --samples");
  const defaults: ts.CompilerOptions = {
    allowJs: true, checkJs: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    skipLibCheck: true, allowImportingTsExtensions: true,
  };
  const config = ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile);
  const parsed = config.config ? ts.parseJsonConfigFileContent(config.config, ts.sys, root) : undefined;
  const options = { ...defaults, ...parsed?.options };
  const files = analysis.paths.filter((p) => sourcePattern.test(p)).map((p) => join(root, p));
  const snapshots = new Map<string, ts.IScriptSnapshot>();
  const service = ts.createLanguageService({
    getScriptFileNames: () => files,
    getScriptVersion: () => "1",
    getScriptSnapshot: (file) => {
      if (!snapshots.has(file)) {
        const source = ts.sys.readFile(file);
        if (source !== undefined) snapshots.set(file, ts.ScriptSnapshot.fromString(source));
      }
      return snapshots.get(file);
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists, realpath: ts.sys.realpath,
  });
  try {
    const program = service.getProgram();
    if (!program) throw new Error("LanguageService returned no program");
    const isRepo = (file: string) => file.startsWith(root + "/") && !file.includes("/node_modules/");
    const key = (file: string, line: number, col: number) => `${relative(root, file)}:${line}:${col}`;
    const anchor = (id: number) => `${analysis.paths[S.file[id]!]!}:${S.line[id]!}:${S.col[id]!}`;
    const anchors = new Map<string, number>();
    for (let id = 0; id < S.name.length; id++) if (S.kind[id] !== "module") anchors.set(anchor(id), id);

    // Only the containment granularity comes from Skyplate. Invocation syntax and locations
    // come from TS5.9. This deliberately cannot measure missing declaration identities.
    function callerAt(location: string): string {
      const parts = location.split(":");
      const col = Number(parts.pop());
      const line = Number(parts.pop());
      const file = parts.join(":");
      const source = program!.getSourceFile(join(root, file));
      if (!source) return file + ":module";
      let node: ts.Node | undefined = nodeAt(source, ts.getPositionOfLineAndCharacter(source, line, col));
      while (node) {
        const named = node as ts.Node & { name?: ts.Node & { text?: string } };
        const names: (ts.Node & { text?: string } | undefined)[] = [named.name];
        if (ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left)) names.push(node.left.name);
        for (const name of names) {
          if (!name) continue;
          const lc = source.getLineAndCharacterOfPosition(name.getStart(source));
          let found = anchors.get(`${file}:${lc.line}:${lc.character}`);
          // Adjacent overloads have the first signature's anchor, even in the implementation.
          if (found === undefined && ts.isFunctionDeclaration(node) && node.body) {
            const candidate = S.name.findIndex((n, id) => n === name.text && analysis.paths[S.file[id]!] === file
              && S.line[id]! <= lc.line && S.endLine[id]! >= lc.line);
            if (candidate >= 0) found = candidate;
          }
          if (found !== undefined) return anchor(found);
        }
        if (ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isExportAssignment(node)) {
          const lc = source.getLineAndCharacterOfPosition(node.getStart(source));
          const found = anchors.get(`${file}:${lc.line}:${lc.character}`);
          if (found !== undefined) return anchor(found);
        }
        node = node.parent;
      }
      return file + ":module";
    }

    const results: OracleRow[] = selection.map((sel) => {
      const ids = S.name.flatMap((name, id) => name === sel.name && analysis.paths[S.file[id]!] === sel.file
        && (!sel.kind || sel.kind === S.kind[id]) && (!sel.parent || S.name[S.parent[id]!] === sel.parent) ? [id] : []);
      const id = ids[0];
      if (ids.length !== 1 || id === undefined) return { sel, error: `matches ${ids.length}` };
      const file = join(root, sel.file);
      const source = program.getSourceFile(file);
      if (!source) return { sel, error: "no source" };
      const position = ts.getPositionOfLineAndCharacter(source, S.line[id]!, S.col[id]!);
      const oracle = new Map<string, Location>();
      let groups: ts.ReferencedSymbol[];
      try { groups = service.findReferences(file, position) ?? []; }
      catch (error) { return { sel, error: String(error) }; }
      for (const group of groups) for (const ref of group.references) {
        if (ref.isDefinition || !isRepo(ref.fileName)) continue;
        const sf = program.getSourceFile(ref.fileName);
        if (!sf) continue;
        const node = nodeAt(sf, ref.textSpan.start);
        if (skip(node)) continue;
        const lc = sf.getLineAndCharacterOfPosition(ref.textSpan.start);
        const k = key(ref.fileName, lc.line, lc.character);
        oracle.set(k, { key: k, call: invocation(node), node: ts.SyntaxKind[node.kind] });
      }

      // TS5.9 conflates six app-instance uses with this re-exported factory and misses its
      // require aliases. This narrow supplement follows the audited Express entry only.
      if (sel.name === "createApplication" && sel.file === "lib/express.js") {
        for (const k of oracle.keys()) if (!k.startsWith("lib/express.js:")) oracle.delete(k);
        const checker = program.getTypeChecker();
        for (const sf of program.getSourceFiles()) {
          if (!isRepo(sf.fileName)) continue;
          const aliases = new Set<ts.Symbol>();
          function definitions(node: ts.Node): void {
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
              && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression)
              && node.initializer.expression.text === "require") {
              const argument = node.initializer.arguments[0];
              if (argument && ts.isStringLiteral(argument) && argument.text.startsWith(".")) {
                const target = join(sf.fileName, "..", argument.text);
                if ([root, root + "/", root + "/index", root + "/index.js", root + "/lib/express", root + "/lib/express.js"].includes(target)) {
                  const symbol = checker.getSymbolAtLocation(node.name);
                  if (symbol) aliases.add(symbol);
                }
              }
            }
            ts.forEachChild(node, definitions);
          }
          definitions(sf);
          function references(node: ts.Node): void {
            if (ts.isIdentifier(node)) {
              const symbol = checker.getSymbolAtLocation(node);
              if (symbol && aliases.has(symbol)) {
                const lc = sf.getLineAndCharacterOfPosition(node.getStart(sf));
                const k = key(sf.fileName, lc.line, lc.character);
                oracle.set(k, { key: k, call: invocation(node), node: ts.SyntaxKind[node.kind], manual: "audited CommonJS entry require alias" });
              }
            }
            ts.forEachChild(node, references);
          }
          references(sf);
        }
      }

      const sky = new Map<string, Location>();
      for (let r = 0; r < R.symbol.length; r++) {
        if (R.symbol[r] !== id) continue;
        const rel = analysis.paths[R.file[r]!]!;
        // Overrides are synthetic member-name links; real extends/implements tokens remain.
        if (R.kind[r] === 8 || R.kind[r] === 9) {
          const sf = program.getSourceFile(join(root, rel));
          if (sf) {
            const node = nodeAt(sf, ts.getPositionOfLineAndCharacter(sf, R.line[r]!, R.col[r]!));
            if ((node.parent as ts.NamedDeclaration | undefined)?.name === node) continue;
          }
        }
        const k = `${rel}:${R.line[r]!}:${R.col[r]!}`;
        sky.set(k, { key: k, call: [2, 3, 4].includes(R.kind[r]!), kind: R.kind[r]!, from: R.from[r]! });
      }
      const oracleCalls = [...oracle.values()].filter((v) => v.call).map((v) => v.key);
      const skyCalls = [...sky.values()].filter((v) => v.call);
      const ownKey = anchor(id);
      const ocallers = [...new Set(oracleCalls.map(callerAt).filter((k) => k !== ownKey))];
      const scallers = [...new Set(skyCalls.map((v) => S.kind[v.from!] === "module"
        ? analysis.paths[S.file[v.from!]!]! + ":module" : anchor(v.from!)).filter((k) => k !== ownKey))];
      const missing = (gold: string[], actual: string[]) => {
        const got = new Set(actual);
        return gold.filter((k) => !got.has(k));
      };
      return {
        sel, id, kind: S.kind[id], refs: score(oracle.keys(), sky.keys()),
        calls: score(oracleCalls, skyCalls.map((v) => v.key)),
        callers: { ...score(ocallers, scallers), oracle: ocallers, sky: scallers },
        oracle: [...oracle.values()], sky: [...sky.values()],
        falsePositives: missing([...sky.keys()], [...oracle.keys()]),
        falseNegatives: missing([...oracle.keys()], [...sky.keys()]),
        callFalsePositives: missing(skyCalls.map((v) => v.key), oracleCalls),
        callFalseNegatives: missing(oracleCalls, skyCalls.map((v) => v.key)),
      };
    });
    write(out, "oracle.json", portable({ root: ".", oracle: `TypeScript ${ts.version} LanguageService.findReferences, aggregate root project`, results }, [[root, "."]]));
    console.log(JSON.stringify({ selected: results.length, errors: results.filter((r) => r.error).length }));
    if (results.some((r) => r.error)) process.exitCode = 1;
  } finally { service.dispose(); }
}

if (import.meta.main) run();
