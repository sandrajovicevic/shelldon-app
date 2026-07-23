// Decode a PNG, flood-fill the uniform background from the borders to
// transparent, re-encode as RGBA. No image libraries available in this
// environment, so decode/encode are hand-rolled.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function readChunks(buf) {
  let off = 8; // skip signature
  const chunks = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    chunks.push({ type, data });
    off += 12 + len;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePNG(buf) {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  if (bitDepth !== 8) throw new Error('unsupported bit depth ' + bitDepth);

  let palette = null;
  const plte = chunks.find((c) => c.type === 'PLTE');
  if (plte) palette = plte.data;
  let trns = null;
  const trnsChunk = chunks.find((c) => c.type === 'tRNS');
  if (trnsChunk) trns = trnsChunk.data;

  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = zlib.inflateSync(idat);

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('unsupported color type ' + colorType);
  const bpp = channels; // bytes per pixel (bitDepth 8)
  const stride = width * bpp;

  // Defilter into a flat sample buffer.
  const samples = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos++];
      const a = x >= bpp ? samples[y * stride + x - bpp] : 0;
      const b = y > 0 ? samples[(y - 1) * stride + x] : 0;
      const c = (x >= bpp && y > 0) ? samples[(y - 1) * stride + x - bpp] : 0;
      let val;
      switch (filter) {
        case 0: val = rawByte; break;
        case 1: val = rawByte + a; break;
        case 2: val = rawByte + b; break;
        case 3: val = rawByte + ((a + b) >> 1); break;
        case 4: val = rawByte + paeth(a, b, c); break;
        default: throw new Error('bad filter ' + filter);
      }
      samples[y * stride + x] = val & 0xff;
    }
  }

  // Expand to RGBA.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r, g, b, alpha = 255;
    if (colorType === 6) {
      r = samples[i * 4]; g = samples[i * 4 + 1]; b = samples[i * 4 + 2]; alpha = samples[i * 4 + 3];
    } else if (colorType === 2) {
      r = samples[i * 3]; g = samples[i * 3 + 1]; b = samples[i * 3 + 2];
    } else if (colorType === 0) {
      r = g = b = samples[i];
    } else if (colorType === 3) {
      const idx = samples[i];
      r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
      if (trns && idx < trns.length) alpha = trns[idx];
    }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = alpha;
  }
  return { width, height, rgba };
}

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length, 0);
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([l, t, data, cr]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- main ----
const inPath = process.argv[2];
const outPath = process.argv[3];
const tolerance = Number(process.argv[4] || 42);

const { width, height, rgba } = decodePNG(fs.readFileSync(inPath));

// Sample the background color from the four corners (average).
const corners = [0, (width - 1), (height - 1) * width, height * width - 1];
let br = 0, bg = 0, bb = 0;
corners.forEach((i) => { br += rgba[i * 4]; bg += rgba[i * 4 + 1]; bb += rgba[i * 4 + 2]; });
br /= 4; bg /= 4; bb /= 4;

function isBg(i) {
  const dr = rgba[i * 4] - br, dg = rgba[i * 4 + 1] - bg, db = rgba[i * 4 + 2] - bb;
  return Math.sqrt(dr * dr + dg * dg + db * db) <= tolerance;
}

// Flood fill from every border pixel; only clears background connected to the edge,
// so gray-ish pixels inside the character (eye whites, etc.) are preserved.
const visited = new Uint8Array(width * height);
const stack = [];
for (let x = 0; x < width; x++) { stack.push(x); stack.push((height - 1) * width + x); }
for (let y = 0; y < height; y++) { stack.push(y * width); stack.push(y * width + width - 1); }

while (stack.length) {
  const i = stack.pop();
  if (visited[i]) continue;
  visited[i] = 1;
  if (!isBg(i)) continue;
  rgba[i * 4 + 3] = 0; // transparent
  const x = i % width, y = (i / width) | 0;
  if (x > 0) stack.push(i - 1);
  if (x < width - 1) stack.push(i + 1);
  if (y > 0) stack.push(i - width);
  if (y < height - 1) stack.push(i + width);
}

// Keep only the largest connected opaque blob (the character); this removes
// stray islands the border flood-fill couldn't reach, like sparkle artifacts.
const label = new Int32Array(width * height).fill(-1);
let best = -1, bestSize = 0;
for (let start = 0; start < width * height; start++) {
  if (label[start] !== -1 || rgba[start * 4 + 3] === 0) continue;
  const comp = [];
  const st = [start];
  label[start] = start;
  while (st.length) {
    const i = st.pop();
    comp.push(i);
    const x = i % width, y = (i / width) | 0;
    const nb = [];
    if (x > 0) nb.push(i - 1);
    if (x < width - 1) nb.push(i + 1);
    if (y > 0) nb.push(i - width);
    if (y < height - 1) nb.push(i + width);
    for (const n of nb) {
      if (label[n] === -1 && rgba[n * 4 + 3] !== 0) { label[n] = start; st.push(n); }
    }
  }
  if (comp.length > bestSize) { bestSize = comp.length; best = start; }
}
for (let i = 0; i < width * height; i++) {
  if (rgba[i * 4 + 3] !== 0 && label[i] !== best) rgba[i * 4 + 3] = 0;
}

// Crop to the opaque bounding box so the character fills the frame.
let minX = width, minY = height, maxX = 0, maxY = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (rgba[(y * width + x) * 4 + 3] !== 0) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
}
const pad = 6;
minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
const cw = maxX - minX + 1, chh = maxY - minY + 1;
const cropped = Buffer.alloc(cw * chh * 4);
for (let y = 0; y < chh; y++) {
  for (let x = 0; x < cw; x++) {
    const src = ((y + minY) * width + (x + minX)) * 4;
    const dst = (y * cw + x) * 4;
    cropped[dst] = rgba[src]; cropped[dst + 1] = rgba[src + 1]; cropped[dst + 2] = rgba[src + 2]; cropped[dst + 3] = rgba[src + 3];
  }
}

fs.writeFileSync(outPath, encodePNG(cw, chh, cropped));
console.log('wrote', path.basename(outPath), cw + 'x' + chh, '(cropped from ' + width + 'x' + height + ')');
