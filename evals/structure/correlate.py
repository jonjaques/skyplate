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
import math

parser = argparse.ArgumentParser()
parser.add_argument("--project", required=True)
parser.add_argument("--report", required=True, help="CLI data/report.json")
parser.add_argument("--out", required=True)
parser.add_argument("--radon", required=True, help="Radon cc --json output, absolute or repository-relative keys")
args = parser.parse_args()
out = fresh_out(args.out, [args.project])
project = Path(args.project).resolve()
r=json.loads(Path(args.report).read_text());raw=json.loads(Path(args.radon).read_text());rad={str(Path(k).relative_to(project)) if Path(k).is_absolute() else k:v for k,v in raw.items()};data=[]
for f in r["files"]:
 if f["language"]!="python":continue
 blocks=rad.get(f["path"],[])
 funcs={}
 def take(bs):
  for b in bs:
   if b["type"]=="class":take(b.get("methods",[]))
   else:
    funcs[(b["lineno"],b["col_offset"],b["name"])]=b
    take(b.get("closures",[]))
 take(blocks);ff=list(funcs.values())
 if ff:data.append({"path":f["path"],"category":f["category"],"sky":f["complexity"],"radonSum":sum(b["complexity"] for b in ff),"radonDecisionsPlusOne":1+sum(b["complexity"]-1 for b in ff),"functions":len(ff)})
def ranks(xs):
 idx=sorted(range(len(xs)),key=lambda i:xs[i]);out=[0.]*len(xs);i=0
 while i<len(xs):
  j=i+1
  while j<len(xs) and xs[idx[j]]==xs[idx[i]]:j+=1
  for k in range(i,j):out[idx[k]]=(i+j-1)/2+1
  i=j
 return out
def corr(a,b):
 a=ranks(a);b=ranks(b);ma=sum(a)/len(a);mb=sum(b)/len(b)
 return sum((x-ma)*(y-mb) for x,y in zip(a,b))/math.sqrt(sum((x-ma)**2 for x in a)*sum((y-mb)**2 for y in b))
res={}
for label,rows in [("all",data),("production",[x for x in data if x["category"]=="code"]),("tests",[x for x in data if x["category"]=="test"])]:
 res[label]={"files":len(rows),"rhoRadonSum":corr([x["sky"] for x in rows],[x["radonSum"] for x in rows]),"rhoDecisions":corr([x["sky"] for x in rows],[x["radonDecisionsPlusOne"] for x in rows])}
res["rows"]=data;(out/"complexity.json").write_text(json.dumps(res,indent=2));print(json.dumps({k:v for k,v in res.items() if k!="rows"}));print(sorted(data,key=lambda x:x["sky"],reverse=True)[:7])
