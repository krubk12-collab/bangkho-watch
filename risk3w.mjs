// ความเสี่ยงน้ำท่วมโรงเรียนล่วงหน้า 4 สัปดาห์ (ฝ่ายบริหารขอ ช่วงปิดเทอม 3–27 ต.ค. 69) → risk3w.json บน branch status
// 3 ปัจจัย: น้ำเหนือ = GloFAS 51 ชุดที่ C.13 ชัยนาท ปรับสเกลด้วยค่าจริงกรมชลฯ (GloFAS ดิบสูงเกินจริง ~2 เท่า)
//          ฝนที่โรงเรียน = ECMWF 51 ชุด (≤15 วัน) / GFS 31 ชุด (สัปดาห์ 3–4) · น้ำเกิด = ข้างขึ้น/แรม 15 ค่ำ ±2 วัน (คำนวณจากดวงจันทร์)
// ไม่ขับ assess.js · ไม่ใช่ประกาศทางการ · env: OUT_DIR, FORCE=1, DRY_RUN=1, TG_TOKEN, TG_CHAT · ทดสอบ: node risk3w.mjs test
import fs from 'node:fs';

const OUT = process.env.OUT_DIR || '.';
const FILE = `${OUT}/risk3w.json`;
const EVERY_H = 6;                         // GloFAS ออกวันละรอบ
const SITE = 'https://bangkho.ac.th/water/';
const SCHOOL = [13.851028, 100.403063];
const C13 = [15.175, 100.075];             // ช่องกริด GloFAS บนแม่น้ำสายหลักใกล้ C.13 (หาจากช่องที่น้ำมากสุดรอบสถานี)
// ponytail: เกณฑ์ตั้งต้น — C.13 2,500 = เกณฑ์เฝ้าระวังเดิมใน assess.js · 3,500 ≈ ใกล้ปี 54 (ยอด ~3,700) · ฝน 100 มม./สัปดาห์
// ปรับหลังเก็บผลจริงช่วงปิดเทอม
const Q_WATCH = 2500, Q_54 = 3500, RAIN_WK = 100;
const DAILY_UNTIL = '2026-10-27';          // ส่งสรุปทุกเช้าถึงวันเปิดเทอม หลังจากนั้นส่งเมื่อระดับสูงขึ้นเท่านั้น
export const NAMES = ['ต่ำ', 'เฝ้าระวัง', 'น้ำอาจเข้าโดม/ลาน', 'เสี่ยงแบบปี 54'], ICON = ['🟢', '🟡', '🟠', '🔴'];

