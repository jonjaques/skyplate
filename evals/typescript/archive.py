"""Pack the original study evidence without dependencies, clones, or source excerpts."""

import argparse
import hashlib
import json
import re
from pathlib import Path


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", required=True, type=Path)
parser.add_argument("--out", required=True, type=Path)
args = parser.parse_args()
source = args.source.resolve()
out = args.out.resolve()
checkout = Path(__file__).resolve().parents[2]
if out.exists() or out.is_relative_to(checkout) or out.is_relative_to(source):
    parser.error("--out must be new and outside the checkout and source evidence")
out.mkdir(parents=True)
inputs = {}
replacements = [(str(source), "<evidence>"), (str(checkout), "<checkout>")]
for name in ["measure.ts", "oracle.ts", "probes.ts", "failure-cap.ts", "pagination.ts",
             "dogfood.ts", "scale.ts", "workspace-probe.ts", "summarize.py", "samples.json",
             "external-evidence.md"]:
    raw = (source / name).read_bytes()
    inputs[name] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def read(name):
    raw = (source / name).read_bytes()
    inputs[name] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    return json.loads(raw)


def scrub(value):
    if isinstance(value, dict):
        return {key: scrub(item) for key, item in value.items()}
    if isinstance(value, list):
        return [scrub(item) for item in value]
    if isinstance(value, str):
        for old, new in sorted(replacements, key=lambda pair: -len(pair[0])):
            value = value.replace(old, new)
        value = value.replace(str(Path.home()), "<home>")
    return value


def write(name, value):
    # Locations dominate the archive. Compact JSON keeps every editable site without
    # spending most of the size budget on indentation and repeated source context.
    compact = name.endswith("-oracle.json")
    (out / name).write_text(json.dumps(scrub(value), indent=None if compact else 2,
                                      separators=(",", ":") if compact else None) + "\n")


corpora = ["sky-bare", "sky-installed", "query-bare", "express-bare",
           "express-installed", "plimit-bare", "plimit-installed"]
for corpus in corpora:
    analysis = read(corpus + ".json")
    root = analysis["summary"]["root"]
    replacements.insert(0, (root, "."))
    # The root/path list and full columnar dump are redundant with the selected location
    # evidence. Retain the counts, warnings, configuration ownership, and timings.
    summary = analysis["summary"]
    summary["logs"] = [line for line in summary["logs"] if "failed" in line.lower()
                       or "exceed" in line.lower()][:20]
    write(corpus + "-summary.json", summary)
    oracle = read(corpus + "-oracle.json")
    for row in oracle["results"]:
        for side in ["oracle", "sky"]:
            for location in row.get(side, []):
                location.pop("text", None)
    write(corpus + "-oracle.json", oracle)
    replacements.remove((root, "."))

for name in ["summary-results.json", "probe-rows.json", "probe-queries.json", "probes.json",
             "partial-failure.json", "missing-deps.json", "cap-recursion.json", "seam-cap.json",
             "prototype-probe.json", "workspace-probe.json"]:
    write(name, read(name))

for count in [100, 1000, 5000, 20000, 20001]:
    write(f"scale{count}.json", read(f"scale{count}.json"))
    name = f"scale{count}-time.txt"
    raw = (source / name).read_bytes()
    inputs[name] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    (out / name).write_text(scrub(raw.decode()))


def transcript(rows):
    packed = []
    for row in rows:
        response = row["result"]
        structured = response.get("structuredContent", {})
        packed.append({"name": row["name"], "args": row["args"], "ms": row["ms"],
                       "isError": response.get("isError", False),
                       "data": structured.get("data", response.get("content"))})
    return packed


def omit_identity(value):
    if isinstance(value, dict):
        return {key: omit_identity(item) for key, item in value.items()
                if key not in {"git", "owners", "author", "remote", "truckFactorAuthors"}}
    if isinstance(value, list):
        return [omit_identity(item) for item in value
                if not isinstance(item, str) or "(truck-factor)" not in item]
    return value


write("pagination-mcp.json", transcript(read("pagination-mcp.json")))
raw = (source / "mcp.jsonl").read_bytes()
inputs["mcp.jsonl"] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
write("mcp.json", omit_identity(transcript([json.loads(line) for line in raw.splitlines()])))
raw = (source / "query-install.log").read_bytes()
inputs["query-install.log"] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
# The installer wraps a filesystem path across lines, so root substitution alone cannot
# sanitize it. Keep the parse failure and YAML excerpt, omitting the entire path segment.
installation = re.sub(r"Failed to parse.*?error:", "Failed to parse pnpm-workspace.yaml: error:",
                      raw.decode(), flags=re.DOTALL)
(out / "query-install.log").write_text(scrub(installation))
raw = (source / "ts-tests.log").read_bytes()
inputs["ts-tests.log"] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
(out / "ts-tests.log").write_text(scrub(raw.decode()))
write("provenance.json", {
    "studyDate": "2026-11-16", "analyzerRevision": "f0f874f82700ec5e5c62beef457e74de95d5841d",
    "bun": "1.4.4", "analyzerTypeScript": "7.0.2", "oracleTypeScript": "5.9.3",
    "inputs": inputs,
    "transformations": ["Absolute roots replaced by relative paths or placeholders",
                        "Oracle source excerpts omitted; all selected locations retained",
                        "Full corpus analyzer dumps replaced by summary objects",
                        "MCP duplicate text renderings omitted when structured data exists",
                        "MCP git and ownership identity fields omitted",
                        "Wrapped installer path omitted; parse error and YAML retained",
                        "Corpus progress logs limited to the first 20 failures or caps"],
})
