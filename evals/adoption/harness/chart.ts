import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { freshOutput } from "./paths.ts";

const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export function renderChart(result: any): string {
  const arms = Object.keys(result.arms).filter(
    (arm) => result.arms[arm].statistics,
  );
  const labels: Record<string, string> = {
    codex: "Codex",
    claude: "Claude Code",
  };
  const metrics = [
    ["used", "Any Skyplate call"],
    ["first", "First tool"],
    ["firstThree", "Within first three"],
  ] as const;
  const bars: string[] = [];
  const max = Math.max(
    1,
    ...arms.map((arm) => result.arms[arm].statistics.completed),
  );
  metrics.forEach(([key, label], i) => {
    const base = 45 + i * (arms.length * 27 + 32);
    bars.push(`<text x="0" y="${base}">${label}</text>`);
    arms.forEach((arm, j) => {
      const stats = result.arms[arm].statistics,
        value = stats[key],
        y = base + 12 + j * 27;
      bars.push(
        `<text x="0" y="${y + 12}" font-size="13">${escape(labels[arm] ?? arm)}</text><rect x="115" y="${y}" width="340" height="17" fill="#ddd"/><rect x="115" y="${y}" width="${(340 * value) / max}" height="17" fill="${j % 2 ? "#555" : "#111"}"/><text x="470" y="${y + 13}">${value} / ${stats.completed}</text>`,
      );
    });
  });
  const rows = arms
    .map((arm) => {
      const s = result.arms[arm].statistics;
      return `<tr><th scope="row">${escape(labels[arm] ?? arm)}</th><td>${s.used} / ${s.completed}</td><td>${s.first} / ${s.completed}</td><td>${s.firstThree} / ${s.completed}</td></tr>`;
    })
    .join("");
  const height = 60 + metrics.length * (arms.length * 27 + 32);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Skyplate adoption ${escape(result.run ?? "run")}</title><style>body{margin:2rem auto;padding:0 1rem;max-width:52rem;font-family:system-ui;color:#111;background:#fff;line-height:1.5}figure{margin:0}svg{display:block;width:100%;height:auto}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{text-align:left;padding:.5rem;border-bottom:1px solid #aaa}caption{text-align:left;font-weight:600}</style></head><body><main><h1>Skyplate adoption ${escape(result.run ?? "run")}</h1><figure><svg role="img" aria-labelledby="chart-title chart-description" viewBox="0 0 570 ${height}"><title id="chart-title">Observed Skyplate use</title><desc id="chart-description">Counts of completed sessions with any Skyplate call, Skyplate as the first tool, and Skyplate within the first three tools. Exact counts appear in the table below.</desc>${bars.join("")}</svg><figcaption>One pass per prompt and arm, including two controls where Skyplate should not be used. Counts are observations, not adoption rates.</figcaption></figure><table><caption>Exact adoption counts, including controls</caption><thead><tr><th scope="col">Arm</th><th scope="col">Any call</th><th scope="col">First tool</th><th scope="col">First three</th></tr></thead><tbody>${rows}</tbody></table></main></body></html>`;
}

if (import.meta.main) {
  const [file, flag, out] = process.argv.slice(2);
  if (!file || flag !== "--out" || !out || process.argv.length !== 5)
    throw new Error("Usage: bun chart.ts RESULTS_JSON --out NEW_DIR");
  const input = resolve(file),
    output = freshOutput(out, [dirname(input)]);
  writeFileSync(
    join(output, "adoption.html"),
    renderChart(JSON.parse(readFileSync(input, "utf8"))),
  );
  console.log(join(output, "adoption.html"));
}
