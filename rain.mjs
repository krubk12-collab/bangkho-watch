// ฝนจริงที่โรงเรียนจากเรดาร์ RainViewer → radar.json {t(วินาที): dBZ สูงสุดรัศมี ~1.2 กม.} เก็บ 72 ชม.
// ใช้เป็น "ของจริง" ตรวจความแม่นพยากรณ์ (score.mjs) · สถานีวัดฝน สสน. ใกล้สุด 6.9 กม. ห่างเกินไป
// ภาพย้อนหลังมีแค่ ~2 ชม. ทุกรอบเก็บเฟรมที่ยังไม่มีไว้ (รอบ 10 นาทีเลื่อนได้ ไม่พลาดถ้าไม่หายเกิน 2 ชม.)
import fs from 'fs';
import zlib from 'zlib';

const OUT = process.env.OUT_DIR || '.';
const FILE = `${OUT}/radar.json`;
const SCHOOL = [13.851028, 100.403063];
const KEEP_S = 72 * 3600;
// สี Universal Blue ของ RainViewer (ตอนนี้ไทล์ส่งสีนี้อย่างเดียว ไม่สนพารามิเตอร์สี) dBZ 10..65
// ที่มา https://www.rainviewer.com/files/rainviewer_api_colors_table.csv
const HEX = 'cec087 d2c48b d6c88f dacc93 ded097 88ddee 6cd1eb 51c5e8 36bae5 1baee2 00a3e0 009ad5 0091ca 0088bf 007fb4 0077aa 0070a3 00699c 006295 005b8e 005588 005180 004e78 004a70 004768 ffee00 ffe000 ffd200 ffc500 ffb700 ffaa00 ff9f00 ff9500 ff8b00 ff8100 ff4400 f23600 e62800 d91b00 cd0d00 c10000 a80000 8f0000 760000 5d0000 ffaaff ff9fff ff95ff ff8bff ff81ff ff77ff ff6cff ff62ff ff58ff ff4eff ffffff'
  .split(' ').map((h, i) => [10 + i, parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4), 16)]);

export function dbz(r, g, b, a) {
  if (!a) return 0;
  let best = 0, bd = Infinity;
  for (const [z, R, G, B] of HEX) { const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2; if (d < bd) { bd = d; best = z; } }
  return best;
}

// PNG RGBA 8 บิต ไม่ interlace (แบบที่ RainViewer ส่ง) → Buffer พิกเซล
export function png(buf) {
  let o = 8, W, H, idat = [];
  while (o < buf.length) {
    const n = buf.readUInt32BE(o), t = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + n);
    if (t === 'IHDR') { W = d.readUInt32BE(0); H = d.readUInt32BE(4); if (d[8] !== 8 || d[9] !== 6) throw new Error('png ไม่ใช่ RGBA8'); }
    if (t === 'IDAT') idat.push(d);
    o += 12 + n;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), st = W * 4, px = Buffer.alloc(H * st);
  for (let y = 0; y < H; y++) {
    const f = raw[y * (st + 1)], s = y * (st + 1) + 1;
    for (let x = 0; x < st; x++) {
      const a = x >= 4 ? px[y * st + x - 4] : 0, b = y ? px[(y - 1) * st + x] : 0, c = x >= 4 && y ? px[(y - 1) * st + x - 4] : 0;
      let v = raw[s + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * st + x] = v & 255;
    }
  }
  return {W, H, px};
}

// ไทล์ที่ศูนย์กลางคือโรงเรียน → ค่าสูงสุดในช่อง 3×3 ตรงกลาง (z7 ช่องละ ~1.2 กม.)
export function centerMax({W, H, px}) {
  let m = 0;
  for (let y = (H >> 1) - 1; y <= (H >> 1) + 1; y++) for (let x = (W >> 1) - 1; x <= (W >> 1) + 1; x++) {
    const i = (y * W + x) * 4; m = Math.max(m, dbz(px[i], px[i + 1], px[i + 2], px[i + 3]));
  }
  return m;
}

async function get(url, as = 'json') {
  for (let k = 0; ; k++) {
    try { const r = await fetch(url, {signal: AbortSignal.timeout(20000)}); if (!r.ok) throw new Error('HTTP ' + r.status); return as === 'json' ? r.json() : Buffer.from(await r.arrayBuffer()); }
    catch (e) { if (k >= 2) throw e; await new Promise(r => setTimeout(r, 5000)); }
  }
}

function test() {
  const assert = (c, m) => { if (!c) throw new Error('FAIL ' + m); };
  assert(dbz(242, 54, 0, 255) === 46 && dbz(0, 112, 163, 255) === 26 && dbz(0, 0, 0, 0) === 0, 'สี');
  // PNG 3×3 ทำเอง: filter แบบ Sub/Up/Paeth ปนกัน ตรงกลางแดง 46 dBZ
  const W = 3, row = y => { const r = Buffer.alloc(W * 4); if (y === 1) r.set([242, 54, 0, 255], 4); return r; };
  const rows = [0, 1, 2].map(row), f = [1, 2, 4], enc = [];
  rows.forEach((r, y) => {
    const out = Buffer.alloc(r.length);
    for (let x = 0; x < r.length; x++) {
      const a = x >= 4 ? r[x - 4] : 0, b = y ? rows[y - 1][x] : 0, c = x >= 4 && y ? rows[y - 1][x - 4] : 0, p = a + b - c;
      const pr = f[y] === 1 ? a : f[y] === 2 ? b : (Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c);
      out[x] = (r[x] - pr) & 255;
    }
    enc.push(Buffer.from([f[y]]), out);
  });
  const chunk = (t, d) => { const h = Buffer.alloc(8); h.writeUInt32BE(d.length); h.write(t, 4); return Buffer.concat([h, d, Buffer.alloc(4)]); };
  const ihdr = Buffer.from([0, 0, 0, 3, 0, 0, 0, 3, 8, 6, 0, 0, 0]);
  const file = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(enc))), chunk('IEND', Buffer.alloc(0))]);
  assert(centerMax(png(file)) === 46, 'png ' + centerMax(png(file)));
  console.log('rain.mjs test ผ่าน');
}

async function main() {
  if (process.argv[2] === 'test') return test();
  const R = (() => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } })();
  const m = await get('https://api.rainviewer.com/public/weather-maps.json');
  let n = 0;
  for (const f of m.radar.past) {
    if (R[f.time] !== undefined) continue;
    try { R[f.time] = centerMax(png(await get(`${m.host}${f.path}/256/7/${SCHOOL[0]}/${SCHOOL[1]}/2/0_0.png`, 'buf'))); n++; }
    catch (e) { console.log('rain: เฟรม', f.time, 'ข้าม —', e.cause?.code || e.message); }
  }
  const cut = Math.floor(Date.now() / 1000) - KEEP_S;
  for (const t of Object.keys(R)) if (+t < cut) delete R[t];
  fs.writeFileSync(FILE, JSON.stringify(R));
  const last = Math.max(...Object.keys(R).map(Number));
  console.log(`rain: เฟรมใหม่ ${n} · ล่าสุด ${R[last]} dBZ · เก็บ ${Object.keys(R).length} เฟรม`);
}
await main();
