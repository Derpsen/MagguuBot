#!/usr/bin/env python3
"""magguu-drift.py - shared Magguu product-drift guard (MagguuUI / MagguuUI-Website / MagguuBot).

Stdlib only, no network, read-only, ~0.3 s. Run from the repo root:

    python3 tools/magguu-drift.py [--repo mui|website|bot|auto] [--allow tools/drift-allow.txt] [-v]

Exit 0 = clean (WARN lines never fail), 1 = at least one ERROR, 2 = usage/config error.
Output: `file:line: [ERROR|WARN] check: message`  (GitHub annotation form with --gha).

Checks
  forbidden  WIM / WindTools / KeystoneLoot / EXBoss name-split.
             PUBLIC files (docs, site, FAQ/embeds, shipped addon files, content seeds): zero tolerance,
             only an explicit allow-list entry passes.
             INTERNAL files (AGENTS.md, ...): allowed when the line (+/- 1 line) is a negation/history
             statement ("WIM is retired", "No WindTools", dated history line).
             SKIPPED: CHANGELOG*, MEMORY.md, lockfiles, binaries, tests/**, spec/**, tools/** (they implement the ban).
  packs      WowUp starter/optional lists in docs must equal/contain the expected sets; in MagguuUI the
             base64 collection strings in MagguuUI_Data/AddOns/WowUp.lua are decoded and compared.
  button     only 'Apply Magguu profiles' (deDE 'Magguu-Profile übernehmen'); legacy/wrong-case labels flagged;
             MagguuUI: enUS INSTALL_ALL label + `function MUE:InstallAll` must exist, no InstallAll4K function.
  engines    package.json engines.node == expected per repo (Bot >=26, Website >=26.12.0); Dockerfile/CI Node major.
  toc        MagguuUI*.toc: four sibling addons, X-EllesmereUI-Min-Version >= 9.0.6, docs 'EllesmereUI x.y.z+' >= min.
  locked     typescript <7, h3 <2, js-yaml <5, satori <0.48, @types/node <26 (package.json + lockfile).
  container  final USER 99 or PUID=99 drop; docker.yml has cosign sign (keyless: no --key).

Allow file (tools/drift-allow.txt, backwards compatible with the Website file):
    <glob>[TAB<line-regex>]      # comment lines start with '#'
  a bare glob allows the whole file, glob+regex only the matching lines. Keep entries narrow.
"""
import argparse, base64, fnmatch, json, os, re, subprocess, sys

MIN_EUI = "9.0.6"
STARTER = ["ellesmereui", "magguuui", "bigwigs", "littlewigs", "northernsky", "exboss", "excore"]
OPT_REQUIRED = ["auctionator", "smartreminders", "handynotesmapnotes", "whispermessenger"]
OPT_KNOWN = OPT_REQUIRED + ["buggrabber", "bugsack", "handynotes", "mdt", "mythicdungeontools", "raiderio",
                            "simulationcraft", "talenttreetweaks", "waypointui", "gtfo", "premadegroupsfilter"]
LOCKED = {  # name: (max exclusive major, optional minor limit)  -> must stay BELOW
    "typescript": (7, None), "h3": (2, None), "js-yaml": (5, None),
    "satori": (0, 48), "@types/node": (26, None),
}
REPOS = {
    "mui": dict(engines=None, docker=False,
                public=["README*.md", "docs/**", "*.lua", "*.toc", "*.xml"]),
    "website": dict(engines=">=26.12", docker=True,
                    public=["pages/**", "components/**", "layouts/**", "composables/**", "docs/**", "README*.md",
                            "utils/pageCopyDefaults.ts", "server/database/default*.ts", "server/plugins/init.ts",
                            "public/**/*.md", "public/**/*.txt", "public/**/*.json", "public/**/*.html"]),
    "bot": dict(engines=">=26", docker=True,
                public=["README*.md", "docs/**", "src/embeds/**", "src/**/faq*", "src/**/cards*", "frontend/**"]),
}
SKIP = ["CHANGELOG*", "*/CHANGELOG*", "MEMORY.md", "*/MEMORY.md", "package-lock.json", "tests/**", "spec/**",
        "tools/**", "**/*.test.*", ".github/docs-drift-rules.txt", "**/drift-allow.txt", "*.webp", "*.png", "*.jpg",
        "*.jpeg", "*.gif", "*.svg", "*.ico", "*.ttf", "*.otf", "*.woff", "*.woff2", "*.zip", "*.tga", "*.blp",
        "*.ogg", "*.mp3", "*.pdf", "_incoming/**", "node_modules/**", ".git/**"]
