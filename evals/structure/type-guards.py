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
import ast
import collections
import gzip

parser = argparse.ArgumentParser()
parser.add_argument("--project", required=True)
parser.add_argument("--report", required=True, help="CLI data/report.json")
parser.add_argument("--out", required=True)
parser.add_argument("--imports", required=True, help="imports.ndjson.gz from run.ts")
args = parser.parse_args()
output = fresh_out(args.out, [args.project])
project = Path(args.project).resolve()
rows=[json.loads(s) for s in gzip.open(args.imports,"rt").read().splitlines()];guarded=[]
for file in sorted({r["path"] for r in rows}):
 t=ast.parse((project/file).read_text());ranges=[]
 for n in ast.walk(t):
  if isinstance(n,ast.If) and ast.unparse(n.test) in ["TYPE_CHECKING","typing.TYPE_CHECKING"]:
   for item in n.body:ranges.append((item.lineno,item.end_lineno))
 for row in rows:
  if row["path"]==file and row["status"]=="internal" and any(a<=row["line"]+1<=b for a,b in ranges):guarded.append(row)
r=json.loads(Path(args.report).read_text());pairs=collections.defaultdict(list)
for row in rows:
 if row["status"]=="internal" and row["path"]!=row["to"]:pairs[(row["path"],row["to"])].append(row)
remove=[k for k,v in pairs.items() if all(x in guarded for x in v)];out={"guardedImports":len(guarded),"guardedOnlyPairs":len(remove),"pairs":remove,"originalCycles":[[r["files"][i]["path"] for i in c["files"]] for c in r["graph"]["cycles"]]}
# Independent iterative reachability identifies SCC membership for this small graph.
edges=set(pairs)-set(remove);nodes={x for pair in edges for x in pair};adj=collections.defaultdict(set)
for a,b in edges:adj[a].add(b)
def reach(a):
 seen=set();todo=[a]
 while todo:
  n=todo.pop()
  for b in adj[n]:
   if b not in seen:seen.add(b);todo.append(b)
 return seen
reaches={n:reach(n) for n in nodes};seen=set();cycles=[]
for a in sorted(nodes):
 if a in seen:continue
 comp={b for b in reaches[a] if a in reaches.get(b,set())}
 if len(comp)>1:seen|=comp;cycles.append(sorted(comp))
out["runtimeCyclesAfterGuardRemoval"]=cycles
(output/"python-type-guards.json").write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
