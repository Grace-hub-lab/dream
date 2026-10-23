// 纯 JS 生成 PWA 图标（月牙 + 星星），仅依赖 Node 内置 zlib
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

// ---------- PNG 编码 ----------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 绘制 ----------
// scale：内容缩放（maskable 图标需留出安全边距）
function draw(size, scale) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4; // 4x4 超采样抗锯齿
  const cx = 0.5, cy = 0.5;
  const moonR = 0.30 * scale;
  const moonX = cx - 0.03 * scale, moonY = cy + 0.01 * scale;
  const cutR = moonR * 0.85;
  const cutX = moonX + moonR * 0.45, cutY = moonY - moonR * 0.32;
  const stars = [
    [0.72, 0.30, 0.035], [0.80, 0.52, 0.022], [0.62, 0.70, 0.018], [0.30, 0.24, 0.015],
  ].map(([x, y, r]) => [cx + (x - cx) * scale, cy + (y - cy) * scale, r * scale]);

  // 四角星判定
  const inStar = (x, y, sx, sy, r) => {
    const dx = Math.abs(x - sx), dy = Math.abs(y - sy);
    return Math.sqrt(dx) + Math.sqrt(dy) <= Math.sqrt(r) * 1.0;
  };

  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (pxl + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          // 背景：深紫到靛蓝的径向渐变
          const d = Math.hypot(x - 0.5, y - 0.35);
          const t = Math.min(1, d / 0.8);
          let cr = 64 + (13 - 64) * t, cg = 38 + (10 - 38) * t, cb = 128 + (36 - 128) * t;
          const inMoon = Math.hypot(x - moonX, y - moonY) <= moonR && Math.hypot(x - cutX, y - cutY) > cutR;
          if (inMoon) {
            // 月牙：暖金色，带一点纵向渐变
            const k = (y - (moonY - moonR)) / (2 * moonR);
            cr = 255; cg = 228 - 30 * k; cb = 150 - 50 * k;
          } else if (stars.some(([sx2, sy2, rr]) => inStar(x, y, sx2, sy2, rr))) {
            cr = 255; cg = 245; cb = 220;
          }
          r += cr; g += cg; b += cb;
        }
      }
      const n = SS * SS, i = (py * size + pxl) * 4;
      px[i] = Math.round(r / n);
      px[i + 1] = Math.round(g / n);
      px[i + 2] = Math.round(b / n);
      px[i + 3] = 255;
    }
  }
  return encodePng(size, px);
}

const targets = [
  ['icon-180.png', 180, 1],
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-512-maskable.png', 512, 0.75],
];
for (const [name, size, scale] of targets) {
  fs.writeFileSync(path.join(OUT, name), draw(size, scale));
  console.log('生成', name);
}
