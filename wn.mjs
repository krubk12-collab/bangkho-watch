// โอกาสฝนหนัก (%) จาก Google WeatherNext 2 (64 ชุด ensemble) ผ่าน Open-Meteo — ไม่ต้องมีคีย์
// ข้อ 1: รายวันที่โรงเรียน 7 วัน · ข้อ 2: ฝนสะสม 3 วัน เหนือเขื่อน/ต้นน้ำ 15 วัน → wn.json บน branch status
// หน้า /water/ อ่าน wn.json ไปแสดง · Telegram แจ้งเมื่อระดับสูงขึ้น (ระดับกลับเป็นปกติ = รีเซ็ต)
// ข้อมูลเป็น "Experimental" → ข้อมูลประกอบ ไม่ขับระดับเตือนภัยใน assess.js
// env: OUT_DIR, FORCE=1 (ไม่รอครบรอบ), DRY_RUN=1, TG_TOKEN, TG_CHAT · ทดสอบ: node wn.mjs test
import fs from 'node:fs';

const OUT = process.env.OUT_DIR || '.';
const FILE = `${OUT}/wn.json`;
const EVERY_H = 3;                        // ponytail: Open-Meteo อัปเดต WeatherNext วันละ 2 รอบ ดึงทุก 3 ชม. พอ
const SITE = 'https://bangkho.ac.th/water/';
const HEAVY = 35.1, VHEAVY = 90.1;        // ฝนรายวัน กรมอุตุฯ (มม.)
const UP_HEAVY = 60, UP_VHEAVY = 120;     // ponytail: ฝนสะสม 3 วันต้นน้ำ ค่าตั้งต้น — ปรับหลังเก็บข้อมูล 1 ฤดู
const SCHOOL = [13.851028, 100.403063];
// จุดตัวแทนต้นน้ำ (กริด 25 กม. รอบจุด ไม่ใช่ฝนเฉลี่ยทั้งลุ่ม) · travel = วันที่น้ำเดินทางถึงนนทบุรีโดยประมาณ
const UP = [
  {id: 'bhumibol', name: 'เหนือเขื่อนภูมิพล', lat: 17.60, lon: 98.80, travel: '7–10'},
  {id: 'sirikit', name: 'เหนือเขื่อนสิริกิติ์', lat: 18.00, lon: 100.70, travel: '7–10'},
  {id: 'nsawan', name: 'นครสวรรค์ (ปิง-น่านรวม)', lat: 15.70, lon: 100.12, travel: '3–5'},
  {id: 'pasak', name: 'เหนือเขื่อนป่าสักฯ', lat: 15.20, lon: 101.10, travel: '2–4'},
];
const NAMES = ['ปกติ', 'ติดตาม', 'เฝ้าระวัง', 'เสี่ยงสูง'], ICON = ['🟢', '🟡', '🟠', '🔴'];

