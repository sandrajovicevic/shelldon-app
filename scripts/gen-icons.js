// Hand-rolled PNG encoder (no Pillow/ImageMagick in this environment) that
// rasterizes shell-design.js's 32x32 pixel grid into the icon sizes a PWA
// manifest needs, upscaled with nearest-neighbor blocks to keep the 8-bit look.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ShellDesign = require('../shell-design.js');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hexToRgba(hex, alpha) {
  if (!hex) return [0, 0, 0, 0];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, alpha === undefined ? 255 : alpha];
}

function rasterize(size, { transparentBg = false, state = 'idle' } = {}) {
  const grid = ShellDesign.buildGrid({ state, transparentBg });
  const gridSize = ShellDesign.GRID;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const gy = Math.min(gridSize - 1, Math.floor((y * gridSize) / size));
    for (let x = 0; x < size; x++) {
      const gx = Math.min(gridSize - 1, Math.floor((x * gridSize) / size));
      const [r, g, b, a] = hexToRgba(grid[gy][gx]);
      const idx = (y * size + x) * 4;
      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = a;
    }
  }
  return buf;
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-192.png', size: 192 },
  { name: 'apple-touch-icon-180.png', size: 180 },
  { name: 'favicon-32.png', size: 32 },
];

for (const t of targets) {
  const rgba = rasterize(t.size, { transparentBg: false, state: 'idle' });
  const png = encodePNG(t.size, t.size, rgba);
  fs.writeFileSync(path.join(outDir, t.name), png);
  console.log('wrote', t.name, `(${png.length} bytes)`);
}
