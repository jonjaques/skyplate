// Scoring shared by the oracle, the summary and the comparison. It lives apart from oracle.ts
// because that file imports TypeScript 5.9.3 from this eval's own package, which a clean
// checkout (and CI) does not install, so the root typecheck excludes it; these types and the
// arithmetic must stay checkable without it.

export interface Selection { name: string; file: string; kind?: string; parent?: string }
export interface Location { key: string; call: boolean; node?: string; kind?: number; from?: number; manual?: string }
export interface Score { tp: number; fp: number; fn: number; precision: number | null; recall: number | null }
export interface OracleRow {
  sel: Selection;
  id?: number;
  kind?: string;
  error?: string;
  refs?: Score;
  calls?: Score;
  callers?: Score & { oracle: string[]; sky: string[] };
  oracle?: Location[];
  sky?: Location[];
  falsePositives?: string[];
  falseNegatives?: string[];
  callFalsePositives?: string[];
  callFalseNegatives?: string[];
}

export function score(expected: Iterable<string>, actual: Iterable<string>): Score {
  const gold = new Set(expected);
  const got = new Set(actual);
  const tp = [...got].filter((k) => gold.has(k)).length;
  return {
    tp, fp: got.size - tp, fn: gold.size - tp,
    precision: got.size ? tp / got.size : null,
    recall: gold.size ? tp / gold.size : null,
  };
}
