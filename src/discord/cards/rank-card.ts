import { createCanvas } from '@napi-rs/canvas';
import {
  COLOR,
  FONT,
  drawCircularImage,
  drawRoundedRect,
  drawXpBar,
  ensureFontsRegistered,
  fetchAvatar,
  fillBackground,
  truncateText,
} from './base.js';

export interface RankCardInput {
  username: string;
  avatarUrl: string;
  level: number;
  xp: number;
  xpInLevel: number;
  xpForNextLevel: number;
  rank: number;
  messages: number;
}

const WIDTH = 1100;
const HEIGHT = 360;

export async function renderRankCard(input: RankCardInput): Promise<Buffer> {
  ensureFontsRegistered();

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  fillBackground(ctx, WIDTH, HEIGHT);

  drawRoundedRect(ctx, 12, 12, WIDTH - 24, HEIGHT - 24, 24);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Avatar
  const avatar = await fetchAvatar(input.avatarUrl, 256);
  const avatarSize = 200;
  const avatarX = 70;
  const avatarY = (HEIGHT - avatarSize) / 2;
  if (avatar) {
    drawCircularImage(ctx, avatar, avatarX, avatarY, avatarSize, COLOR.accent, 6);
  } else {
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = COLOR.xpBarBg;
    ctx.fill();
  }

  // Right column
  const textX = avatarX + avatarSize + 50;
  const rightEdge = WIDTH - 60;

  // Username
  ctx.fillStyle = COLOR.text;
  ctx.font = `bold 56px ${FONT.bold}`;
  ctx.textBaseline = 'top';
  ctx.fillText(truncateText(ctx, input.username, 460), textX, 70);

  // Stats row: Level + Rank
  ctx.font = `bold 28px ${FONT.bold}`;
  const levelLabel = 'LEVEL';
  const rankLabel = 'RANK';
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(rankLabel, rightEdge - 200, 70);
  ctx.fillText(levelLabel, rightEdge - 380, 70);

  ctx.font = `bold 56px ${FONT.bold}`;
  ctx.fillStyle = COLOR.text;
  ctx.fillText(`#${input.rank}`, rightEdge - 200, 100);
  ctx.fillStyle = COLOR.accentBright;
  ctx.fillText(`${input.level}`, rightEdge - 380, 100);

  // XP bar with current/needed labels
  const barX = textX;
  const barY = 220;
  const barW = WIDTH - barX - 60;
  const barH = 30;

  const progress = input.xpForNextLevel > 0 ? input.xpInLevel / input.xpForNextLevel : 0;
  drawXpBar(ctx, barX, barY, barW, barH, progress);

  // XP text on top of bar
  ctx.fillStyle = COLOR.textMuted;
  ctx.font = `20px ${FONT.regular}`;
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${input.xpInLevel} / ${input.xpForNextLevel} XP`, barX, barY - 6);

  ctx.textAlign = 'right';
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(`${input.xp} XP gesamt`, barX + barW, barY - 6);
  ctx.textAlign = 'left';

  // Footer line: messages
  ctx.fillStyle = COLOR.textDim;
  ctx.font = `22px ${FONT.regular}`;
  ctx.textBaseline = 'top';
  ctx.fillText(`${input.messages.toLocaleString('de-DE')} Nachrichten gezählt`, barX, barY + barH + 16);

  return canvas.toBuffer('image/png');
}
