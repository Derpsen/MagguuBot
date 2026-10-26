#!/usr/bin/env python3
"""docs-sync.py - docs vs. repo reality (stdlib only, no network, read-only). Run from the repo root.

    python3 tools/docs-sync.py [--root DIR] [--docs README.md AGENTS.md ...] [--config .github/docs-sync.txt]

Exit 0 = clean, 1 = at least one finding (printed as `file:line: [check] message`), 2 = usage/config error.
The same file is used in every Magguu repo; each check silently skips when the repo has no matching source.

Checks
  paths    backticked repo paths in the docs (`tools/x.sh`, `docs/y.md`, `package.json`) must exist.
  npm      `npm run <script>` in the docs must be a script in package.json (builtin npm commands are fine).
  env      (only with .env.example) a) every variable in .env.example is used in the code/container files,
           b) every `Type="Variable"` Target in unraid/*.xml is documented in .env.example,
           c) every key of the zod schema in src/config.ts is documented in .env.example (INTERNAL_ENV below
              or an allow entry excepts),
           d) backticked UPPER_SNAKE tokens in the docs must exist somewhere in the repo's code/config files.
Lines that are explicitly history (dated prefix, formerly/renamed/removed/..., see HISTORY) are skipped.
Config file (.github/docs-sync.txt): `@docs <file> [<file> ...]` = docs to check (default README.md AGENTS.md;
--docs overrides), every other non-comment line is an allow ERE (matched against the token, `file:token` or `npm:<script>`).
`#` starts a comment line. Document each allow entry with a comment above it.
Delimitation: tools/docs-drift.sh = stale WORDS in prose (rules file); validate.py / magguu-drift.py /
drift-check.sh = structure of code/manifests. This script only compares docs <-> files/env/scripts.
"""
import argparse, json, os, re, subprocess, sys

HISTORY = re.compile(r"\(20\d\d-\d\d-\d\d[:)]|[Ff]ormer(ly)?|[Oo]ld names?|[Rr]enamed|[Ss]uperseded|[Hh]istor(y|ical)|"
                     r"\(was |\b(has|have) no\b|\bkein|[Rr]emoved|[Dd]eleted|gelöscht|entfernt|[Rr]etired|no longer|nicht mehr|\bex-|\bnever\b")
NPM_BUILTIN = {"test", "start", "stop", "restart", "ci", "install", "i", "init", "audit", "outdated", "ls", "run",
               "update", "version", "pack", "publish", "exec", "view", "help", "config", "cache", "prune", "dedupe"}
# Variables the code reads but that are intentionally not user config (build/CI/test plumbing).
INTERNAL_ENV = {"NODE_ENV", "GIT_SHA", "MAGGUU_BUILD_DATE", "MAGGUU_BUILD_SHA", "SOURCE_COMMIT", "DELETE_APPROVED"}
SKIP_PATH_ROOTS = ("node_modules", "dist", "dist-frontend", "data", "coverage", ".cache")
CODE_DIRS = ("src", "scripts", "tools", "frontend", ".github", "unraid", "dashboard", "packages")
CODE_FILES = ("Dockerfile", "docker-entrypoint.sh", "package.json", "install.sh", "update.sh", "update-ha.sh",
              "drizzle.config.ts", "vite.config.ts")


def repo_files(root):
    try:
        out = subprocess.run(["git", "-C", root, "ls-files", "-co", "--exclude-standard"], capture_output=True, text=True, check=True).stdout
        files = [f for f in out.splitlines() if f]
        if files:
            return files
    except (OSError, subprocess.CalledProcessError):
        pass
    res = []
    for d, dn, fn in os.walk(root):
        dn[:] = [x for x in dn if x not in (".git", "node_modules")]
        res += [os.path.relpath(os.path.join(d, f), root) for f in fn]
    return res


