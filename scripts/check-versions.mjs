#!/usr/bin/env node
// MagguuUI version-consistency check.
// Source of truth: latest Derpsen/MagguuUI release tag (+ MagguuUI.toc "## Version" on main
// when it is a literal; "@project-version@" is the packager placeholder and defers to the tag).
// MagguuBot mismatches fail (exit 1). MagguuUI-Website mismatches only warn (other owner).
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ADDON_REPO = process.env.ADDON_REPO ?? 'Derpsen/MagguuUI';
const WEBSITE_REPO = process.env.WEBSITE_REPO ?? 'Derpsen/MagguuUI-Website';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
const GHA = process.env.GITHUB_ACTIONS === 'true';
const VERSION_RE = /\bv(\d+\.\d+\.\d+)\b/g;
// Docs carry dated history; only lines that claim the *current* version are compared.
const PLACEHOLDERS = new Set(['1.2.3', '0.0.0', '1.0.0']);
const CURRENT_CLAIM_RE = /\b(live|latest|current|aktuell|reference|references|known)\b/i;

async function gh(path) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'magguu-check-versions' };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`https://api.github.com/${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status}`);
  return res.json();
}

// Contents API with the raw media type works for private repos (MagguuUI) given a token;
// public repos (Website) also work unauthenticated.
async function raw(repo, ref, path) {
  const headers = { accept: 'application/vnd.github.raw+json', 'user-agent': 'magguu-check-versions' };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${ref}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`raw ${repo}/${path}: ${res.status}`);
  return res.text();
}

const norm = (v) => (v ? v.trim().replace(/^v/i, '') : null);

async function sourceOfTruth() {
  let release = null;
  try {
    release = norm((await gh(`repos/${ADDON_REPO}/releases/latest`)).tag_name);
  } catch {
    const tags = await gh(`repos/${ADDON_REPO}/tags?per_page=1`);
    release = norm(tags[0]?.name);
  }
  const toc = await raw(ADDON_REPO, 'main', 'MagguuUI.toc');
  const tocRaw = toc?.match(/^## Version:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const tocVersion = tocRaw && /^\d+\.\d+\.\d+/.test(norm(tocRaw)) ? norm(tocRaw) : null;
  return { release, tocRaw, tocVersion };
}

function scanText(file, text, { allLines }) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    if (!allLines && !CURRENT_CLAIM_RE.test(line)) return;
    for (const m of line.matchAll(VERSION_RE)) if (!PLACEHOLDERS.has(m[1])) hits.push({ file, line: i + 1, version: m[1] });
  });
  return hits;
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(ts|vue|md)$/.test(e.name)) out.push(p);
  }
  return out;
}

async function botMentions() {
  const hits = [];
  for (const f of ['AGENTS.md', 'MEMORY.md', 'README.md']) {
    hits.push(...scanText(f, await readFile(join(ROOT, f), 'utf8'), { allLines: false }));
  }
  // Player-facing embeds/FAQ: any addon version literal is a claim.
  for (const p of await walk(join(ROOT, 'src'))) {
    hits.push(...scanText(relative(ROOT, p), await readFile(p, 'utf8'), { allLines: true }));
  }
  return hits;
}

async function websiteMentions() {
  const hits = [];
  const changelog = await raw(WEBSITE_REPO, 'main', 'server/database/defaultAddonChangelog.ts');
  const first = changelog?.match(/version:\s*'v?(\d+\.\d+\.\d+)'/);
  if (first) hits.push({ file: 'server/database/defaultAddonChangelog.ts (CURRENT)', line: 0, version: first[1] });
  const fallback = (await raw(WEBSITE_REPO, 'main', 'server/utils/addonVersion.ts'))?.match(/\|\|\s*'v?(\d+\.\d+\.\d+)'/);
  if (fallback) hits.push({ file: 'server/utils/addonVersion.ts (fallback)', line: 0, version: fallback[1] });
  for (const f of ['AGENTS.md', 'MEMORY.md', 'README.md']) {
    const t = await raw(WEBSITE_REPO, 'main', f);
    if (t) hits.push(...scanText(f, t, { allLines: false }));
  }
  return hits;
}

if (!TOKEN) console.log(`${GHA ? '::warning::' : 'WARN '}No GITHUB_TOKEN/GH_TOKEN; ${ADDON_REPO} is private and needs one.`);
let truth;
try {
  truth = await sourceOfTruth();
} catch (err) {
  // Unreachable source of truth (e.g. missing read token for the private addon repo) is a
  // setup problem, not a version mismatch: warn instead of turning the schedule red.
  console.log(`${GHA ? '::warning::' : 'WARN '}Cannot read ${ADDON_REPO}: ${err.message}`);
  process.exit(0);
}
if (!truth.release) throw new Error(`No release/tag found for ${ADDON_REPO}`);
const expected = truth.tocVersion ?? truth.release;
console.log(`MagguuUI release tag: v${truth.release}; TOC ## Version: ${truth.tocRaw ?? 'missing'}`);
let failed = false;
if (truth.tocVersion && truth.release && truth.tocVersion !== truth.release) {
  console.log(`${GHA ? '::error::' : 'ERROR '}MagguuUI TOC ${truth.tocVersion} != release tag ${truth.release}`);
  failed = true;
}
console.log(`Expected version: ${expected}\n`);

const report = (label, hits, level) => {
  const bad = hits.filter((h) => h.version !== expected);
  console.log(`${label}: ${hits.length} current-version mention(s), ${bad.length} mismatch(es)`);
  for (const h of bad) {
    const where = h.line ? `${h.file}:${h.line}` : h.file;
    console.log(GHA ? `::${level} title=${label}::${where} says v${h.version}, expected v${expected}` : `  ${level.toUpperCase()} ${where}: v${h.version} (expected v${expected})`);
  }
  return bad.length;
};

if (report('MagguuBot', await botMentions(), 'error') > 0) failed = true;
try {
  report('MagguuUI-Website', await websiteMentions(), 'warning');
} catch (err) {
  console.log(`${GHA ? '::warning::' : 'WARN '}Website check skipped: ${err.message}`);
}
process.exit(failed ? 1 : 0);
