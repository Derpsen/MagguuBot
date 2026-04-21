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

export const githubWebhook = new Hono().post('/', async (c) => {
  const secret = config.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    logger.warn('github webhook received but GITHUB_WEBHOOK_SECRET is not set');
    return c.json({ ok: false, error: 'github webhook not configured' }, 503);
  }

  const signature = c.req.header('x-hub-signature-256');
  const eventName = c.req.header('x-github-event');
  const raw = await c.req.text();

  if (!signature || !eventName) {
    return c.json({ ok: false, error: 'missing signature or event' }, 400);
  }
  if (!verifySignature(raw, signature, secret)) {
    logger.warn({ eventName }, 'github webhook signature mismatch');
    return c.json({ ok: false, error: 'invalid signature' }, 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400);
  }

  const channelId = getChannel('github');

  if (eventName === 'ping') {
    const p = body as PingPayload;
    logger.info({ repo: p.repository?.full_name, hookId: p.hook_id }, 'github ping');
    return c.json({ ok: true, zen: p.zen });
  }

  if (eventName === 'push') {
    const p = body as PushPayload;
    if (p.commits.length === 0) return c.json({ ok: true, skipped: 'no commits' });
    await postEmbed({
      channelId,
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
      channelId,
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
      channelId,
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
    });
    return c.json({ ok: true });
  }

  if (eventName === 'pull_request') {
    const p = body as PullRequestPayload;
    if (!['opened', 'closed', 'reopened', 'ready_for_review'].includes(p.action)) {
      return c.json({ ok: true, skipped: 'ignored action' });
    }
    await postEmbed({
      channelId,
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
      channelId,
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

function verifySignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