def read(root, rel):
    try:
        with open(os.path.join(root, rel), encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--docs", nargs="*", default=None)
    ap.add_argument("--config", default=".github/docs-sync.txt")
    a = ap.parse_args()
    root = a.root
    files = repo_files(root)
    fileset = set(files)
    dirs = {os.path.dirname(f) for f in files}
    for f in list(dirs):
        while f:
            dirs.add(f); f = os.path.dirname(f)
    basenames = {os.path.basename(f) for f in files}
    allow = []
    cfg_docs = []
    txt = read(root, a.config)
    if txt:
        for ln in txt.splitlines():
            if ln.strip() and not ln.lstrip().startswith("#"):
                if ln.startswith("@docs "):
                    cfg_docs += ln[6:].split()
                    continue
                try:
                    allow.append(re.compile(ln.strip()))
                except re.error as e:
                    print(f"docs-sync: bad allow regex '{ln}': {e}", file=sys.stderr); return 2
    def allowed(*keys):
        return any(r.search(k) for r in allow for k in keys)

    findings = []
    def hit(f, ln, chk, msg):
        findings.append(f"{f}:{ln}: [{chk}] {msg}")

    wanted = a.docs if a.docs else (cfg_docs or ["README.md", "AGENTS.md"])
    docs = [d for d in wanted if d in fileset or os.path.isfile(os.path.join(root, d))]
    doctext = {d: read(root, d) or "" for d in docs}
    code_blob = ""
    for f in files:
        top = f.split("/")[0]
        if (top in CODE_DIRS or f in CODE_FILES) and not f.startswith("tests/") and f != a.config:
            t = read(root, f)
            if t and "\0" not in t[:2000]:
                code_blob += "\n" + t

    # ---- paths
    tick = re.compile(r"`([^`\n]+)`")
    path_ok = re.compile(r"^[A-Za-z0-9_.][A-Za-z0-9_./@-]*$")
    ext = re.compile(r"\.(md|sh|py|ts|vue|js|mjs|ya?ml|json|xml|txt|toml|lua|toc|sql|css)$")
    tops = {f.split("/")[0] for f in files}
    suffixes = set()
    for f in files:
        parts = f.split("/")
        for k in range(1, len(parts)):
            suffixes.add("/".join(parts[k:]))
    for dd in dirs:
        parts = dd.split("/")
        for k in range(1, len(parts)):
            suffixes.add("/".join(parts[k:]))
    n_paths = 0
    for d, text in doctext.items():
        for i, line in enumerate(text.splitlines(), 1):
            if HISTORY.search(line):
                continue
            for tok in tick.findall(line):
                tok = tok.strip().rstrip(",.;:")
                if tok.startswith("./"):
                    tok = tok[2:]
                if not path_ok.match(tok) or re.search(r"[*<>{}$]|://|^\.\./", tok):
                    continue
                t = tok.rstrip("/")
                has_ext = bool(ext.search(t))
                # A path needs an extension, or a first segment that is a real top-level entry of this repo.
                if not has_ext and ("/" not in t or t.split("/")[0] not in tops):
                    continue
                if t.split("/")[0] in SKIP_PATH_ROOTS:
                    continue
                n_paths += 1
                # Docs often use a shortened path (`server/app.ts` for src/server/app.ts): a path-suffix match counts.
                ok = t in fileset or t in dirs or ("/" not in t and t in basenames) or t in suffixes
                if not ok and not allowed(tok, f"{d}:{tok}"):
                    hit(d, i, "paths", f"`{tok}` does not exist in the repo")

    # ---- npm scripts
    pkg = read(root, "package.json")
    if pkg:
        try:
            scripts = set((json.loads(pkg).get("scripts") or {}).keys())
        except ValueError:
            print("docs-sync: package.json is not valid JSON", file=sys.stderr); return 2
        rx = re.compile(r"\bnpm (?:run(?:-script)? )?([a-z][a-z0-9:_-]*)")
        for d, text in doctext.items():
            for i, line in enumerate(text.splitlines(), 1):
                if HISTORY.search(line):
                    continue
                for m in rx.finditer(line):
                    nm = m.group(1)
                    pre = line[max(0, m.start() - 1):m.start()]
                    explicit_run = line[m.start():].startswith(("npm run ", "npm run-script "))
                    if nm in scripts or (nm in NPM_BUILTIN and not explicit_run) or allowed(f"npm:{nm}"):
                        continue
                    if not explicit_run and nm not in scripts:
                        continue  # prose like "npm audit", "npm ci" is not a script reference
                    hit(d, i, "npm", f"`npm run {nm}` is not a script in package.json")

    # ---- env
    envx_txt = read(root, ".env.example")
    if envx_txt is not None:
        envx = {}
        for i, line in enumerate(envx_txt.splitlines(), 1):
            m = re.match(r"^#?\s?([A-Z][A-Z0-9_]{2,})=", line)
            if m:
                envx.setdefault(m.group(1), i)
        for v, i in envx.items():
            if not re.search(r"\b" + v + r"\b", code_blob) and not allowed(v):
                hit(".env.example", i, "env", f"{v} is documented but not used by code/container files")
        for f in files:
            if f.startswith("unraid/") and f.endswith(".xml"):
                for i, line in enumerate((read(root, f) or "").splitlines(), 1):
                    m = re.search(r'Target="([A-Z][A-Z0-9_]+)"', line)
                    if m and 'Type="Variable"' in line and m.group(1) not in envx and not allowed(m.group(1)):
                        hit(f, i, "env", f"{m.group(1)} is set in the Unraid template but missing in .env.example")
        cfg = read(root, "src/config.ts")
        if cfg:
            for i, line in enumerate(cfg.splitlines(), 1):
                m = re.match(r"^\s{2}([A-Z][A-Z0-9_]+):\s*z\b", line) or re.match(r"^\s{2}([A-Z][A-Z0-9_]+):\s*(?:optional|env)\w*", line)
                if m and m.group(1) not in envx and m.group(1) not in INTERNAL_ENV and not allowed(m.group(1)):
                    hit("src/config.ts", i, "env", f"{m.group(1)} is read by the config schema but missing in .env.example")
        prefixes = {v.split("_")[0] for v in envx}
        known = set(envx) | set(re.findall(r"\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b", code_blob))
        for d, text in doctext.items():
            for i, line in enumerate(text.splitlines(), 1):
                if HISTORY.search(line):
                    continue
                for tok in tick.findall(line):
                    tok = tok.strip()
                    m = re.fullmatch(r"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?:=.*)?", tok)
                    if m and m.group(1).split("_")[0] in prefixes and m.group(1) not in known and not allowed(m.group(1), f"{d}:{m.group(1)}"):
                        hit(d, i, "env", f"`{m.group(1)}` is named in the docs but nowhere in code/config files")

    for f in findings:
        print(f)
    if findings:
        return 1
    print(f"docs-sync: OK ({len(docs)} docs, {n_paths} paths checked)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
