// Generates apps/studio/src-tauri/icons/icon.png (256x256) and icon.ico
// (PNG-embedded, Vista+ format) — the Studio blob mark, no asset tools needed.
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 256;
const px = new Uint8Array(SIZE * SIZE * 4);

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
    if (!inRoundRect(x, y, 16, 16, 239, 239, 56)) continue;
    // purple tile
    put(x, y, 0xc7, 0x7d, 0xff);
    // eyes
    const eye = (ex, ey) => (x - ex) ** 2 + (y - ey) ** 2 <= 18 ** 2;
    // smile: ring segment
    const dx = x - 128;
    const dy = y - 138;
    const d = Math.hypot(dx, dy);
    const smile = d >= 40 && d <= 54 && dy > 18;
    if (eye(92, 108) || eye(164, 108) || smile) put(x, y, 0x12, 0x10, 0x1c);
  }
}

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
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter none
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

// ---- ICO wrapper (single PNG-compressed 256x256 entry) ----
const ico = Buffer.alloc(6 + 16);
ico.writeUInt16LE(0, 0); // reserved
ico.writeUInt16LE(1, 2); // type: icon
ico.writeUInt16LE(1, 4); // count
ico[6] = 0; // width 256
ico[7] = 0; // height 256
ico.writeUInt16LE(1, 10); // planes
ico.writeUInt16LE(32, 12); // bpp
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18); // offset

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'apps', 'studio', 'src-tauri', 'icons');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon.png'), png);
writeFileSync(join(outDir, 'icon.ico'), Buffer.concat([ico, png]));
console.log(`wrote icon.png (${png.length}b) + icon.ico -> ${outDir}`);
