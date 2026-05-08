import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { config } from '../../config.js';
import { getChannel } from '../../discord/channel-store.js';
import {
  buildIssueEmbed,
  buildPullRequestEmbed,
  buildPushEmbed,
  buildReleaseEmbed,
  buildWorkflowEmbed,
} from '../../embeds/github.js';
import { logger } from '../../utils/logger.js';
import { postEmbed } from '../discord-poster.js';

interface PushPayload {
  ref: string;
  forced?: boolean;
  compare?: string;
  repository: { full_name: string; html_url: string };
  pusher: { name: string };
  commits: { id: string; message: string; author: { name?: string; username?: string }; url: string }[];
}

interface WorkflowRunPayload {
  action: 'completed' | 'requested' | 'in_progress';
  workflow_run: {
    name: string;
    head_branch: string;
    head_sha: string;
    status: string;
    conclusion:
      | 'success'
      | 'failure'
      | 'cancelled'
      | 'skipped'
      | 'timed_out'
      | 'action_required'
      | null;
    html_url: string;
    run_number: number;
    actor: { login: string };
    head_commit?: { message: string };
  };
  repository: { full_name: string; html_url: string };
}

interface ReleasePayload {
  action: 'published' | 'created' | 'released';
  release: {
    tag_name: string;
    name?: string;
    body?: string;
    html_url: string;
    author: { login: string };
    prerelease: boolean;
  };
  repository: { full_name: string; html_url: string };
}

interface PullRequestPayload {
  action: string;
  number: number;
  pull_request: {
    title: string;
    html_url: string;
    state: string;
    merged: boolean;
    user: { login: string };
  };
  repository: { full_name: string; html_url: string };
}

interface PingPayload {
  zen: string;
  hook_id: number;
  repository?: { full_name: string };
}

interface IssuePayload {
  action: string;
  issue: {
    number: number;
    title: string;
    body?: string;
    html_url: string;
    state: string;
    user: { login: string };
    labels?: { name: string; color?: string }[];
  };
  repository: { full_name: string; html_url: string };
}

// GitHub release/push payloads are typically <100 KB. Cap well above that
// so an unauthenticated probe cannot force a multi-MB read into RAM before
// the signature check runs.
const MAX_GITHUB_BODY_BYTES = 1 * 1024 * 1024;

// Replay protection: every GitHub webhook delivery carries a unique
// `X-GitHub-Delivery` UUID. Cache the last seen IDs so a captured-and-replayed
// payload is rejected as a duplicate. Bounded LRU keeps memory predictable.
const SEEN_DELIVERIES_MAX = 2_000;
const SEEN_DELIVERIES_TTL_MS = 60 * 60 * 1000;
const seenDeliveries = new Map<string, number>();

function rememberDelivery(id: string): boolean {
  const now = Date.now();
  // Lazy expiry: evict entries older than TTL on each call.
  for (const [key, at] of seenDeliveries) {
    if (now - at > SEEN_DELIVERIES_TTL_MS) seenDeliveries.delete(key);
    else break; // Map preserves insertion order
  }
  if (seenDeliveries.has(id)) return false;
  if (seenDeliveries.size >= SEEN_DELIVERIES_MAX) {
    const oldest = seenDeliveries.keys().next().value;
    if (oldest !== undefined) seenDeliveries.delete(oldest);
  }
  seenDeliveries.set(id, now);
  return true;
}