const pct = (n, t) => t ? Math.round(n / t * 100) : null;
const q = (a, p) => { const s = a.filter(v => v != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const addDay = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const members = (d, key) => Object.keys(d).filter(k => k === key || k.startsWith(key + '_member')).map(k => d[k]).filter(a => a.some(v => v != null));

// ข้างขึ้น/แรม 15 ค่ำ ±2 วัน = น้ำเกิด (ช่วง ต.ค.–พ.ย. น้ำทะเลหนุนสูงสุดของปี)
export function spring(date) {
  const age = ((Date.parse(date + 'T12:00:00+07:00') - Date.UTC(2000, 0, 6, 18, 14)) / 864e5) % 29.530588853;
  const a = (age + 29.530588853) % 29.530588853;
  return Math.min(a, Math.abs(a - 14.765), 29.530588853 - a) <= 2;
}

export function level(w) {
  const n = w.north || {}, r = w.rain || {};
  if (n.p54 >= 30) return 3;
  if ((n.pWatch >= 50 && (w.spring.length || r.p >= 30)) || r.p >= 60) return 2;
  if (n.pWatch >= 30 || r.p >= 30 || (w.spring.length && n.pWatch >= 10)) return 1;
  return 0;
}

// days = วันที่ของสัปดาห์ · north: GloFAS daily ensemble (ค่าดิบ) · scale = ค่าจริง/ค่า GloFAS วันนี้
export function weeks(start, {glofas, scale, ec, gfs}) {
  const W = [];
  for (let k = 0; k < 4; k++) {
    const days = [...Array(7)].map((_, i) => addDay(start, k * 7 + i));
    const w = {from: days[0], to: days[6], spring: days.filter(spring), north: null, rain: null};
    if (glofas && scale) {
      const idx = days.map(d => glofas.daily.time.indexOf(d)).filter(i => i >= 0);
      const mx = members(glofas.daily, 'river_discharge').map(m => Math.max(...idx.map(i => m[i] ?? 0)) * scale).filter(v => v > 0);
      if (idx.length >= 4 && mx.length) w.north = {n: mx.length, pWatch: pct(mx.filter(v => v >= Q_WATCH).length, mx.length),
        p54: pct(mx.filter(v => v >= Q_54).length, mx.length), med: Math.round(q(mx, .5)), p90: Math.round(q(mx, .9))};
    }
    for (const [src, j] of [['ECMWF', ec], ['GFS', gfs]]) {
      if (!j) continue;
      const idx = days.map(d => j.daily.time.indexOf(d));
      const M = members(j.daily, 'precipitation_sum').filter(m => idx.every(i => i >= 0 && m[i] != null));
      if (idx.some(i => i < 0) || !M.length) continue;
      const tot = M.map(m => idx.reduce((s, i) => s + m[i], 0));
      w.rain = {src, n: tot.length, p: pct(tot.filter(v => v >= RAIN_WK).length, tot.length), med: Math.round(q(tot, .5)), p90: Math.round(q(tot, .9))};
      break;
    }
    w.lvl = level(w);
    W.push(w);
  }
  return W;
}

// ประกาศปฏิบัติการน้ำ (กรมชลฯ ฯลฯ) จาก SLIC FloodDash — CC-BY-4.0 ต้องให้เครดิต · เจ้าของเว็บส่งต่อจากข่าว ไม่ใช่ API ทางการ
export function bulletins(fd, now = Date.now()) {
  const txt = b => b.title_th + b.area_th + JSON.stringify(b.items || []);
  return ((fd && fd.bulletins) || []).filter(b => (!b.expires_at || Date.parse(b.expires_at) > now) && /เจ้าพระยา|ป่าสัก|นนทบุรี/.test(txt(b)))
    .slice(0, 4).map(b => ({title: b.title_th, at: b.published_at, until: b.expires_at, by: b.publisher_th,
      nont: /นนทบุรี/.test(txt(b)), items: (b.items || []).map(i => i.th).slice(0, 8)}));
}

async function get(url) {
  for (let k = 0; ; k++) {
    try { const r = await fetch(url, {signal: AbortSignal.timeout(40000)}); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
    catch (e) { if (k >= 2) throw e; await new Promise(r => setTimeout(r, 10000)); }
  }
}
const tryGet = async (name, url) => { try { return await get(url); } catch (e) { console.log(`risk3w: ${name} ข้าม —`, e.cause?.code || e.message); return null; } };

async function build() {
  const today = new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 10);
  const ens = (m, days) => `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${SCHOOL[0]}&longitude=${SCHOOL[1]}&daily=precipitation_sum&forecast_days=${days}&models=${m}&timezone=Asia/Bangkok`;
  const [glofas, ec, gfs, api, fd] = await Promise.all([
    tryGet('GloFAS', `https://flood-api.open-meteo.com/v1/flood?latitude=${C13[0]}&longitude=${C13[1]}&daily=river_discharge&forecast_days=35&ensemble=true`),
    tryGet('ECMWF', ens('ecmwf_ifs025', 15)), tryGet('GFS', ens('ncep_gefs05', 35)), tryGet('api.php', SITE + 'api.php'), tryGet('FloodDash', 'https://flood.nonarkara.org/api/bulletins')]);
  const rid = api && api.rid && api.rid.c13 ? {q: api.rid.c13.q, date: api.rid.date} : null;
  let scale = null;
  if (glofas && rid) {
    const i = glofas.daily.time.indexOf(today), g = q(members(glofas.daily, 'river_discharge').map(m => m[i]), .5);
    if (g > 0) scale = rid.q / g;
  }
  if (!scale && !ec && !gfs) throw new Error('ไม่มีข้อมูลเลย');
  const W = weeks(today, {glofas, scale, ec, gfs}), bul = bulletins(fd);
  // แผนระบายเขื่อนที่แบบจำลองไม่รู้: ประกาศกรมชลฯ ที่ยังไม่หมดอายุและเตือนนนทบุรี → สัปดาห์ 1 อย่างน้อยเฝ้าระวัง
  if (bul.some(b => b.nont)) { W[0].lvl = Math.max(W[0].lvl, 1); W[0].bulletin = true; }
  return {t: new Date().toISOString(), today, c13: rid, scale: scale && +scale.toFixed(3),
    th: {watch: Q_WATCH, y54: Q_54, rain: RAIN_WK}, weeks: W, bulletins: bul};
}

const thD = s => { const d = new Date(s + 'T12:00:00+07:00'); return `${d.getDate()} ${['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][d.getMonth()]}`; };
export function message(R) {
  const L = ['<b>🏫 ความเสี่ยงน้ำท่วมโรงเรียนชุมชนวัดบางโค 4 สัปดาห์ข้างหน้า</b>'];
  if (R.c13) L.push(`น้ำไหลผ่านชัยนาท (C.13) ล่าสุด ${R.c13.q.toLocaleString()} ลบ.ม./วิ`);
  for (const w of R.weeks) {
    const n = w.north, r = w.rain, b = [];
    if (n) b.push(`น้ำเหนือ C.13 ~${n.med.toLocaleString()} (โอกาสเกิน ${R.th.watch.toLocaleString()}: ${n.pWatch}%)`);
    if (r) b.push(`ฝน ≥${R.th.rain} มม./สัปดาห์ ${r.p}%`);
    if (w.spring.length) b.push(`น้ำเกิด ${thD(w.spring[0])}–${thD(w.spring[w.spring.length - 1])}`);
    L.push('', `${ICON[w.lvl]} <b>${thD(w.from)}–${thD(w.to)}: ${NAMES[w.lvl]}</b>`, b.join(' · '));
  }
  if (R.bulletins && R.bulletins.length) L.push('', '<b>📢 ประกาศกรมชลฯ ที่ยังมีผล</b>', ...R.bulletins.map(b => '• ' + b.title), '<i>ผ่าน SLIC FloodDash (flood.nonarkara.org, CC-BY-4.0)</i>');
  return L.join('\n') + `\n\n🔗 ${SITE}#risk3w\n<i>ประเมินจากแบบจำลอง (GloFAS/ECMWF/GFS) ความแม่นลดลงตามระยะ สัปดาห์ 3–4 เป็นแนวโน้ม · ไม่ใช่ประกาศทางการ ติดตามกรมชลประทาน/ปภ.</i>`;
}

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
  assert(spring('2026-10-26') && !spring('2026-10-18'), 'น้ำเกิด 26 ต.ค. (เพ็ญ) / 18 ต.ค. ไม่ใช่');
  const time = [...Array(35)].map((_, i) => addDay('2026-10-01', i));
  // GloFAS ดิบ 2 เท่าของจริง: 51 ชุด ชุดละ 5000 ลดวันละ 100 · 10 ชุดพุ่ง 8000 ในสัปดาห์ 2
  const glofas = {daily: {time}};
  for (let k = 0; k < 51; k++) glofas.daily[k ? 'river_discharge_member' + String(k).padStart(2, '0') : 'river_discharge'] = time.map((_, i) => k < 10 && i >= 7 && i < 14 ? 8000 : 5000 - 100 * i);
  const ec = {daily: {time: time.slice(0, 15)}};
  for (let k = 0; k < 51; k++) ec.daily[k ? 'precipitation_sum_member' + String(k).padStart(2, '0') : 'precipitation_sum'] = time.slice(0, 15).map((_, i) => i < 7 && k < 40 ? 20 : 0);
  const W = weeks('2026-10-01', {glofas, scale: 0.5, ec, gfs: null});
  assert(W[0].north.med === 2500 && W[0].north.pWatch === 100 && W[0].rain.src === 'ECMWF' && W[0].rain.p === 78, 'w1 ' + JSON.stringify(W[0]));
  assert(W[0].lvl === 2, 'w1 lvl ' + W[0].lvl);
  assert(W[1].north.p54 === 20 && W[1].lvl === 1 && W[1].rain.p === 0, 'w2 ' + JSON.stringify(W[1]));
  assert(W[2].rain === null && W[3].north.pWatch === 0, 'w3 ฝนไม่มีแหล่ง / w4 น้ำลด');
  assert(message({c13: {q: 2200}, th: {watch: 2500, rain: 100}, weeks: W}).includes('🟠'), 'msg');
  const fd = {bulletins: [{title_th: 'กรมชลฯ เพิ่มระบาย', area_th: 'ลุ่มเจ้าพระยาตอนล่าง', expires_at: '2026-10-01T00:00:00+07:00', items: [{th: 'แจ้งเตือน ปทุมธานี นนทบุรี'}]},
    {title_th: 'เก่า', area_th: 'เจ้าพระยา', expires_at: '2026-09-01T00:00:00+07:00'}, {title_th: 'ภาคใต้', area_th: 'พัทลุง'}]};
  const B = bulletins(fd, Date.parse('2026-09-30T12:00:00+07:00'));
  assert(B.length === 1 && B[0].nont, 'bulletins ' + JSON.stringify(B));
  console.log('risk3w.mjs test ผ่าน');
}

async function main() {
  if (process.argv[2] === 'test') return test();
  const prev = (() => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } })();
  if (!process.env.FORCE && prev.t && Date.now() - Date.parse(prev.t) < EVERY_H * 36e5 - 5 * 60e3) { console.log('risk3w: ยังไม่ครบรอบ'); return; }
  let R;
  try { R = await build(); } catch (e) { console.log('risk3w: ข้ามรอบนี้ —', e.message); return; }
  const h = new Date(Date.now() + 7 * 36e5).getUTCHours(), top = Math.max(...R.weeks.map(w => w.lvl));
  const daily = R.today <= DAILY_UNTIL && h >= 6 && h < 12 && prev.sentDay !== R.today;
  R.sentDay = prev.sentDay; R.sentLvl = Math.min(prev.sentLvl ?? 0, top);
  if (daily || top > (prev.sentLvl ?? 0) || process.env.FORCE_TG) {
    try { await send(message(R)); R.sentDay = R.today; R.sentLvl = top; } catch (e) { console.log('risk3w: ส่ง Telegram ไม่ได้ —', e.message); }
  }
  fs.writeFileSync(FILE, JSON.stringify(R));
  console.log('risk3w:', R.weeks.map(w => `${w.from} ${NAMES[w.lvl]}`).join(' · '));
}
await main();
