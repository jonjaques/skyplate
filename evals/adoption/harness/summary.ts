import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)]! +
        sorted[Math.floor(sorted.length / 2)]!) /
        2
    : null;
};
const cell = (value: unknown) =>
  String(value ?? "-")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ");
const toolNames = (s: any): string[] =>
  s.toolNames ?? s.tools.map((t: any) => t.name);

// Public results keep only names and numeric observations. Summary generation therefore
// never needs transcripts, tool arguments, session identifiers or final-answer text.
export function summarize(result: any, output: string): void {
  const gradeFile = join(output, "grades.json");
  const grades = existsSync(gradeFile)
    ? JSON.parse(readFileSync(gradeFile, "utf8"))
    : {};
  for (const session of result.sessions) {
    const review = grades[session.arm]?.[session.id];
    if (review && session.state === "completed" && session.exitCode === 0)
      Object.assign(session, review);
  }
  const rows = [
    "# Agent adoption experiment",
    "",
    `Repository: ${result.repository.url}, commit ${result.repository.commit}. ${result.repository.files} tracked files; ${result.repository.commits} reachable commits.`,
    "",
    "Positions count every observed tool invocation, including instruction and skill reads. Handshakes are excluded. These are counts from one pass per prompt, not adoption rates.",
    "",
    "| Arm | Prompt | State | Exit | Tools | First Skyplate position | Skyplate calls | Seconds | Grade |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const s of result.sessions)
    rows.push(
      `| ${cell(s.arm)} | ${cell(s.id)}${s.control ? " control" : ""} | ${cell(s.state)} | ${cell(s.exitCode)} | ${toolNames(s).length} | ${cell(s.firstSkyplatePosition)} | ${s.skyplateCalls} | ${s.wallSeconds.toFixed(1)} | ${cell(s.grade ?? "ungraded")} |`,
    );
  rows.push(
    "",
    "| Arm | Completed | Tasks using Skyplate / tasks | First tool | First three | Controls using Skyplate / controls | Median tools | Median seconds | Correct / partly / wrong |",
    "| --- | ---: | --- | ---: | ---: | --- | ---: | ---: | --- |",
  );
  for (const arm of Object.keys(result.arms)) {
    const sessions = result.sessions.filter(
      (s: any) => s.arm === arm && s.state === "completed" && s.exitCode === 0,
    );
    const tasks = sessions.filter((s: any) => !s.control),
      controls = sessions.filter((s: any) => s.control);
    const stat = {
      completed: sessions.length,
      used: sessions.filter((s: any) => s.skyplateCalls > 0).length,
      taskCount: tasks.length,
      taskUses: tasks.filter((s: any) => s.skyplateCalls > 0).length,
      first: sessions.filter((s: any) => s.firstSkyplatePosition === 1).length,
      firstThree: sessions.filter(
        (s: any) =>
          s.firstSkyplatePosition != null && s.firstSkyplatePosition <= 3,
      ).length,
      controlCount: controls.length,
      controlUses: controls.filter((s: any) => s.skyplateCalls > 0).length,
      medianTools: median(sessions.map((s: any) => toolNames(s).length)),
      medianSeconds: median(sessions.map((s: any) => s.wallSeconds)),
      correct: sessions.filter((s: any) => s.grade === "correct").length,
      partly: sessions.filter((s: any) => s.grade === "partly").length,
      wrong: sessions.filter((s: any) => s.grade === "wrong").length,
    };
    result.arms[arm].statistics = stat;
    rows.push(
      `| ${cell(arm)} | ${stat.completed} | ${stat.taskUses} / ${stat.taskCount} | ${stat.first} | ${stat.firstThree} | ${stat.controlUses} / ${stat.controlCount} | ${stat.medianTools ?? "-"} | ${stat.medianSeconds?.toFixed(1) ?? "-"} | ${stat.correct} / ${stat.partly} / ${stat.wrong} |`,
    );
    if (result.arms[arm].skipReason)
      rows.push(
        "",
        `${cell(arm)} skipped: ${cell(result.arms[arm].skipReason)}`,
      );
  }
  rows.push("", "## Grades", "");
  for (const s of result.sessions)
    rows.push(
      `- ${cell(s.arm)}/${cell(s.id)}: ${cell(s.grade ?? "ungraded")}. ${cell(s.gradeReason ?? "Review pending.")}`,
    );
  rows.push(
    "",
    "## Limitations",
    "",
    ...(result.limitations ?? []).map((s: string) => "- " + s),
  );
  writeFileSync(join(output, "summary.md"), rows.join("\n") + "\n");
  writeFileSync(
    join(output, "results.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
}
