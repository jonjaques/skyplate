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

parser = argparse.ArgumentParser(description="Build and analyze hand-counted history fixtures")
parser.add_argument("--out", required=True)
args = parser.parse_args()
out = fresh_out(args.out)
env_base = os.environ | {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}

root = out / "history"
root.mkdir()
def git(*args,env=None):return subprocess.run(["git","-C",str(root),*args],env=env or env_base,capture_output=True,text=True,check=True).stdout
n=0
def commit(name,email,msg):
 global n
 n+=1;env=env_base|{"GIT_AUTHOR_NAME":name,"GIT_AUTHOR_EMAIL":email,"GIT_COMMITTER_NAME":name,"GIT_COMMITTER_EMAIL":email,"GIT_AUTHOR_DATE":f"2024-01-{n:02}T12:00:00Z","GIT_COMMITTER_DATE":f"2024-01-{n:02}T12:00:00Z"}
 git("add",".");git("-c","commit.gpgsign=false","commit","--allow-empty","-qm",msg,env=env)
git("init","-q","-b","main")
for name in ["a.py","b.py","c.py","d.py"]:(root/name).write_text("def run(x):\n    if x:\n        return 1\n    return 0\n")
commit("Alice Example","alice@example.test","initial")
for i in range(3):
 for name in ["a.py","b.py"]:
  with (root/name).open("a") as f:f.write(f"# feature {i}\n")
 commit("Alice Example","alice@example.test",f"feature {i}")
for i in range(3):
 with (root/"c.py").open("a") as f:f.write(f"# feature {i}\n")
 commit("Bob Example","bob@example.test",f"c feature {i}")
git("mv","a.py","renamed.py");commit("Alice Example","alice@example.test","rename")
for name in ["renamed.py","b.py"]:(root/name).write_text((root/name).read_text().replace("    ","  "))
commit("Formatter Bot","format[bot]@example.test","format only")
(root/"d.py").write_text((root/"d.py").read_text()+"# bot change\n");commit("Formatter Bot","format[bot]@example.test","bot touch")
commit("Alice Example","alice+other@example.test","identity split test")
commit("Bob Example","bob@example.test","empty squash-style commit")
(out/"history-ground-truth.txt").write_text(git("log","--reverse","--format=%s","--numstat","-M")+"\n"+git("log","--follow","--format=%s","--","renamed.py"))



root = out / "rename-history"
root.mkdir()
def git(*args,env=None):return subprocess.run(["git","-C",str(root),*args],env=env or env_base,capture_output=True,text=True,check=True).stdout
n=0
def commit(msg):
 global n
 n+=1;env=env_base|{"GIT_AUTHOR_NAME":"Move Example","GIT_AUTHOR_EMAIL":"move@example.test","GIT_COMMITTER_NAME":"Move Example","GIT_COMMITTER_EMAIL":"move@example.test","GIT_AUTHOR_DATE":f"2024-02-{n:02}T12:00:00Z","GIT_COMMITTER_DATE":f"2024-02-{n:02}T12:00:00Z"}
 git("add",".");git("-c","commit.gpgsign=false","commit","--allow-empty","-qm",msg,env=env)
git("init","-q","-b","main");(root/"v0").mkdir()
for i in range(12):(root/"v0"/f"f{i}.py").write_text(f"# file {i}\ndef f(x):\n    if x: return {i}\n")
commit("initial")
for i in range(3):git("mv",f"v{i}",f"v{i+1}");commit("directory rename only")
for i in range(6):commit("empty")
(out/"rename-ground-truth.txt").write_text(git("log","--format=%s","--numstat","-M"))


results = {}
for name in ["history", "rename-history"]:
    root = out / name
    subprocess.run(["bun", str(Path(__file__).parent / "history.ts"), "--project", str(root), "--out", str(out / (name + "-analysis"))], check=True, env=env_base)
    result = json.loads((out / (name + "-analysis") / "history.json").read_text())
    results[name] = result
normal = results["history"]
expected = {"renamed.py": (6, 10, 3, 1.0), "b.py": (5, 10, 3, 0.9208), "c.py": (4, 7, 0, 0.8271), "d.py": (2, 5, 0, 0.5646)}
checks = {}
shares = {"renamed.py": 0.7, "b.py": 0.7, "c.py": 0.5714, "d.py": 0.8}
for file in normal["files"]:
    commits, added, deleted, hotspot = expected[file["path"]]
    actual = file["git"]
    checks[file["path"]] = actual["commits"] == commits and actual["added"] == added and actual["deleted"] == deleted and file["hotspot"] == hotspot
    owner = normal["git"]["authors"][actual["owner"]]
    checks[file["path"] + "-ownership"] = owner["name"] == "Alice Example" and actual["ownership"] == shares[file["path"]]
paths = [f["path"] for f in normal["files"]]
checks["coupling"] = len(normal["git"]["coupling"]) == 1 and all({paths[p["a"]], paths[p["b"]]} == {"b.py", "renamed.py"} and p["shared"] == 5 and p["degree"] == 1 for p in normal["git"]["coupling"])
checks["truckFactor"] = normal["git"]["truckFactor"]["value"] == 1
checks["identityFusion"] = len(normal["git"]["authors"]) == 3
rename = results["rename-history"]
checks["renamePairs"] = len(rename["git"]["coupling"]) == 66
checks["renameShared"] = all(p["shared"] == 4 and p["degree"] == 1 for p in rename["git"]["coupling"])
checks["renameHotspots"] = all(f["hotspot"] == 1 for f in rename["files"])
(out / "checks.json").write_text(json.dumps(checks, indent=2) + "\n")
print(json.dumps(checks))
if not all(checks.values()):
    raise RuntimeError("History arithmetic changed; compare retained output before updating expectations")
