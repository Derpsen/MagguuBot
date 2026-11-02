#!/usr/bin/env node
// Daily upstream watch (read-only; reports, never bumps, never opens PRs or changes dependencies).
// Collects the conditions under which a Renovate lock could be lifted plus a few health signals, compares them
// with the previous state (Actions cache) and escalates ONLY when something changed (title "upstream-watch").
//
//   node tools/upstream-watch.mjs --mode watch    --state-in prev.json --state-out next.json [--event schedule] [--test] [--summary file]
//   node tools/upstream-watch.mjs --mode watchdog --state-in prev.json [--max-hours 26] [--summary file]
//
// watch:    first run without a previous state = baseline, no escalation. --test sends ONE payload titled "TEST"
//           (real current values, no state change). A failed POST keeps the previous values so the change is re-sent.
// watchdog: second daily cron; escalates when the last SCHEDULED watch run is older than --max-hours (GitHub delays
//           or drops schedule events silently). Same pattern as Derpsen/MagguuUI nightly.yml `watch-stale`.
// Env: GITHUB_TOKEN (read-only; missing rights -> "n/a"), ESCALATION_WEBHOOK_URL + ESCALATION_BEARER (both optional;
// without them nothing is sent). The URL and bearer are never printed. Exit 0 on success, 1 on usage errors.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

export const TITLE = 'upstream-watch';
export const REPOS = ['Derpsen/MagguuBot', 'Derpsen/Magguu-Dashboard', 'Derpsen/MagguuUI', 'Derpsen/MagguuUI-Website'];
const UA = 'magguu-upstream-watch';