BAN = re.compile(r"\bWIM\b|\bWind[ _-]?Tools\b|\bKeystone[ _-]?Loot\b", re.I)
SPLIT = re.compile(r"EXBoss[\s_-]*(?:name[\s_-]*)?split|split[\s_-]*names?[^.\n]{0,40}EXBoss|EXBoss[^.\n]{0,40}split[\s_-]*names?", re.I)
NEG = re.compile(r"retired|removed|no longer|never|\bno\b|\bnot\b|nicht|\bkein|\bban(ned)?\b|\bblocks?\b|cannot|forbidden|"
                 r"skipp?ed|ignored|ersetzt|replaced|\bdrop|scrub|do not|don't|history|formerly|legacy|\(was |"
                 r"20\d\d-\d\d-\d\d|\bex-|renamed|superseded", re.I)
LEGACY_BTN = re.compile(r"Install [Ee]verything|Install All(?:4K)?\b|Alles installieren|InstallAll4K|Apply Magguu Profiles|"
                        r"Apply Magguu profile\b|Magguu-Profile (?:anwenden|installieren|importieren)")

findings = []
def add(f, ln, sev, chk, msg):
    findings.append((f, ln, sev, chk, msg))

def sh(*a):
    try:
        return subprocess.run(a, capture_output=True, text=True, check=True).stdout
    except Exception:
        return None

def tracked():
    out = sh("git", "ls-files")
    if out is not None:
        return [l for l in out.splitlines() if l]
    res = []
    for d, ds, fs in os.walk("."):
        ds[:] = [x for x in ds if x not in (".git", "node_modules")]
        res += [os.path.relpath(os.path.join(d, f), ".") for f in fs]
    return res

def gm(path, pats):
    return any(fnmatch.fnmatchcase(path, p) or fnmatch.fnmatchcase(os.path.basename(path), p) for p in pats) \
        or any(p.endswith("/**") and path.startswith(p[:-2]) for p in pats)

