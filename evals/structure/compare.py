from pathlib import Path
import argparse
import json

CHECKOUT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description="Compare the Requests smoke rerun with the retained study")
parser.add_argument("--historical", required=True)
parser.add_argument("--current", required=True)
parser.add_argument("--out", required=True)
args = parser.parse_args()
historical = Path(args.historical).resolve()
current = Path(args.current).resolve()
out = Path(args.out).resolve()
if out.exists() or not out.parent.is_dir():
    parser.error("--out must be new and its parent must exist")
for root in [CHECKOUT, historical, current]:
    if out == root or out.is_relative_to(root) or root.is_relative_to(out):
        parser.error("--out must be outside the checkout and input results")
out.mkdir(mode=0o700)
def read(root, name):
    return json.loads((root / name).read_text())
before = next(row for row in read(historical, "accuracy.json") if row["name"] == "requests")
after = read(current, "requests-summary.json")
comparison = {
    "analyzerBefore": "f0f874f82700ec5e5c62beef457e74de95d5841d",
    "analyzerAfter": after["analyzerCommit"],
    "inputCommitMatches": after["commitMatches"],
    "statementCountsUnchanged": before["by"] == after["by"],
    "complexityUnchangedUsingRetainedOracle": read(historical, "complexity.json") == read(current, "complexity.json"),
    "typeGuardPairsUnchanged": read(historical, "python-type-guards.json") == read(current, "python-type-guards.json"),
    "historyChecks": read(current, "history-checks.json"),
    "encodingStillReproducesS7": read(current, "encoding.json")["reproducesS7"],
    "graphChains": [{"files": old["files"], "beforeMs": old["ms"], "afterMs": new["ms"]} for old, new in zip(read(historical, "graph-scale.json"), read(current, "graph-scale.json"))],
    "interpretation": [
        "The analyzer commit changed but the measured small structure and history contracts did not",
        "Correlation reused the old parser output; it does not revalidate a newer parser",
        "Single-run timing differences have uncontrolled load and are not a regression estimate",
        "Large corpora and native builds were not rerun"
    ]
}
(out / "comparison.json").write_text(json.dumps(comparison, indent=2) + "\n")
print(json.dumps(comparison, indent=2))