// ---------------------------------------------------------------- minimal semver (enough for peer ranges)
export function parseVersion(v) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.\d+)?(?:-([0-9A-Za-z.-]+))?/.exec(String(v ?? '').trim());
  if (!m) return null;
  return { major: +m[1], minor: +(m[2] ?? 0), patch: +(m[3] ?? 0), pre: m[4] ?? null };
}
const cmp = (a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch;

function comparatorOk(comp, v) {
  const m = /^(>=|<=|>|<|=|\^|~)?\s*v?([\dxX*]+(?:\.[\dxX*]+){0,2})(-[0-9A-Za-z.-]+)?$/.exec(comp);
  if (!m) return false;
  const op = m[1] ?? '';
  const parts = m[2].split('.');
  const wild = parts.findIndex((p) => /^[xX*]$/.test(p));
  const nums = parts.map((p) => (/^[xX*]$/.test(p) ? 0 : +p));
  const b = { major: nums[0] ?? 0, minor: nums[1] ?? 0, patch: nums[2] ?? 0 };
  const given = wild === -1 ? parts.length : wild; // how many parts are fixed
  const upper = (level) => (level === 0 ? { major: b.major + 1, minor: 0, patch: 0 } : level === 1 ? { major: b.major, minor: b.minor + 1, patch: 0 } : { major: b.major, minor: b.minor, patch: b.patch + 1 });
  if (op === '^') {
    const lvl = b.major > 0 || given === 1 ? 0 : b.minor > 0 || given === 2 ? 1 : 2;
    return cmp(v, b) >= 0 && cmp(v, upper(lvl)) < 0;
  }
  if (op === '~') return cmp(v, b) >= 0 && cmp(v, upper(given >= 2 ? 1 : 0)) < 0;
  if (op === '' || op === '=') return given === 0 ? true : cmp(v, b) >= 0 && cmp(v, upper(Math.min(given, 3) - 1)) < 0;
  const c = cmp(v, b);
  return op === '>=' ? c >= 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c < 0;
}

/** true when `version` satisfies the npm range (||, space-separated AND, ^ ~ >= < x, hyphen ranges). */
export function satisfies(range, version) {
  const v = typeof version === 'string' ? parseVersion(version) : version;
  if (!v) return false;
  const r = String(range ?? '').trim();
  if (r === '' || r === '*' || r === 'latest') return true;
  return r.split('||').some((alt) => {
    const a = alt.trim().replace(/\s+-\s+/, ' - ');
    const hy = /^(\S+) - (\S+)$/.exec(a);
    const comps = hy ? [`>=${hy[1]}`, `<=${hy[2]}`] : a.replace(/(>=|<=|>|<|=)\s+/g, '$1').split(/\s+/).filter(Boolean);
    return comps.length > 0 && comps.every((c) => comparatorOk(c, v));
  });
}
const yesNo = (b) => (b ? 'ja' : 'nein');

// ---------------------------------------------------------------- pure evaluation
/** npm manifests (latest) + dist-tags -> signals {key: {value, met}} */
export function evaluateNpm(npm) {
  const s = {};
  const put = (key, value, met = null) => { s[key] = { value, met }; };
  const te = npm['typescript-eslint'];
  if (te) { const r = te.latest?.peerDependencies?.typescript ?? ''; put('lock.ts7.typescript-eslint', `${te.latest?.version}: peer typescript "${r}" -> TS 7 erlaubt: ${yesNo(satisfies(r, '7.0.0'))}`, satisfies(r, '7.0.0')); }
  const og = npm['nuxt-og-image'];
  if (og) { const r = og.latest?.peerDependencies?.satori ?? og.latest?.dependencies?.satori ?? ''; put('lock.satori.nuxt-og-image', `${og.latest?.version}: satori "${r}" -> >=0.48 erlaubt: ${yesNo(satisfies(r, '0.48.0'))}`, satisfies(r, '0.48.0')); }
  const nx = npm.nuxt;
  if (nx) { const v = parseVersion(nx.distTags?.latest); put('lock.nuxt5.nuxt', `latest ${nx.distTags?.latest} -> 5.x: ${yesNo(v && v.major >= 5)}`, Boolean(v && v.major >= 5)); }
  const ni = npm.nitro;
  if (ni) { const v = parseVersion(ni.distTags?.latest); const ok = Boolean(v && v.major >= 3 && !v.pre); put('lock.nitro3.nitro', `latest ${ni.distTags?.latest} -> stabil: ${yesNo(ok)}`, ok); }
  const dj = npm['discord.js'];
  if (dj) { const v = parseVersion(dj.distTags?.latest); put('lock.discordjs15.discord.js', `latest ${dj.distTags?.latest} -> 15: ${yesNo(v && v.major >= 15)}`, Boolean(v && v.major >= 15)); }
  const rest = npm['@discordjs/rest'];
  if (rest) { const r = rest.latest?.dependencies?.undici ?? ''; const ok = satisfies(r, '8.0.0') || satisfies(r, '8.99.0'); put('lock.undici8.@discordjs/rest', `${rest.latest?.version}: undici "${r}" -> 8 erlaubt: ${yesNo(ok)}`, ok); }
  const tn = npm['@types/node'];
  if (tn) { const v = parseVersion(tn.distTags?.latest); put('lock.typesnode27.@types/node', `latest major ${v?.major ?? '?'} -> 27: ${yesNo(v && v.major >= 27)}`, Boolean(v && v.major >= 27)); }
  return s;
}

/** nodejs.org/dist/index.json (newest first) -> newest LTS line and whether the newest release line is LTS. */
export function evaluateNode(index) {
  const lts = index.find((r) => r.lts);
  const newest = index[0];
  return {
    'node.lts': { value: lts ? `${lts.version} (${lts.lts})` : 'keine LTS', met: null },
    'node.newest-is-lts': { value: `${newest?.version}: ${newest?.lts ? `LTS ${newest.lts}` : 'kein LTS'}`, met: Boolean(newest?.lts) },
  };
}

export function evaluateReleases({ sonarrLatest, sonarrList, profilarrLatest }) {
  const s = {};
  if (sonarrLatest !== undefined) { const v = parseVersion(sonarrLatest); s['sonarr.latest-stable'] = { value: `${sonarrLatest} -> v5 stabil: ${yesNo(v && v.major >= 5)}`, met: Boolean(v && v.major >= 5) }; }
  if (sonarrList) s['sonarr.v5-prerelease'] = { value: sonarrList.some((r) => r.prerelease && parseVersion(r.tag_name)?.major >= 5) ? 'ja' : 'nein', met: null };
  if (profilarrLatest !== undefined) s['profilarr.latest'] = { value: String(profilarrLatest), met: null };
  return s;
}

/** Per repo: visibility, open Renovate PRs, red workflows on main, open alerts ("n/a" when not readable). */
export function evaluateRepo(repo, d) {
  const s = {};
  const k = (x) => `repo.${repo.split('/')[1]}.${x}`;
  if (!d.public) { s[k('visibility')] = { value: 'n/a (nicht öffentlich lesbar)', met: null }; return s; }
  s[k('visibility')] = { value: 'public', met: null };
  if (d.pulls) {
    const ren = d.pulls.filter((p) => /^renovate/i.test(p.user?.login ?? '')).sort((a, b) => a.number - b.number);
    s[k('renovate-prs')] = { value: ren.length ? ren.map((p) => `#${p.number} ${String(p.title).slice(0, 70)}`).join('; ') : 'keine', met: null };
  } else s[k('renovate-prs')] = { value: 'n/a', met: null };
  if (d.runs) {
    const latest = new Map();
    for (const r of d.runs) if (r.status === 'completed' && !latest.has(r.name)) latest.set(r.name, r.conclusion);
    const red = [...latest].filter(([, c]) => c === 'failure' || c === 'timed_out').map(([n]) => n).sort();
    s[k('ci-main')] = { value: red.length ? `rot: ${red.join(', ')}` : 'grün', met: red.length > 0 };
  } else s[k('ci-main')] = { value: 'n/a', met: null };
  for (const [name, list] of [['dependabot-alerts', d.dependabot], ['code-scanning-alerts', d.codeScanning]]) {
    s[k(name)] = { value: Array.isArray(list) ? `${list.length} offen` : 'n/a', met: Array.isArray(list) ? list.length > 0 : null };
  }
  return s;
}

/** [{key, from, to}] for keys whose value changed, appeared or disappeared. */
export function diffSignals(prev, cur) {
  const out = [];
  for (const key of [...new Set([...Object.keys(prev ?? {}), ...Object.keys(cur ?? {})])].sort()) {
    const a = prev?.[key]?.value ?? null; const b = cur?.[key]?.value ?? null;
    if (a !== b) out.push({ key, from: a, to: b });
  }
  return out;
}

/** Keeps the previous value for keys that could not be read this time (no "value -> n/a -> value" noise). */
export function mergeWithPrevious(prev, cur, failedKeys) {
  const out = { ...cur };
  for (const key of failedKeys) if (prev?.[key]) out[key] = prev[key];
  return out;
}

export const formatChange = (c) => `${c.key}: ${c.from ?? '(neu)'} -> ${c.to ?? '(weg)'}`;

export function buildPayload({ title = TITLE, repository, runUrl, changes, test = false, note }) {
  return {
    title,
    repository,
    run_url: runUrl,
    test,
    changes: changes.map(formatChange).slice(0, 30),
    ...(note ? { note } : {}),
  };
}

export function watchdog({ state, now, maxHours = 26 }) {
  const at = state?.lastScheduledAt ?? null;
  if (!at) return { stale: false, reason: 'kein geplanter Lauf im Zustand (Baseline fehlt)', ageHours: null };
  const ageHours = (now - Date.parse(at)) / 3600000;
  return { stale: ageHours > maxHours, ageHours, lastScheduledAt: at, reason: `letzter geplanter Watch-Lauf ${at} (${ageHours.toFixed(1)} h her, Limit ${maxHours} h)` };
}

export function idempotencyKey(payload) {
  return createHash('sha256').update(JSON.stringify([payload.repository, payload.title, payload.changes, payload.test])).digest('hex');
}

// ---------------------------------------------------------------- I/O
async function getJson(url, { token, accept = 'application/json', fetchImpl = fetch } = {}) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetchImpl(url, { headers: { accept, 'user-agent': UA, ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(20000) });
      if (res.status === 403 || res.status === 404 || res.status === 401) return { ok: false, status: res.status };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true, json: await res.json() };
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  return { ok: false, status: String(last?.message ?? last) };
}

