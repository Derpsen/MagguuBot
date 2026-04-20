import { EmbedBuilder } from 'discord.js';
import { Colors, truncate } from './colors.js';

interface PushCommit {
  id: string;
  message: string;
  author: { name?: string; username?: string };
  url: string;
}

interface Repo {
  full_name: string;
  html_url: string;
}

export interface PushEmbedInput {
  repo: Repo;
  ref: string;
  pusher: string;
  commits: PushCommit[];
  compareUrl: string;
  forced: boolean;
}

export function buildPushEmbed(i: PushEmbedInput): EmbedBuilder {
  const branch = i.ref.replace('refs/heads/', '');
  const header = `📦  \`${i.repo.full_name}\`  ·  \`${branch}\``;
  const subtitle = `**${i.commits.length}** commit${i.commits.length === 1 ? '' : 's'}${i.forced ? '  ·  ⚠️ force-push' : ''} by **${i.pusher}**`;
  const body = i.commits
    .slice(0, 10)
    .map((c) => {
      const shortSha = c.id.slice(0, 7);
      const firstLine = (c.message ?? '').split('\n')[0] ?? '';
      const author = c.author.username ?? c.author.name ?? '?';
      return `[\`${shortSha}\`](${c.url}) ${truncate(firstLine, 90)} — _${author}_`;
    })
    .join('\n');
  const more = i.commits.length > 10 ? `\n_…+${i.commits.length - 10} more_` : '';

  return new EmbedBuilder()
    .setColor(i.forced ? Colors.warn : Colors.info)
    .setAuthor({ name: i.repo.full_name, url: i.repo.html_url })
    .setTitle(header)
    .setURL(i.compareUrl)
    .setDescription(`${subtitle}\n\n${body}${more}`)
    .setFooter({ text: 'GitHub  ·  push' })
    .setTimestamp(new Date());
}

export interface WorkflowEmbedInput {
  repo: Repo;
  workflowName: string;
  branch: string;
  actor: string;
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required';
  runUrl: string;
  headSha: string;
  headCommitMessage?: string;
  runNumber: number;
}

export function buildWorkflowEmbed(i: WorkflowEmbedInput): EmbedBuilder {
  const icon =
    i.conclusion === 'success'
      ? '✅'
      : i.conclusion === 'failure'
        ? '❌'
        : i.conclusion === 'cancelled'
          ? '🚫'
          : i.conclusion === 'timed_out'
            ? '⏱️'
            : '⚠️';
  const color =
    i.conclusion === 'success' ? Colors.success : i.conclusion === 'failure' ? Colors.danger : Colors.warn;

  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: i.repo.full_name, url: i.repo.html_url })
    .setTitle(`${icon}  ${i.workflowName}  ·  ${i.conclusion}`)
    .setURL(i.runUrl)
    .setDescription(
      [
        `**Branch:** \`${i.branch}\`  ·  **Run #${i.runNumber}**`,
        `**Commit:** \`${i.headSha.slice(0, 7)}\`${i.headCommitMessage ? ' — ' + truncate(i.headCommitMessage.split('\n')[0] ?? '', 100) : ''}`,
        `**Actor:** ${i.actor}`,
      ].join('\n'),
    )
    .setFooter({ text: 'GitHub  ·  workflow run' })
    .setTimestamp(new Date());
}

export interface ReleaseEmbedInput {
  repo: Repo;
  tag: string;
  name?: string;
  author: string;
  body?: string;
  url: string;
  prerelease: boolean;
}

export function buildReleaseEmbed(i: ReleaseEmbedInput): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(i.prerelease ? Colors.warn : Colors.success)
    .setAuthor({ name: i.repo.full_name, url: i.repo.html_url })
    .setTitle(`🏷️  ${i.name ?? i.tag}${i.prerelease ? '  ·  pre-release' : ''}`)
    .setURL(i.url)
    .setDescription(truncate(i.body || '_No release notes._', 1500))
    .addFields({ name: 'By', value: i.author, inline: true }, { name: 'Tag', value: `\`${i.tag}\``, inline: true })
    .setFooter({ text: 'GitHub  ·  release' })
    .setTimestamp(new Date());
}

export interface PullRequestEmbedInput {
  repo: Repo;
  action: string;
  number: number;
  title: string;
  author: string;
  url: string;
  merged: boolean;
  state: string;
}

export function buildPullRequestEmbed(i: PullRequestEmbedInput): EmbedBuilder {
  const icon = i.merged ? '🟣' : i.state === 'open' ? '🟢' : '🔴';
  const color = i.merged ? 0x8250df : i.state === 'open' ? Colors.success : Colors.muted;
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: i.repo.full_name, url: i.repo.html_url })
    .setTitle(`${icon}  PR #${i.number} ${i.action}`)
    .setURL(i.url)
    .setDescription(`**${truncate(i.title, 200)}**\n_by ${i.author}_`)
    .setFooter({ text: `GitHub  ·  pull request  ·  ${i.state}${i.merged ? ' (merged)' : ''}` })
    .setTimestamp(new Date());
}
