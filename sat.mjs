// 🛰️🧪 เมฆก่อตัวรอบโรงเรียนจากดาวเทียม Himawari-9 (อินฟราเรด B13 ของ JMA) → satci.json {validtime วินาที: [จุด, กม., ทิศ 0-7, สว่างสุด, dBZ จริงที่ รร. 60 นาทีถัดไป]} เก็บ 14 วัน
// หลัก: ยอดเมฆที่พุ่งสูงจะเย็นลง = ภาพอินฟราเรดสว่างขึ้นเร็ว · นับจุด (ซูม 5 ~4.75 กม./จุด) รัศมี ~62 กม. ที่ สว่าง ≥90 และสว่างขึ้น ≥20 ใน 20 นาที
// เกณฑ์ตั้งจากข้อมูลจริง 15ต.ค.69: ฝนเข้า รร. 13:40 ดาวเทียมเห็นตั้งแต่ 12:50 · แต่ฝนลูกเล็ก 11:30 วันเดียวกันดาวเทียมไม่เห็นเลย (เล็กกว่า 1 จุด)
// ไฟล์นี้มีไว้ "บันทึก" เทียบกับ radar.json (ฝนจริงที่ รร.) ก่อนเอาป้าย 🧪 ออก — หน้าเว็บคำนวณเองสดใน /water/wxcard.js (satCI ต้องตรงกัน)
// ทดสอบ: node sat.mjs test
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const OUT = process.env.OUT_DIR || '.';
const FILE = `${OUT}/satci.json`;
const KEEP_S = 14 * 86400;
const JMA = 'https://www.jma.go.jp/bosai/himawari/data/satimg/';
const CX = 236.7, CY = 193.6, R = 13;   // โรงเรียนในแผ่นซูม 5 x=24 y=14

// A = ภาพล่าสุด, B = 20 นาทีก่อน (ค่าเทา 256×256) → {n, km, dir, v}
export function satCI(A, B) {
  let n = 0, v = 0, best = -1, bx = 0, by = 0;   // ตำแหน่ง = จุดที่สว่างขึ้นเร็วสุด
  for (let y = Math.floor(CY - R); y <= CY + R; y++) for (let x = Math.floor(CX - R); x <= CX + R; x++) {
    if ((x - CX) ** 2 + (y - CY) ** 2 > R * R) continue;
    const i = y * 256 + x, d = A[i] - B[i];
    if (A[i] >= 90 && d >= 20) { n++; v = Math.max(v, A[i]); if (d > best) { best = d; bx = x; by = y; } }
  }
  if (n < 2) return {n, km: null, dir: null, v};
  const dx = bx - CX, dy = by - CY;
  return {n, km: Math.round(Math.hypot(dx, dy) * 4.75), dir: Math.round(((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360) / 45) % 8, v};
}

const gray = buf => execFileSync('ffmpeg', ['-loglevel', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], {input: buf, maxBuffer: 1 << 20});
const tile = f => fetch(`${JMA}${f.basetime}/fd/${f.validtime}/B13/TBB/5/24/14.jpg`, {signal: AbortSignal.timeout(20000)})
  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }).then(b => gray(Buffer.from(b)));
const sec = s => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12)) / 1000;

function test() {
  const A = new Uint8Array(65536).fill(40), B = new Uint8Array(65536).fill(40);
  if (satCI(A, B).n !== 0) throw new Error('FAIL ฟ้าโล่ง');
  for (const [x, y] of [[237, 184], [238, 184], [237, 185]]) A[y * 256 + x] = 150;   // เมฆโตเร็ว ทางเหนือ ~45 กม.
  const r = satCI(A, B);
  if (r.n !== 3 || r.dir !== 0 || r.km < 40 || r.km > 50 || r.v !== 150) throw new Error('FAIL ' + JSON.stringify(r));
  A[184 * 256 + 237] = 60; B.fill(140);   // สว่างแต่ไม่ได้สว่างขึ้น = เมฆเดิม ไม่นับ
  if (satCI(A, B).n !== 0) throw new Error('FAIL เมฆเดิม');
  console.log('sat.mjs test ผ่าน');
}

async function main() {
  if (process.argv[2] === 'test') return test();
  const S = (() => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } })();
  const tt = await (await fetch(JMA + 'targetTimes_fd.json', {signal: AbortSignal.timeout(20000)})).json();
  const got = {};   // แคชภาพในรอบนี้ — เฟรมหนึ่งใช้ทั้งเป็น "ล่าสุด" และ "20 นาทีก่อน"
  const img = f => got[f.validtime] ??= tile(f);
  let n = 0;
  for (let k = Math.max(2, tt.length - 6); k < tt.length; k++) {   // ย้อน 1 ชม. เติมรอบที่พลาด
    const t = sec(tt[k].validtime);
    if (S[t]) continue;
    try { const r = satCI(await img(tt[k]), await img(tt[k - 2])); S[t] = [r.n, r.km, r.dir, r.v]; n++; }
    catch (e) { console.log('sat: เฟรม', tt[k].validtime, 'ข้าม —', e.message); }
  }
  // เฉลยย้อนหลัง: ฝนจริงที่ รร. สูงสุดใน 60 นาทีหลังภาพ (radar.json จาก rain.mjs ที่รันก่อนขั้นนี้ เก็บแค่ 72 ชม. เลยจดติดไว้ที่นี่)
  const RD = (() => { try { return JSON.parse(fs.readFileSync(`${OUT}/radar.json`, 'utf8')); } catch { return {}; } })();
  const rmax = Math.max(0, ...Object.keys(RD).map(Number));
  for (const [t, e] of Object.entries(S)) if (e.length === 4 && +t + 3600 <= rmax) {
    const z = Object.entries(RD).filter(([k]) => +k > +t && +k <= +t + 3600).map(([, v]) => v);
    if (z.length) e.push(Math.max(...z));
  }
  const cut = Date.now() / 1000 - KEEP_S;
  for (const t of Object.keys(S)) if (+t < cut) delete S[t];
  fs.writeFileSync(FILE, JSON.stringify(S));
  const last = Math.max(...Object.keys(S).map(Number));
  console.log(`sat: เฟรมใหม่ ${n} · ล่าสุด ${JSON.stringify(S[last])} · เก็บ ${Object.keys(S).length} เฟรม`);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
