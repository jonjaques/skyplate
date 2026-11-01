/**
 * The specimen label's "det." line: one measured fact chosen for each file.
 *
 * On a museum label the determination line records who identified the specimen and as what.
 * Here it records the single thing about the file a reader would most want to know, picked by
 * which of its metrics stands out most against the rest of the collection (highest percentile
 * rank), so a hub reads "det. 412 dependents" and a churning file "det. 61 commits".
 */

import { formatInt, plural } from "../lib/format";
import { percentileRanks, type Model } from "../model/indices";

interface Candidate {
  rank: Float32Array;
  text(fileId: number): string | null;
}

export interface Facts {
  det(fileId: number): string;
}

export function buildFacts(model: Model): Facts {
  const files = model.report.files;
  const n = files.length;
  const column = (get: (i: number) => number) => {
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) v[i] = get(i);
    return percentileRanks(v);
  };
  const candidates: Candidate[] = [
    {
      rank: column((i) => files[i]!.fanIn),
      text: (i) => (files[i]!.fanIn > 0 ? `det. ${plural(files[i]!.fanIn, "dependent")}` : null),
    },
    {
      rank: column((i) => files[i]!.git?.commits ?? 0),
      text: (i) => {
        const c = files[i]!.git?.commits ?? 0;
        return c > 1 ? `det. ${plural(c, "commit")}, ${plural(files[i]!.git!.authors, "author")}` : null;
      },
    },
    {
      rank: column((i) => files[i]!.complexity),
      text: (i) => (files[i]!.complexity > 1 ? `det. complexity ${formatInt(files[i]!.complexity)}` : null),
    },
    {
      rank: column((i) => files[i]!.lines),
      text: (i) => (files[i]!.lines > 0 ? `det. ${plural(files[i]!.lines, "line")}` : null),
    },
  ];
  return {
    det(i) {
      const f = files[i];
      if (!f) return "";
      if (model.holotypes.has(i)) return `det. ${plural(f.fanIn, "dependent")}, most in drawer`;
      let best: string | null = null;
      let bestRank = -1;
      for (const c of candidates) {
        const r = c.rank[i]!;
        if (r <= bestRank) continue;
        const t = c.text(i);
        if (t) {
          best = t;
          bestRank = r;
        }
      }
      if (best) return best;
      if (f.binary) return `det. binary, ${f.facts?.format ?? "unrecognized format"}`;
      return "det. empty file";
    },
  };
}
