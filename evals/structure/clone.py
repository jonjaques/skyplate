from pathlib import Path
import argparse
import json
import os
import subprocess

CHECKOUT = Path(__file__).resolve().parents[2]

def fresh_out(value, projects=()):
    out = Path(value).resolve()
    if out.exists():
        raise ValueError("--out must not exist")
    if not out.parent.is_dir():
        raise ValueError("--out parent must exist")
    for root in [CHECKOUT, *map(lambda x: Path(x).resolve(), projects)]:
        if out == root or out.is_relative_to(root) or root.is_relative_to(out):
            raise ValueError("--out must be outside the checkout and analyzed repositories")
    out.mkdir(mode=0o700)
    return out

parser = argparse.ArgumentParser(description="Fetch the recorded depth-50 corpus commit into a new output directory")
parser.add_argument("--name", required=True)
parser.add_argument("--out", required=True)
args = parser.parse_args()
corpus = json.loads((Path(__file__).parent / "corpus.json").read_text())
row = next((r for r in corpus if r["name"] == args.name), None)
if row is None:
    parser.error("--name must identify a corpus.json row")
if not row["commit"]:
    parser.error("No recorded commit for this corpus")
out = fresh_out(args.out)
root = out / "repository"
root.mkdir()
def git(*argv):
    return subprocess.run(["git", "-C", str(root), *argv], check=True, capture_output=True, text=True).stdout.strip()
git("init", "-q")
git("remote", "add", "origin", row["url"])
# Fetch by object id so a moving default branch cannot select a different input.
git("fetch", "--quiet", "--depth", str(row["depth"]), "origin", row["commit"])
git("-c", "advice.detachedHead=false", "switch", "--detach", "FETCH_HEAD")
actual = git("rev-parse", "HEAD")
if actual != row["commit"]:
    raise RuntimeError("Fetched commit differs from corpus")
(out / "input.json").write_text(json.dumps({**row, "actualCommit": actual, "reachableCommits": int(git("rev-list", "--count", "HEAD"))}, indent=2) + "\n")
print(json.dumps({"name": row["name"], "commit": actual}))