export const npmUrl = (pkg) => `https://registry.npmjs.org/${encodeURIComponent(pkg)}`;
const NPM_PACKAGES = ['typescript-eslint', 'nuxt-og-image', 'nuxt', 'nitro', 'discord.js', '@discordjs/rest', '@types/node'];
const KEY_OF = { 'typescript-eslint': ['lock.ts7.typescript-eslint'], 'nuxt-og-image': ['lock.satori.nuxt-og-image'], nuxt: ['lock.nuxt5.nuxt'], nitro: ['lock.nitro3.nitro'], 'discord.js': ['lock.discordjs15.discord.js'], '@discordjs/rest': ['lock.undici8.@discordjs/rest'], '@types/node': ['lock.typesnode27.@types/node'] };

export async function collect({ token, fetchImpl = fetch } = {}) {
  const failed = [];
  const npm = {};
  await Promise.all(NPM_PACKAGES.map(async (p) => {
    const r = await getJson(npmUrl(p), { accept: 'application/vnd.npm.install-v1+json', fetchImpl });
    if (!r.ok) { failed.push(...KEY_OF[p]); return; }
    const tags = r.json['dist-tags'] ?? {};
    npm[p] = { distTags: tags, latest: { version: tags.latest, ...(r.json.versions?.[tags.latest] ?? {}) } };
  }));
  let signals = evaluateNpm(npm);
  const node = await getJson('https://nodejs.org/dist/index.json', { fetchImpl });
  if (node.ok) Object.assign(signals, evaluateNode(node.json)); else failed.push('node.lts', 'node.newest-is-lts');
  const gh = (p) => getJson(`https://api.github.com${p}`, { token, accept: 'application/vnd.github+json', fetchImpl });
  const [sl, sList, pl] = await Promise.all([gh('/repos/Sonarr/Sonarr/releases/latest'), gh('/repos/Sonarr/Sonarr/releases?per_page=20'), gh('/repos/Dictionarry-Hub/profilarr/releases/latest')]);
  Object.assign(signals, evaluateReleases({ sonarrLatest: sl.ok ? sl.json.tag_name : undefined, sonarrList: sList.ok ? sList.json : undefined, profilarrLatest: pl.ok ? pl.json.tag_name : undefined }));
  if (!sl.ok) failed.push('sonarr.latest-stable');
  if (!sList.ok) failed.push('sonarr.v5-prerelease');
  if (!pl.ok) failed.push('profilarr.latest');
  for (const repo of REPOS) {
    const meta = await gh(`/repos/${repo}`);
    const isPublic = meta.ok && meta.json.visibility === 'public';
    const d = { public: isPublic };
    if (isPublic) {
      const [pulls, runs, dep, cs] = await Promise.all([
        gh(`/repos/${repo}/pulls?state=open&per_page=100`),
        gh(`/repos/${repo}/actions/runs?branch=main&per_page=100`),
        gh(`/repos/${repo}/dependabot/alerts?state=open&per_page=100`),
        gh(`/repos/${repo}/code-scanning/alerts?state=open&per_page=100`),
      ]);
      d.pulls = pulls.ok ? pulls.json : null;
      d.runs = runs.ok ? runs.json.workflow_runs.filter((r) => r.event === 'push' || r.event === 'schedule') : null;
      d.dependabot = dep.ok ? dep.json : null;
      d.codeScanning = cs.ok ? cs.json : null;
    }
    Object.assign(signals, evaluateRepo(repo, d));
  }
  return { signals, failed };
}

