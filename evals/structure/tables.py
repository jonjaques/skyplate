from pathlib import Path
import argparse
import collections
import gzip
import json
import re

CHECKOUT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description="Rebuild the numeric study tables from retained evidence")
parser.add_argument("--results", required=True)
parser.add_argument("--out", required=True)
args = parser.parse_args()
source = Path(args.results).resolve()
out = Path(args.out).resolve()
if out.exists() or not out.parent.is_dir():
    parser.error("--out must not exist and its parent must exist")
for root in [CHECKOUT, source]:
    if out == root or out.is_relative_to(root) or root.is_relative_to(out):
        parser.error("--out must be outside the checkout and results input")
out.mkdir(mode=0o700)
def read(name):
    return json.loads((source / name).read_text())
with gzip.open(source / "measurements.json.gz", "rt") as stream:
    measurements = json.load(stream)
accuracy = read("accuracy.json")
reviews = collections.Counter(row["repo"] for row in read("edge-review.json"))
projects = []
imports = []
for result in accuracy:
    name = result["name"]
    measurement = next(row for row in measurements if row["name"] == name)
    projects.append({"name": name, "files": measurement["totals"]["files"], "selectedLanguages": {lang: row["files"] for lang, row in result["by"].items()}})
    for language, counts in result["by"].items():
        total = sum(counts[k] for k in ["internal", "external", "unresolved"])
        imports.append({"name": name, "language": language, "statements": total, **counts, "internalPercent": 100 * counts["internal"] / total, "externalPercent": 100 * counts["external"] / total, "unresolvedPercent": 100 * counts["unresolved"] / total, "reviewedAcrossSelectedLanguages": reviews[name]})
history = next(row for row in measurements if row["name"] == "history")
history_rows = [{"path": f["path"], "hotspot": f["hotspot"], **f["git"]} for f in history["files"]]
scale = []
for name, log in [("kubernetes-nogit", "kubernetes-nogit.log"), ("kubernetes-cap50", "kubernetes-cap50.log"), ("kubernetes", "kubernetes-cli.log")]:
    row = next(row for row in measurements if row["name"] == name)
    text = (source / log).read_text()
    wall = re.search(r"([\d.]+) real", text)
    rss = re.search(r"(\d+)\s+maximum resident set size", text)
    scale.append({"name": name, "timingsMs": row["timings"], "wallSeconds": float(wall[1]) if wall else None, "maxRssBytes": int(rss[1]) if rss else None, "maxRssGiB": int(rss[1]) / 2 ** 30 if rss else None})
detection = read("detection-verdicts.json")
result = {"projects": projects, "imports": imports, "detection": {"reviewed": len(detection), "languageAccepted": sum(row["languageAccepted"] for row in detection), "categoryAcceptedUnderPathRubric": sum(row["categoryAcceptedUnderPathRubric"] for row in detection)}, "complexity": {k: v for k, v in read("complexity.json").items() if k != "rows"}, "packageProjection": read("package-cap.json"), "history": history_rows, "kubernetesPhases": scale, "graphChains": read("graph-scale.json")}
(out / "tables.json").write_text(json.dumps(result, indent=2) + "\n")
print("Rebuilt corpus, language, complexity, package projection, history, phase, and chain tables")