export const githubWebhook = new Hono().post('/', async (c) => {
  const secret = config.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    // Fail closed: do NOT 503 (which leaks "this endpoint exists but is
    // misconfigured"). Return 401 so an unauthenticated probe sees the same
    // response shape as a bad signature.
    logger.warn('github webhook hit but GITHUB_WEBHOOK_SECRET is unset; rejecting');
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  // Reject oversized bodies before reading them (Content-Length hint).
  const declaredLen = Number(c.req.header('content-length') ?? 0);
  if (declaredLen && declaredLen > MAX_GITHUB_BODY_BYTES) {
    return c.json({ ok: false, error: 'payload too large' }, 413);
  }

  const signature = c.req.header('x-hub-signature-256');
  const eventName = c.req.header('x-github-event');
  const deliveryId = c.req.header('x-github-delivery');
  const raw = await c.req.text();
  if (Buffer.byteLength(raw) > MAX_GITHUB_BODY_BYTES) {
    return c.json({ ok: false, error: 'payload too large' }, 413);
  }

  if (!signature || !eventName) {
    return c.json({ ok: false, error: 'missing signature or event' }, 400);
  }
  if (!signature.startsWith('sha256=')) {
    return c.json({ ok: false, error: 'invalid signature' }, 401);
  }
  if (!verifySignature(raw, signature, secret)) {
    logger.warn({ eventName }, 'github webhook signature mismatch');
    return c.json({ ok: false, error: 'invalid signature' }, 401);
  }

  if (deliveryId && !rememberDelivery(deliveryId)) {
    logger.warn({ deliveryId, eventName }, 'github webhook replay rejected');
    return c.json({ ok: true, skipped: 'duplicate delivery' });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400);
  }

  const addonRepos = parseAddonRepos(config.ADDON_REPO_FULL_NAMES);
  const resolveChannel = (repo: { full_name: string } | undefined): string | undefined => {
    if (repo && addonRepos.has(repo.full_name.toLowerCase())) {
      return getChannel('addonUpdates') ?? getChannel('github');
    }
    return getChannel('github');
  };

  if (eventName === 'ping') {
    const p = body as PingPayload;
    logger.info({ repo: p.repository?.full_name, hookId: p.hook_id }, 'github ping');
    return c.json({ ok: true, zen: p.zen });
  }

  if (eventName === 'push') {
    const p = body as PushPayload;
    if (p.commits.length === 0) return c.json({ ok: true, skipped: 'no commits' });
    await postEmbed({
      channelId: resolveChannel(p.repository),
      source: 'github',
      eventType: 'push',
      payload: p,
      embed: buildPushEmbed({
        repo: p.repository,
        ref: p.ref,
        pusher: p.pusher.name,
        commits: p.commits,
        compareUrl: p.compare ?? p.repository.html_url,
        forced: p.forced ?? false,
      }),
    });
    return c.json({ ok: true });
  }

  if (eventName === 'workflow_run') {
    const p = body as WorkflowRunPayload;
    if (p.action !== 'completed' || !p.workflow_run.conclusion) return c.json({ ok: true, skipped: 'not completed' });
    await postEmbed({
      channelId: resolveChannel(p.repository),
      source: 'github',
      eventType: `workflow_run.${p.workflow_run.conclusion}`,
      payload: p,
      embed: buildWorkflowEmbed({
        repo: p.repository,
        workflowName: p.workflow_run.name,
        branch: p.workflow_run.head_branch,
        actor: p.workflow_run.actor.login,
        conclusion: p.workflow_run.conclusion,
        runUrl: p.workflow_run.html_url,
        headSha: p.workflow_run.head_sha,
        headCommitMessage: p.workflow_run.head_commit?.message,
        runNumber: p.workflow_run.run_number,
      }),
    });
    return c.json({ ok: true });
  }

  if (eventName === 'release') {
    const p = body as ReleasePayload;
    if (p.action !== 'published' && p.action !== 'released') return c.json({ ok: true, skipped: 'ignored action' });
    await postEmbed({
      channelId: resolveChannel(p.repository),
      source: 'github',
      eventType: `release.${p.action}`,
      payload: p,
      embed: buildReleaseEmbed({
        repo: p.repository,
        tag: p.release.tag_name,
        name: p.release.name,
        author: p.release.author.login,
        body: p.release.body,
        url: p.release.html_url,
        prerelease: p.release.prerelease,
      }),
      pingRoles: p.release.prerelease ? [] : ['ping-github'],
    });
    return c.json({ ok: true });
  }

  if (eventName === 'pull_request') {
    const p = body as PullRequestPayload;
    if (!['opened', 'closed', 'reopened', 'ready_for_review'].includes(p.action)) {
      return c.json({ ok: true, skipped: 'ignored action' });
    }
    await postEmbed({
      channelId: resolveChannel(p.repository),
      source: 'github',
      eventType: `pull_request.${p.action}`,
      payload: p,
      embed: buildPullRequestEmbed({
        repo: p.repository,
        action: p.action,
        number: p.number,
        title: p.pull_request.title,
        author: p.pull_request.user.login,
        url: p.pull_request.html_url,
        merged: p.pull_request.merged,
        state: p.pull_request.state,
      }),
    });
    return c.json({ ok: true });
  }

  if (eventName === 'issues') {
    const p = body as IssuePayload;
    if (!['opened', 'closed', 'reopened'].includes(p.action)) {
      return c.json({ ok: true, skipped: 'ignored action' });
    }
    await postEmbed({
      channelId: resolveChannel(p.repository),
      source: 'github',
      eventType: `issues.${p.action}`,
      payload: p,
      embed: buildIssueEmbed({
        repo: p.repository,
        action: p.action as 'opened' | 'closed' | 'reopened',
        number: p.issue.number,
        title: p.issue.title,
        body: p.issue.body,
        author: p.issue.user.login,
        url: p.issue.html_url,
        labels: p.issue.labels,
      }),
    });
    return c.json({ ok: true });
  }

  logger.debug({ eventName }, 'github event ignored');
  return c.json({ ok: true, skipped: eventName });
});

function parseAddonRepos(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function verifySignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