export async function postEscalation(payload, { url, bearer, fetchImpl = fetch }) {
  if (!url || !bearer) return { sent: false, status: 'skipped (Secrets fehlen)' };
  if (!/^https:\/\//.test(url)) return { sent: false, status: 'skipped (kein https)' };
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}`, 'idempotency-key': idempotencyKey(payload), 'user-agent': UA }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
    return { sent: res.ok, status: res.status };
  } catch (e) { return { sent: false, status: `Fehler: ${String(e?.name ?? 'request failed')}` }; }
}

async function readState(path) {
  if (!path) return null;
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

async function main(argv) {
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const mode = opt('--mode');
  if (mode !== 'watch' && mode !== 'watchdog') { console.error('usage: node tools/upstream-watch.mjs --mode watch|watchdog --state-in f [--state-out f] [--event e] [--test] [--max-hours n] [--summary f]'); return 1; }
  const env = process.env;
  const repository = env.GITHUB_REPOSITORY ?? 'Derpsen/MagguuBot';
  const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repository}/actions/runs/${env.GITHUB_RUN_ID}` : '';
  const hook = { url: env.ESCALATION_WEBHOOK_URL || '', bearer: env.ESCALATION_BEARER || '' };
  console.log(`escalation secrets set: ${hook.url && hook.bearer ? 'yes' : 'no'}`);
  const prev = await readState(opt('--state-in'));
  const lines = [];
  if (mode === 'watchdog') {
    const w = watchdog({ state: prev, now: Date.now(), maxHours: Number(opt('--max-hours') ?? 26) });
    lines.push(`# upstream-watch watchdog`, '', `${w.stale ? '**STALE**' : 'ok'}: ${w.reason}`);
    if (w.stale) {
      const r = await postEscalation(buildPayload({ repository, runUrl, changes: [{ key: 'watchdog', from: w.lastScheduledAt, to: `kein geplanter Lauf seit ${w.ageHours.toFixed(1)} h` }] }), hook);
      lines.push(`escalation: HTTP ${r.status}`);
      console.log(`::warning title=upstream-watch::${w.reason}`);
    }
  } else {
    const test = argv.includes('--test');
    const { signals: raw, failed } = await collect({ token: env.GITHUB_TOKEN || undefined });
    const signals = mergeWithPrevious(prev?.signals, raw, failed);
    const changes = prev ? diffSignals(prev.signals, signals) : [];
    const scheduled = opt('--event') === 'schedule';
    const now = new Date().toISOString();
    let next = { version: 1, checkedAt: now, lastScheduledAt: scheduled ? now : (prev?.lastScheduledAt ?? null), signals };
    lines.push('# upstream-watch', '', prev ? `${changes.length} Änderung(en) seit ${prev.checkedAt}` : 'Baseline (kein vorheriger Zustand, keine Eskalation)', '');
    if (failed.length) lines.push(`Nicht lesbar (vorheriger Wert bleibt): ${failed.join(', ')}`, '');
    lines.push('| Signal | Wert |', '|---|---|', ...Object.entries(signals).map(([k, v]) => `| ${k}${v.met ? ' ⚠' : ''} | ${String(v.value).replace(/\|/g, '/')} |`));
    if (changes.length) lines.push('', '## Änderungen', ...changes.map((c) => `- ${formatChange(c)}`));
    if (test) {
      const r = await postEscalation(buildPayload({ title: 'TEST', repository, runUrl, test: true, changes: [{ key: 'test', from: null, to: 'TEST-Lauf, kein echter Fund' }, ...changes.slice(0, 5)] }), hook);
      lines.push('', `TEST escalation: HTTP ${r.status}`);
      console.log(`TEST escalation POST finished, HTTP status: ${r.status}`);
      next = prev ?? next; // a test run never moves the baseline
    } else if (changes.length) {
      const r = await postEscalation(buildPayload({ repository, runUrl, changes }), hook);
      lines.push('', `escalation: HTTP ${r.status}`);
      console.log(`escalation POST finished, HTTP status: ${r.status}`);
      if (!r.sent && hook.url && hook.bearer) next = { ...next, signals: mergeWithPrevious(signals, prev.signals, changes.map((c) => c.key)) };
    }
    if (opt('--state-out')) await writeFile(opt('--state-out'), `${JSON.stringify(next, null, 2)}\n`);
    console.log(`upstream-watch: ${Object.keys(signals).length} Signale, ${changes.length} Änderung(en), ${failed.length} nicht lesbar`);
  }
  if (opt('--summary')) await writeFile(opt('--summary'), `${lines.join('\n')}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`::error::upstream-watch: ${e?.message ?? e}`); process.exitCode = 1; });
}
