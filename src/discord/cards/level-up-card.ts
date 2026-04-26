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

export interface LevelUpCardInput {
  username: string;
  avatarUrl: string;
  oldLevel: number;
  newLevel: number;
}

const WIDTH = 800;
const HEIGHT = 240;

export async function renderLevelUpCard(input: LevelUpCardInput): Promise<Buffer> {
  ensureFontsRegistered();

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  fillBackground(ctx, WIDTH, HEIGHT);

  drawRoundedRect(ctx, 8, 8, WIDTH - 16, HEIGHT - 16, 18);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const avatar = await fetchAvatar(input.avatarUrl, 200);
  const avatarSize = 140;
  const avatarX = 50;
  const avatarY = (HEIGHT - avatarSize) / 2;
  if (avatar) {
    drawCircularImage(ctx, avatar, avatarX, avatarY, avatarSize, COLOR.success, 5);
  }

  const textX = avatarX + avatarSize + 35;

  ctx.fillStyle = COLOR.success;
  ctx.font = `bold 22px ${FONT.bold}`;
  ctx.textBaseline = 'top';
  ctx.fillText('🎉  LEVEL UP', textX, 60);

  ctx.fillStyle = COLOR.text;
  ctx.font = `bold 36px ${FONT.bold}`;
  ctx.fillText(truncateText(ctx, input.username, WIDTH - textX - 60), textX, 92);

  ctx.fillStyle = COLOR.textMuted;
  ctx.font = `26px ${FONT.regular}`;
  ctx.textBaseline = 'middle';
  const oldStr = `Level ${input.oldLevel}`;
  const arrow = '  →  ';
  const newStr = `Level ${input.newLevel}`;

  let cursor = textX;
  const baselineY = 165;
  ctx.fillText(oldStr, cursor, baselineY);
  cursor += ctx.measureText(oldStr).width;
  ctx.fillStyle = COLOR.accentBright;
  ctx.fillText(arrow, cursor, baselineY);
  cursor += ctx.measureText(arrow).width;
  ctx.fillStyle = COLOR.text;
  ctx.font = `bold 30px ${FONT.bold}`;
  ctx.fillText(newStr, cursor, baselineY);

  return canvas.toBuffer('image/png');
}
