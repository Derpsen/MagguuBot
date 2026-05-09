import { createCanvas } from '@napi-rs/canvas';
import {
  COLOR,
  FONT,
  drawCircularImage,
  drawRoundedRect,
  ensureFontsRegistered,
  fetchAvatar,
  fillBackground,
  truncateText,
} from './base.js';

export interface WelcomeCardInput {
  username: string;
  avatarUrl: string;
  memberCount: number;
  serverName: string;
  accountAgeDays: number;
  isReturning: boolean;
  serverBoostLevel?: number;
}

const WIDTH = 1200;
const HEIGHT = 440;

export async function renderWelcomeCard(input: WelcomeCardInput): Promise<Buffer> {
  ensureFontsRegistered();

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  fillBackground(ctx, WIDTH, HEIGHT);
  drawDecorativePattern(ctx);

  drawRoundedRect(ctx, 16, 16, WIDTH - 32, HEIGHT - 32, 28);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const avatar = await fetchAvatar(input.avatarUrl, 320);
  const avatarSize = 220;
  const avatarX = 80;
  const avatarY = (HEIGHT - avatarSize) / 2 - 18;
  if (avatar) {
    drawCircularImage(ctx, avatar, avatarX, avatarY, avatarSize, COLOR.accent, 7);
  } else {
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = COLOR.xpBarBg;
    ctx.fill();
  }

  drawStatusDot(ctx, avatarX + avatarSize - 26, avatarY + avatarSize - 26, input.isReturning ? COLOR.accentBright : COLOR.success);

  const textX = avatarX + avatarSize + 60;
  const maxTextWidth = WIDTH - textX - 70;

  ctx.fillStyle = COLOR.textMuted;
  ctx.font = `28px ${FONT.regular}`;
  ctx.textBaseline = 'top';
  ctx.fillText(input.isReturning ? 'Welcome back' : 'Willkommen', textX, 70);

  ctx.fillStyle = COLOR.text;
  ctx.font = `bold 70px ${FONT.bold}`;
  const usernameTrunc = truncateText(ctx, input.username, maxTextWidth);
  ctx.fillText(usernameTrunc, textX, 102);

  ctx.fillStyle = COLOR.accentBright;
  ctx.font = `bold 30px ${FONT.bold}`;
  ctx.fillText(`auf ${truncateText(ctx, input.serverName, maxTextWidth - 60)}`, textX, 188);

  let badgeX = textX;
  const badgeY = 252;
  const memberBadgeWidth = drawBadge(
    ctx,
    badgeX,
    badgeY,
    `Member #${input.memberCount}`,
    'rgba(88, 101, 242, 0.20)',
    COLOR.accent,
    COLOR.text,
  );
  badgeX += memberBadgeWidth + 14;

  const ageLabel = formatAgeLabel(input.accountAgeDays);
  const ageColor = input.accountAgeDays < 7 ? COLOR.warn : COLOR.success;
  const ageBg = input.accountAgeDays < 7 ? 'rgba(245, 158, 11, 0.18)' : 'rgba(34, 197, 94, 0.18)';
  const ageBadgeWidth = drawBadge(ctx, badgeX, badgeY, ageLabel, ageBg, ageColor, COLOR.text);
  badgeX += ageBadgeWidth + 14;

  if (input.isReturning) {
    drawBadge(ctx, badgeX, badgeY, '↩ Returning', 'rgba(124, 58, 237, 0.22)', '#7c3aed', COLOR.text);
  }

  if (input.serverBoostLevel && input.serverBoostLevel > 0) {
    const boostLabel = `🚀 Boost Lvl ${input.serverBoostLevel}`;
    ctx.font = `bold 22px ${FONT.bold}`;
    const boostMetrics = ctx.measureText(boostLabel);
    const boostX = WIDTH - 70 - boostMetrics.width - 28;
    drawBadge(
      ctx,
      boostX,
      62,
      boostLabel,
      'rgba(255, 115, 250, 0.18)',
      0xff73fa,
      COLOR.text,
    );
  }

  return canvas.toBuffer('image/png');
}

function drawBadge(
  ctx: import('@napi-rs/canvas').SKRSContext2D,
  x: number,
  y: number,
  text: string,
  fillColor: string,
  strokeColor: string | number,
  textColor: string,
): number {
  ctx.font = `bold 22px ${FONT.bold}`;
  const metrics = ctx.measureText(text);
  const padX = 18;
  const padY = 10;
  const w = metrics.width + padX * 2;
  const h = 42;

  drawRoundedRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = fillColor;
  ctx.fill();
  drawRoundedRect(ctx, x, y, w, h, h / 2);
  ctx.strokeStyle = typeof strokeColor === 'number' ? `#${strokeColor.toString(16).padStart(6, '0')}` : strokeColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + h / 2 + 1);
  ctx.textBaseline = 'top';

  return w;
}

function drawStatusDot(
  ctx: import('@napi-rs/canvas').SKRSContext2D,
  x: number,
  y: number,
  color: string,
): void {
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.fillStyle = '#0e1119';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawDecorativePattern(ctx: import('@napi-rs/canvas').SKRSContext2D): void {
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = COLOR.accentBright;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    const startX = WIDTH * 0.6 + i * 22;
    ctx.moveTo(startX, 0);
    ctx.lineTo(startX - 80, HEIGHT);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = COLOR.accent;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 22; col++) {
      const dotX = 50 + col * 50;
      const dotY = HEIGHT - 30 - row * 14;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function formatAgeLabel(days: number): string {
  if (days < 1) return '⚠ Account: heute erstellt';
  if (days < 7) return `⚠ Account: ${Math.floor(days)}d alt`;
  if (days < 30) return `Account: ${Math.floor(days)}d`;
  if (days < 365) return `Account: ${Math.floor(days / 30)}mo`;
  const years = Math.floor(days / 365);
  return `Account: ${years}${years > 1 ? ' Jahre' : ' Jahr'}`;
}