def read(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read().split("\n")
    except Exception:
        return None

def vkey(v):
    return tuple(int(x) for x in re.findall(r"\d+", v)[:3]) + (0,) * (3 - len(re.findall(r"\d+", v)[:3]))

def detect():
    pj = read("package.json")
    if pj:
        name = (json.loads("\n".join(pj)).get("name") or "").lower()
        if "website" in name: return "website"
        if "bot" in name: return "bot"
    if os.path.exists("MagguuUI.toc"): return "mui"
    sys.exit("magguu-drift: cannot detect repo, pass --repo")

def load_allow(path):
    rules = []
    for l in (read(path) or []):
        l = l.rstrip("\r")
        if not l.strip() or l.lstrip().startswith("#"): continue
        g, _, rx = l.partition("\t")
        rules.append((g.strip(), re.compile(rx.strip().split("  #")[0]) if rx.strip() else None))
    return rules

RULES = []
def allowed(path, text, rules=None):
    rules = RULES if rules is None else rules
    return any(fnmatch.fnmatchcase(path, g) and (rx is None or rx.search(text)) for g, rx in rules)

# ---------------------------------------------------------------- forbidden
def check_forbidden(files, cfg, rules):
    for f in files:
        if gm(f, SKIP): continue
        lines = read(f)
        if lines is None: continue
        public = gm(f, cfg["public"])
        for i, line in enumerate(lines):
            for rx, label in ((BAN, "WIM/WindTools/KeystoneLoot"), (SPLIT, "EXBoss name-split")):
                if not rx.search(line): continue
                if allowed(f, line, rules): continue
                if not public:
                    ctx = " ".join(lines[max(0, i - 1):i + 2])
                    if NEG.search(ctx): continue
                add(f, i + 1, "ERROR", "forbidden",
                    f"{label} in {'public' if public else 'internal'} file without allow-list/negation: {line.strip()[:90]}")

# ---------------------------------------------------------------- packs
def canon(item):
    s = re.sub(r"\(.*?\)", "", item).lower()
    s = re.sub(r"[^a-z0-9]", "", s)
    s = s.replace("boss timers tools", "")
    for pre, c in (("northernsky", "northernsky"), ("bigwigs", "bigwigs"), ("exboss", "exboss"), ("excore", "excore"),
                   ("mythicdungeontools", "mdt"), ("raiderio", "raiderio"), ("handynotesmapnotes", "handynotesmapnotes"),
                   ("naowhsmartreminders", "smartreminders"), ("whispermessenger", "whispermessenger")):
        if s.startswith(pre): return c
    return s

def items(seg):
    seg = re.sub(r"[*`]", "", seg)
    seg = re.sub(r"\band\b", ",", seg)
    return [x.strip(" .") for x in seg.split(",") if x.strip(" .")]

MARK = re.compile(r"\b(starter|optional)(?: pack)?\s*\**:\**\s*", re.I)
def check_packs(files, cfg):
    for f in files:
        if gm(f, SKIP) or not re.search(r"\.(md|ts|vue|lua|txt)$", f) or f.startswith("MagguuUI_Data/AddOns/"): continue
        lines = read(f)
        if lines is None: continue
        text = "\n".join(lines)
        for m in MARK.finditer(text):
            seg = text[m.end():m.end() + 700]
            seg = re.split(r"\.(?=\s|\*|$)|\n\s*\n|\n\s*[-*#]|\\n|[`'\"]|\*\*\s*(?:Optional|Starter)|;", seg, maxsplit=1)[0]
            seg = re.sub(r"\s+", " ", seg)
            if re.search(r"other extras|and more|etc\b|\u2026|\.\.\.", seg, re.I): continue  # partial list
            its = items(seg)
            kind = m.group(1).lower()
            ln = text.count("\n", 0, m.start()) + 1
            if kind == "starter" and len(its) >= 4:
                got = [canon(x) for x in its]
                if sorted(got) != sorted(STARTER) and not allowed(f, text.split("\n")[ln - 1]):
                    add(f, ln, "ERROR", "packs", f"starter list {sorted(set(got) ^ set(STARTER))} differs from expected {', '.join(STARTER)}")
            elif kind == "optional" and len(its) >= 6:
                got = {canon(x) for x in its}
                miss = [x for x in OPT_REQUIRED if x not in got]
                if miss: add(f, ln, "ERROR", "packs", f"optional list lacks {miss}")
                unk = sorted(x for x in got if x not in OPT_KNOWN)
                if unk: add(f, ln, "WARN", "packs", f"optional list has unknown members {unk}")

def check_wowup_lua():
    f = "MagguuUI_Data/AddOns/WowUp.lua"
    lines = read(f)
    if lines is None: return
    for i, l in enumerate(lines):
        m = re.match(r'\s*D\.WowUp(Required|Optional)\s*=\s*"([A-Za-z0-9+/=]+)"', l)
        if not m: continue
        try:
            names = [canon(a["name"]) for a in json.loads(base64.b64decode(m.group(2)))["addons"]]
        except Exception as e:
            add(f, i + 1, "ERROR", "packs", f"cannot decode WowUp{m.group(1)} string: {e}"); continue
        if m.group(1) == "Required":
            if sorted(names) != sorted(STARTER):
                add(f, i + 1, "ERROR", "packs", f"decoded starter pack {sorted(set(names) ^ set(STARTER))} differs from expected")
        else:
            miss = [x for x in OPT_REQUIRED if x not in names]
            if miss: add(f, i + 1, "ERROR", "packs", f"decoded optional pack lacks {miss}")
            bad = [x for x in names if BAN.search(x) or x in ("wim", "windtools", "keystoneloot")]
            if bad: add(f, i + 1, "ERROR", "packs", f"decoded optional pack contains banned addon {bad}")

# ---------------------------------------------------------------- button
def check_button(files, repo):
    for f in files:
        if gm(f, SKIP) or f.startswith("MagguuUI_Data/AddOns/"): continue
        if not re.search(r"\.(md|ts|vue|lua|txt|json|html)$", f): continue
        lines = read(f)
        if lines is None: continue
        for i, l in enumerate(lines):
            if LEGACY_BTN.search(l) and not NEG.search(l) and not allowed(f, l):
                sev = "WARN" if re.match(r"\s*(--|//|\*|/\*|#)", l) else "ERROR"
                add(f, i + 1, sev, "button", f"legacy/wrong button label (expected 'Apply Magguu profiles'): {l.strip()[:90]}")
    if repo == "mui":
        loc = read("MagguuUI_EUI/Locales/enUS.lua") or []
        hit = [(i + 1, l) for i, l in enumerate(loc) if re.match(r"\s*INSTALL_ALL\s*=", l)]
        if not hit or '"Apply Magguu profiles"' not in hit[0][1]:
            add("MagguuUI_EUI/Locales/enUS.lua", hit[0][0] if hit else 1, "ERROR", "button", "INSTALL_ALL must be exactly 'Apply Magguu profiles'")
        setup = "\n".join(read("MagguuUI_Data/Profiles/Setup.lua") or [])
        if "function MUE:InstallAll(" not in setup:
            add("MagguuUI_Data/Profiles/Setup.lua", 1, "ERROR", "button", "function MUE:InstallAll missing")
        for f in files:
            if f.endswith(".lua") and not gm(f, SKIP):
                for i, l in enumerate(read(f) or []):
                    if re.search(r"function\s+\w+[:.]InstallAll4K", l):
                        add(f, i + 1, "ERROR", "button", "InstallAll4K function must not exist (single InstallAll)")
    else:
        pub = [f for f in files if gm(f, REPOS[repo]["public"]) and not gm(f, SKIP)]
        pat = re.compile(r"Apply Magguu profiles|Magguu-Profile übernehmen")
        if not any(pat.search(l) for f in pub for l in (read(f) or [])):
            add("(repo)", 0, "ERROR", "button", "no public file mentions 'Apply Magguu profiles' (or deDE 'Magguu-Profile übernehmen')")

# ---------------------------------------------------------------- engines / toc / locked / container
def check_engines(repo, cfg):
    pj = read("package.json")
    if pj and cfg["engines"]:
        d = json.loads("\n".join(pj))
        eng = (d.get("engines") or {}).get("node", "")
        norm = lambda s: re.sub(r"(\.0)+$", "", s.replace(" ", ""))
        ln = next((i + 1 for i, l in enumerate(pj) if '"node"' in l), 1)
        if norm(eng) != norm(cfg["engines"]):
            add("package.json", ln, "ERROR", "engines", f"engines.node is '{eng or '<missing>'}', expected '{cfg['engines']}'")
        emaj = int(re.search(r"\d+", cfg["engines"]).group())
        dk = read("Dockerfile") or []
        for i, l in enumerate(dk):
            m = re.match(r"\s*ARG NODE_VERSION=(\d+)", l)
            if m and int(m.group(1)) < emaj:
                add("Dockerfile", i + 1, "ERROR", "engines", f"NODE_VERSION {m.group(1)} < engines major {emaj}")
        for wf in sorted(x for x in tracked() if x.startswith(".github/workflows/") and x.endswith(".yml")):
            for i, l in enumerate(read(wf) or []):
                m = re.match(r"\s*node-version:\s*['\"]?(\d+)", l)
                if m and int(m.group(1)) < emaj:
                    add(wf, i + 1, "WARN", "engines", f"CI node-version {m.group(1)} < engines major {emaj} (matrix test of older Node?)")

def check_toc(files, repo):
    if repo != "mui": return
    tocs = [f for f in files if f.endswith(".toc")]
    for want in ("MagguuUI.toc", "MagguuUI_Data/MagguuUI_Data.toc", "MagguuUI_EUI/MagguuUI_EUI.toc", "MagguuUI_Media/MagguuUI_Media.toc"):
        if want not in tocs: add(want, 0, "ERROR", "toc", "sibling addon TOC missing (expected 4 addons)")
    tocmin = None
    for t in tocs:
        lines = read(t) or []
        txt = "\n".join(lines)
        m = re.search(r"^## *X-EllesmereUI-Min-Version:\s*(\S+)", txt, re.M | re.I)
        if m:
            tocmin = m.group(1)
            ln = txt[:m.start()].count("\n") + 1
            if vkey(tocmin) < vkey(MIN_EUI): add(t, ln, "ERROR", "toc", f"EllesmereUI min {tocmin} < {MIN_EUI}")
        elif t == "MagguuUI.toc" and "EllesmereUI" in txt:
            add(t, 1, "ERROR", "toc", f"no X-EllesmereUI-Min-Version (need >= {MIN_EUI})")
    for i, l in enumerate(read("Core.lua") or []):
        m = re.search(r'or "(\d+\.\d+\.\d+)"', l)
        if m and "fromToc" in l and vkey(m.group(1)) < vkey(MIN_EUI):
            add("Core.lua", i + 1, "ERROR", "toc", f"Lua fallback min {m.group(1)} < {MIN_EUI}")

def check_doc_versions(files, cfg, rules):
    rx = re.compile(r"EllesmereUI (?:min(?:imum)?\.? )?v?(\d+\.\d+\.\d+)(?:\+| or newer| or higher)")
    for f in files:
        if gm(f, SKIP) or not re.search(r"\.(md|ts|vue|lua|txt)$", f) or not gm(f, cfg["public"] + ["AGENTS.md"]): continue
        for i, l in enumerate(read(f) or []):
            for m in rx.finditer(l):
                if vkey(m.group(1)) < vkey(MIN_EUI) and not allowed(f, l, rules):
                    add(f, i + 1, "ERROR", "toc", f"docs say EllesmereUI {m.group(1)}+ but min is {MIN_EUI}")

def check_locked():
    pj = read("package.json")
    if not pj: return
    d = json.loads("\n".join(pj))
    cur = {}
    for sec in ("dependencies", "devDependencies", "overrides", "optionalDependencies"):
        for k, v in (d.get(sec) or {}).items():
            if isinstance(v, str): cur[k] = (f"package.json[{sec}]", v)
    lock = read("package-lock.json")
    if lock:
        for path, e in json.loads("\n".join(lock)).get("packages", {}).items():
            k = path.rsplit("node_modules/", 1)[-1]
            if k in LOCKED and e.get("version"): cur[f"{k}@lock:{path}"] = ("package-lock.json", e["version"])
    for key, (src, v) in cur.items():
        k = key.split("@lock:")[0] if "@lock:" in key else key
        if k not in LOCKED: continue
        mj, mn = LOCKED[k]
        nums = re.findall(r"\d+", v)
        if not nums: continue
        major, minor = int(nums[0]), int(nums[1]) if len(nums) > 1 else 0
        bad = (major > mj or (major == mj and minor >= mn)) if mn else major >= mj
        if bad:
            direct = "@lock:" not in key
            add(src, 1, "ERROR" if direct else "WARN", "locked",
                f"{k} {v} violates lock (must stay below {mj}{'.' + str(mn) if mn else ''})" + ("" if direct else f" [transitive: {key.split('@lock:')[1]}]"))

def check_container(files, cfg):
    if not cfg["docker"] or not os.path.exists("Dockerfile"): return
    dk = read("Dockerfile")
    users = [(i + 1, l.split()[1]) for i, l in enumerate(dk) if re.match(r"\s*USER\s+\S+", l)]
    if users:
        if not re.match(r"99(:\S+)?$", users[-1][1]): add("Dockerfile", users[-1][0], "ERROR", "container", f"final USER is '{users[-1][1]}', expected 99")
    elif not any(re.search(r"PUID[=:-]+99(\D|$)", l) for l in dk):
        add("Dockerfile", 1, "ERROR", "container", "no USER 99 and no PUID=99 privilege drop")
    wf = ".github/workflows/docker.yml"
    t = read(wf)
    if t:
        sign = [(i + 1, l) for i, l in enumerate(t) if re.search(r"\bcosign sign\b", l)]
        if not sign: add(wf, 1, "ERROR", "container", "no 'cosign sign' step (Cosign keyless required)")
        for ln, l in sign:
            if re.search(r"--key\b", l): add(wf, ln, "ERROR", "container", "cosign sign uses --key (must be keyless)")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="auto", choices=["auto", "mui", "website", "bot"])
    ap.add_argument("--allow", default="tools/drift-allow.txt")
    ap.add_argument("--gha", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    repo = detect() if a.repo == "auto" else a.repo
    cfg = REPOS[repo]
    files = tracked()
    rules = load_allow(a.allow)
    RULES[:] = rules
    check_forbidden(files, cfg, rules)
    check_packs(files, cfg)
    if repo == "mui": check_wowup_lua()
    check_button(files, repo)
    check_engines(repo, cfg)
    check_toc(files, repo)
    check_doc_versions(files, cfg, rules)
    check_locked()
    check_container(files, cfg)
    errs = 0
    for f, ln, sev, chk, msg in sorted(findings, key=lambda x: (x[2] != "ERROR", x[0], x[1])):
        errs += sev == "ERROR"
        if a.gha:
            print(f"::{'error' if sev == 'ERROR' else 'warning'} file={f},line={ln},title=drift/{chk}::{msg}")
        else:
            print(f"{f}:{ln}: [{sev}] {chk}: {msg}")
    if a.verbose or not findings:
        print(f"magguu-drift[{repo}]: {errs} error(s), {len(findings) - errs} warning(s), {len(files)} tracked files")
    sys.exit(1 if errs else 0)

if __name__ == "__main__":
    main()
