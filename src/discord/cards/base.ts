import { GlobalFonts, type Image, loadImage } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';
import { logger } from '../../utils/logger.js';

let fontsRegistered = false;

const NOTO_REGULAR_PATHS = [
  '/usr/share/fonts/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/TTF/NotoSans-Regular.ttf',
  '/usr/share/fonts/noto/NotoSans[wdth,wght].ttf',
];
const NOTO_BOLD_PATHS = [
  '/usr/share/fonts/noto/NotoSans-Bold.ttf',
  '/usr/share/fonts/TTF/NotoSans-Bold.ttf',
];

export function ensureFontsRegistered(): void {
  if (fontsRegistered) return;
  fontsRegistered = true;
  for (const p of NOTO_REGULAR_PATHS) {
    if (existsSync(p)) {
      try {
        GlobalFonts.registerFromPath(p, 'Noto Sans');
        break;
      } catch (err) {
        logger.debug({ err, path: p }, 'font registration failed (regular)');
      }
    }
  }
  for (const p of NOTO_BOLD_PATHS) {
    if (existsSync(p)) {
      try {
        GlobalFonts.registerFromPath(p, 'Noto Sans Bold');
        break;
      } catch (err) {
        logger.debug({ err, path: p }, 'font registration failed (bold)');
      }
    }
  }
}

export const FONT = {
  regular: '"Noto Sans", "Noto Sans CJK JP", sans-serif',
  bold: '"Noto Sans Bold", "Noto Sans", sans-serif',
};

export const COLOR = {
  bgTop: '#1a1d2e',
  bgBottom: '#0e1119',
  accent: '#5865F2',
  accentBright: '#7289FA',
  text: '#ffffff',
  textMuted: '#9ca3af',
  textDim: '#6b7280',
  xpBarBg: '#2a2d3e',
  success: '#22c55e',
  warn: '#f59e0b',
  danger: '#ef4444',
};

export async function fetchAvatar(url: string, size = 256): Promise<Image | null> {
  try {
    const sizedUrl = url.includes('?') ? `${url}&size=${size}` : `${url}?size=${size}`;
    const res = await fetch(sizedUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return await loadImage(buf);
  } catch (err) {
    logger.debug({ err, url }, 'avatar fetch failed');
    return null;
  }
}

export function drawRoundedRect(
  ctx: import('@napi-rs/canvas').SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function drawCircularImage(
  ctx: import('@napi-rs/canvas').SKRSContext2D,
  image: Image,
  x: number,
  y: number,
  size: number,
  ringColor?: string,
  ringWidth = 6,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(image, x, y, size, size);
  ctx.restore();

  if (ringColor) {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2 + ringWidth / 2, 0, Math.PI * 2);
    ctx.lineWidth = ringWidth;
    ctx.strokeStyle = ringColor;
    ctx.stroke();
  }
}

export function fillBackground(
  ctx: import('@napi-rs/canvas').SKRSContext2D,
  width: number,
  height: number,
): void {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, COLOR.bgTop);
  grad.addColorStop(1, COLOR.bgBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  const accent = ctx.createRadialGradient(
    width * 0.85,
    height * 0.2,
    20,
    width * 0.85,
    height * 0.2,
    Math.max(width, height) * 0.6,
  );
  accent.addColorStop(0, 'rgba(88, 101, 242, 0.25)');
  accent.addColorStop(1, 'rgba(88, 101, 242, 0)');
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, width, height);
}

export function drawXpBar(
  ctx: import('@napi-rs/canvas').SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  progress: number,
): void {
  const pct = Math.min(1, Math.max(0, progress));
  drawRoundedRect(ctx, x, y, width, height, height / 2);
  ctx.fillStyle = COLOR.xpBarBg;
  ctx.fill();

  if (pct <= 0) return;
  const filledWidth = Math.max(height, width * pct);
  drawRoundedRect(ctx, x, y, filledWidth, height, height / 2);
  const grad = ctx.createLinearGradient(x, y, x + filledWidth, y);
  grad.addColorStop(0, COLOR.accent);
  grad.addColorStop(1, COLOR.accentBright);
  ctx.fillStyle = grad;
  ctx.fill();
}

export function truncateText(
  ctx: import('@napi-rs/canvas').SKRSContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = text.slice(0, mid) + '…';
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}
