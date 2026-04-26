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
}

const WIDTH = 1100;
const HEIGHT = 380;

export async function renderWelcomeCard(input: WelcomeCardInput): Promise<Buffer> {
  ensureFontsRegistered();

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  fillBackground(ctx, WIDTH, HEIGHT);

  // Outer card border highlight
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

  // Text block
  const textX = avatarX + avatarSize + 50;

  ctx.fillStyle = COLOR.textMuted;
  ctx.font = `28px ${FONT.regular}`;
  ctx.textBaseline = 'top';
  ctx.fillText('Willkommen', textX, 90);

  ctx.fillStyle = COLOR.text;
  ctx.font = `bold 64px ${FONT.bold}`;
  const usernameTrunc = truncateText(ctx, input.username, WIDTH - textX - 60);
  ctx.fillText(usernameTrunc, textX, 122);

  ctx.fillStyle = COLOR.accentBright;
  ctx.font = `bold 30px ${FONT.bold}`;
  ctx.fillText(`auf ${truncateText(ctx, input.serverName, 600)}`, textX, 200);

  // Member count badge
  const badgeText = `Member #${input.memberCount}`;
  ctx.font = `bold 26px ${FONT.bold}`;
  const badgeMetrics = ctx.measureText(badgeText);
  const badgePadX = 22;
  const badgePadY = 12;
  const badgeW = badgeMetrics.width + badgePadX * 2;
  const badgeH = 50;
  const badgeX = textX;
  const badgeY = 260;

  drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
  ctx.fillStyle = 'rgba(88, 101, 242, 0.18)';
  ctx.fill();
  drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
  ctx.strokeStyle = COLOR.accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = COLOR.text;
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, badgeX + badgePadX, badgeY + badgeH / 2 + 1);

  return canvas.toBuffer('image/png');
}
