// Generates the Interverse Studio icons (purple blob tile) at every size we
// ship: Tauri (icon.png 256 + icon.ico) and PWA (192/512 + apple-touch 180).
// Pure node — a tiny PNG encoder, no asset tooling.
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- minimal PNG encoder (RGBA, filter 0) ----
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function drawIcon(SIZE) {
  const px = new Uint8Array(SIZE * SIZE * 4);
  const u = SIZE / 256; // design units scale from the 256 master
  const put = (x, y, r, g, b, a = 255) => {
    const i = (y * SIZE + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };
  const inRoundRect = (x, y, x0, y0, x1, y1, rad) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.max(x0 + rad, Math.min(x1 - rad, x));
    const cy = Math.max(y0 + rad, Math.min(y1 - rad, y));
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
  };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!inRoundRect(x, y, 16 * u, 16 * u, 239 * u, 239 * u, 56 * u)) continue;
      put(x, y, 0xc7, 0x7d, 0xff);
      const eye = (ex, ey) => (x - ex * u) ** 2 + (y - ey * u) ** 2 <= (18 * u) ** 2;
      const dx = x - 128 * u;
      const dy = y - 138 * u;
      const d = Math.hypot(dx, dy);
      const smile = d >= 40 * u && d <= 54 * u && dy > 18 * u;
      if (eye(92, 108) || eye(164, 108) || smile) put(x, y, 0x12, 0x10, 0x1c);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const here = dirname(fileURLToPath(import.meta.url));
const tauriDir = join(here, '..', 'apps', 'studio', 'src-tauri', 'icons');
const pubDir = join(here, '..', 'apps', 'studio', 'public');
mkdirSync(tauriDir, { recursive: true });
mkdirSync(pubDir, { recursive: true });

const png256 = drawIcon(256);
// ICO wrapper (single PNG-compressed 256 entry, Vista+)
const ico = Buffer.alloc(6 + 16);
ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png256.length, 14);
ico.writeUInt32LE(22, 18);

writeFileSync(join(tauriDir, 'icon.png'), png256);
writeFileSync(join(tauriDir, 'icon.ico'), Buffer.concat([ico, png256]));
writeFileSync(join(pubDir, 'icon-192.png'), drawIcon(192));
writeFileSync(join(pubDir, 'icon-512.png'), drawIcon(512));
writeFileSync(join(pubDir, 'apple-touch-icon.png'), drawIcon(180));
console.log('wrote tauri icon.png/icon.ico + pwa 192/512/apple-touch');
