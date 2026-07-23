// Generate PWA icons by cropping Shelldon's head/face from the hero art and
// compositing over the cream page color. No image libraries available, so
// PNG decode/scale/encode are hand-rolled.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function readChunks(buf) {
  let off = 8; const c = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    c.push({ type, data: buf.slice(off + 8, off + 8 + len) });
    off += 12 + len;
  }
  return c;
}
function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); if (pa <= pb && pa <= pc) return a; if (pb <= pc) return b; return c; }
function decode(buf) {
  const ch = readChunks(buf);
  const ihdr = ch.find((c) => c.type === 'IHDR').data;
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
  const idat = Buffer.concat(ch.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = zlib.inflateSync(idat);
  const bpp = 4, stride = w * 4;
  const s = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const rb = raw[pos++];
      const a = x >= bpp ? s[y * stride + x - bpp] : 0;
      const b = y > 0 ? s[(y - 1) * stride + x] : 0;
      const c = (x >= bpp && y > 0) ? s[(y - 1) * stride + x - bpp] : 0;
      let v;
      switch (f) { case 0: v = rb; break; case 1: v = rb + a; break; case 2: v = rb + b; break; case 3: v = rb + ((a + b) >> 1); break; case 4: v = rb + paeth(a, b, c); break; }
      s[y * stride + x] = v & 0xff;
    }
  }
  return { w, h, rgba: s };
}
function crc32(buf) { let c; const t = crc32.t || (crc32.t = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })()); let crc = 0xffffffff; for (let i = 0; i < buf.length; i++) crc = t[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function chunk(ty, d) { const t = Buffer.from(ty, 'ascii'); const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(Buffer.concat([t, d])), 0); return Buffer.concat([l, t, d, cr]); }
function encode(w, h, rgba) { const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; const stride = w * 4; const raw = Buffer.alloc((stride + 1) * h); for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); } const idat = zlib.deflateSync(raw, { level: 9 }); return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]); }

const CREAM = [245, 234, 224];
const src = decode(fs.readFileSync(path.join(__dirname, '..', 'assets', 'hero-idle.png')));

// Square crop focused on the head/face, composited over cream.
const cropTop = Math.round(src.h * 0.02);
const cropSize = Math.min(src.w, Math.round(src.h * 0.52));
const cropLeft = Math.round((src.w - cropSize) / 2);

function sample(sx, sy) {
  if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) return [CREAM[0], CREAM[1], CREAM[2]];
  const i = (sy * src.w + sx) * 4;
  const a = src.rgba[i + 3] / 255;
  return [
    Math.round(src.rgba[i] * a + CREAM[0] * (1 - a)),
    Math.round(src.rgba[i + 1] * a + CREAM[1] * (1 - a)),
    Math.round(src.rgba[i + 2] * a + CREAM[2] * (1 - a)),
  ];
}

function makeIcon(size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = cropLeft + Math.floor((x / size) * cropSize);
      const sy = cropTop + Math.floor((y / size) * cropSize);
      const [r, g, b] = sample(sx, sy);
      const o = (y * size + x) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
  return encode(size, size, out);
}

const outDir = path.join(__dirname, '..', 'icons');
[['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon-180.png', 180], ['favicon-32.png', 32]].forEach(([name, size]) => {
  fs.writeFileSync(path.join(outDir, name), makeIcon(size));
  console.log('wrote', name);
});