const pct = (n, t) => t ? Math.round(n / t * 100) : null;
const q = (a, p) => { const s = a.filter(v => v != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const r1 = v => v == null ? null : Math.round(v * 10) / 10;
export const level = (h, vh) => vh >= 30 || h >= 70 ? 3 : h >= 40 ? 2 : h >= 20 ? 1 : 0;
// ทุก member (control + member01..63) → [member][day] · ตัดชุดที่ว่างทั้งหมด
const members = d => Object.keys(d).filter(k => /^precipitation_sum(_member\d+)?$/.test(k)).map(k => d[k]).filter(a => a.some(v => v != null));

export function daily(loc) {
  const d = loc.daily, M = members(d);
  return d.time.slice(0, 7).map((date, i) => {
    const v = M.map(m => m[i]).filter(x => x != null), n = v.length;
    const h = pct(v.filter(x => x >= HEAVY).length, n), vh = pct(v.filter(x => x >= VHEAVY).length, n);
    return {date, n, rain: pct(v.filter(x => x >= 1).length, n), heavy: h, vheavy: vh, med: r1(q(v, .5)), p90: r1(q(v, .9)), lvl: level(h, vh)};
  });
}

// ฝนสะสม 3 วันแบบเลื่อน — member ที่ขาดข้อมูลวันใดวันหนึ่งไม่นับ (กันค่าต่ำเกินจริง)
export function upstream(loc) {
  const d = loc.daily, M = members(d), w = [];
  for (let i = 0; i + 2 < d.time.length; i++) {
    const s = M.filter(m => m[i] != null && m[i + 1] != null && m[i + 2] != null).map(m => m[i] + m[i + 1] + m[i + 2]), n = s.length;
    if (!n) continue;
    const h = pct(s.filter(x => x >= UP_HEAVY).length, n), vh = pct(s.filter(x => x >= UP_VHEAVY).length, n);
    w.push({from: d.time[i], to: d.time[i + 2], heavy: h, vheavy: vh, med: r1(q(s, .5)), p90: r1(q(s, .9)), lvl: level(h, vh)});
  }
  const worst = w.reduce((a, b) => !a || b.lvl > a.lvl || (b.lvl === a.lvl && b.heavy > a.heavy) ? b : a, null);
  return {worst, windows: w};
}

async function get(u) {
  for (let i = 0; ; i++) {
    try { const r = await fetch(u, {signal: AbortSignal.timeout(30000)}); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    catch (e) { if (i >= 2) throw e; await new Promise(ok => setTimeout(ok, 5000)); }
  }
}

export async function build() {
  const P = [{lat: SCHOOL[0], lon: SCHOOL[1]}, ...UP];
  const u = 'https://ensemble-api.open-meteo.com/v1/ensemble?' + new URLSearchParams({
    latitude: P.map(p => p.lat).join(','), longitude: P.map(p => p.lon).join(','),
    daily: 'precipitation_sum', forecast_days: '15', timezone: 'Asia/Bangkok', models: 'google_weathernext2_ensemble'});
  const j = await get(u), a = Array.isArray(j) ? j : [j];
  if (a.length !== P.length || !a[0].daily) throw new Error('ข้อมูลไม่ครบ');
  const school = daily(a[0]);
  if (!school[0].n) throw new Error('ไม่มี member');
  return {t: new Date().toISOString(), model: 'Google WeatherNext 2 (64 ชุด) ผ่าน Open-Meteo', th: {HEAVY, VHEAVY, UP_HEAVY, UP_VHEAVY},
    school, upstream: UP.map((p, i) => ({...p, ...upstream(a[i + 1])}))};
}

const thDay = s => { const d = new Date(s + 'T12:00:00+07:00'); return `${d.getDate()} ${['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][d.getMonth()]}`; };
export function message(W) {
  const L = [], sd = W.school.filter(d => d.lvl), up = W.upstream.filter(u => u.worst && u.worst.lvl);
  if (sd.length) L.push('<b>🌧️ โอกาสฝนหนักที่โรงเรียนชุมชนวัดบางโค</b>', ...sd.map(d =>
    `${ICON[d.lvl]} ${thDay(d.date)}: ${NAMES[d.lvl]} — ฝนหนัก ${d.heavy}% · หนักมาก ${d.vheavy}% · ค่ากลาง ${d.med} มม.`));
  if (up.length) L.push(...(L.length ? [''] : []), `<b>⛰️ ฝนสะสม 3 วัน พื้นที่ต้นน้ำ</b> (≥${UP_HEAVY} มม.)`, ...up.map(u =>
    `${ICON[u.worst.lvl]} ${u.name} ${thDay(u.worst.from)}–${thDay(u.worst.to)}: ${u.worst.heavy}% · ค่ากลาง ${u.worst.med} มม. (น้ำถึงนนทบุรีราว ${u.travel} วัน)`));
  if (!L.length) return null;
  return `${L.join('\n')}\n\n🔗 ${SITE}#fc\n<i>WeatherNext 2 (Google DeepMind) 64 ชุด · แบบจำลองทดลอง ไม่ใช่ประกาศทางการ ตรวจกับกรมอุตุฯ/ปภ.</i>`;
}

// ระดับสูงสุดต่อจุด → แจ้งเมื่อจุดใดสูงขึ้นกว่าที่เคยแจ้ง · จุดที่ลดลงให้ลดค่าที่จำไว้ด้วย (ขึ้นใหม่จะแจ้งอีก)
export const levels = W => ({school: Math.max(0, ...W.school.map(d => d.lvl)), ...Object.fromEntries(W.upstream.map(u => [u.id, u.worst ? u.worst.lvl : 0]))});

async function send(text) {
  if (process.env.DRY_RUN === '1' || !process.env.TG_TOKEN) { console.log('--- DRY_RUN ---\n' + text); return; }
  const r = await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chat_id: process.env.TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true})});
  const j = await r.json();
  if (!j.ok) throw new Error('telegram ' + (j.error_code || r.status));
}

function test() {
  const assert = (c, m) => { if (!c) throw new Error('FAIL ' + m); };
  const time = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
  // 64 ชุด: 32 ชุดวันแรก 50 มม. (หนัก 50%) · วันที่ 2 ชุดละ 100 (หนักมาก 100%)
  const d = {time, precipitation_sum: [50, 100, 30, 0]};
  for (let k = 1; k < 64; k++) d['precipitation_sum_member' + String(k).padStart(2, '0')] = [k < 32 ? 50 : 0, 100, k === 5 ? null : 30, 0];
  const s = daily({daily: d});
  assert(s[0].heavy === 50 && s[0].lvl === 2, 'day1 ' + JSON.stringify(s[0]));
  assert(s[1].vheavy === 100 && s[1].lvl === 3, 'day2');
  assert(s[2].n === 63 && s[2].heavy === 0, 'null ไม่นับ');
  const u = upstream({daily: d});
  assert(u.windows.length === 2, 'windows');
  assert(u.windows[0].heavy === 100 && u.worst.from === '2026-10-01', 'worst ' + JSON.stringify(u.worst));
  const W = {school: s, upstream: [{...UP[0], ...u}]};
  assert(message(W).includes('ฝนหนัก 50%'), 'msg');
  assert(message({school: [{lvl: 0}], upstream: []}) === null, 'ไม่มีอะไรเตือน = null');
  console.log('wn.mjs test ผ่าน');
}

async function main() {
  if (process.argv[2] === 'test') return test();
  const prev = (() => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } })();
  if (!process.env.FORCE && prev.t && Date.now() - Date.parse(prev.t) < EVERY_H * 36e5 - 5 * 60e3) { console.log('wn: ยังไม่ครบรอบ'); return; }
  let W;
  try { W = await build(); } catch (e) { console.log('wn: ข้ามรอบนี้ —', e.cause?.code || e.message); return; }
  const now = levels(W), sent = prev.sent || {};
  const up = Object.keys(now).some(k => now[k] > (sent[k] || 0));
  const next = up ? now : Object.fromEntries(Object.keys(now).map(k => [k, Math.min(sent[k] || 0, now[k])]));
  if (up) { const m = message(W); if (m) await send(m); }
  fs.writeFileSync(FILE, JSON.stringify({...W, sent: next}));
  console.log(`wn: โรงเรียนสูงสุด ${NAMES[now.school]}${up ? ' (ส่งแจ้งเตือนแล้ว)' : ''}`);
}
await main();
