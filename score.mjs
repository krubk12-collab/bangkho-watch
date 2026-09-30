// ตรวจความแม่นพยากรณ์ฝนที่โรงเรียนย้อนหลัง จาก branch fclog (*.jsonl)
// ของจริง = เรดาร์ที่โรงเรียน (L.radar จาก rain.mjs) ≥20 dBZ (~ฝนเบา 0.6 มม./ชม.) ในช่วงนั้น = "ฝนตก"
// พยากรณ์ = รอบบันทึกล่าสุดก่อนช่วงเริ่ม (ไม่เกิน 24 ชม.) · % = ชม.สูงสุดในช่วง (แบบ dayPlan ของการ์ดหน้าแรก)
// ใช้: node score.mjs <โฟลเดอร์ fclog> <ไฟล์ออก>
import fs from 'node:fs';

export const RAIN_DBZ = 20, SAY_RAIN = 50;
export const PERIODS = [['เช้า', 6, 11], ['กลางวัน', 11, 15], ['บ่าย', 15, 18]];
const WN_FROM = Date.parse('2026-09-29T14:00Z');   // ก่อนหน้านี้ WeatherNext นับเกณฑ์ 0.2 มม. ไม่เทียบ
const at = (d, h) => Date.parse(`${d}T${String(h).padStart(2, '0')}:00:00+07:00`) / 1000;
const pmax = (arr, start, s, h) => {   // start = 'YYYY-MM-DDT00:00' เวลาไทย
  const i = Math.round((s - Date.parse(start + ':00+07:00') / 1000) / 3600), v = (arr || []).slice(i, i + h).filter(x => x != null);
  return i >= 0 && v.length === h ? Math.max(...v) : null;
};

function tally(rows, k) {
  const r = rows.filter(x => x[k] != null);
  const c = {n: r.length, hit: 0, miss: 0, fa: 0, cn: 0, brier: 0};
  for (const x of r) {
    const say = x[k] >= SAY_RAIN;
    c[say ? (x.rain ? 'hit' : 'fa') : (x.rain ? 'miss' : 'cn')]++;
    c.brier += (x[k] / 100 - (x.rain ? 1 : 0)) ** 2;
  }
  if (c.n) { c.acc = Math.round((c.hit + c.cn) / c.n * 100); c.brier = +(c.brier / c.n).toFixed(3); }
  return c;
}

export function score(lines, now = Date.now() / 1000) {
  lines = lines.filter(L => L && L.t).sort((a, b) => a.t < b.t ? -1 : 1);
  const R = {};
  for (const L of lines) Object.assign(R, L.radar || {});
  const ts = Object.keys(R).map(Number);
  if (!ts.length) return {t: new Date(now * 1000).toISOString(), rows: [], all: {}, byPer: {}};
  const rows = [];
  const d0 = new Date((Math.min(...ts) + 7 * 3600) * 1000).toISOString().slice(0, 10);
  for (let d = d0; at(d, 0) < now; d = new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10)) {
    for (const [per, h1, h2] of PERIODS) {
      const s = at(d, h1), e = at(d, h2);
      if (e > now) continue;
      const fr = ts.filter(t => t >= s && t < e);
      if (fr.length < (h2 - h1) * 6 * 0.7) continue;       // เรดาร์ขาดเกิน 30% = ไม่ตัดสิน
      const L = lines.filter(x => Date.parse(x.t) / 1000 <= s).pop();
      if (!L || s - Date.parse(L.t) / 1000 > 24 * 3600) continue;
      const dbz = Math.max(...fr.map(t => R[t]));
      rows.push({d, per, dbz, rain: dbz >= RAIN_DBZ, lead: Math.round((s - Date.parse(L.t) / 1000) / 3600),
        om: L.om ? pmax(L.om.p, L.om.start, s, h2 - h1) : null,
        wn: L.wn && Date.parse(L.t) >= WN_FROM ? pmax(L.wn.wet, L.wn.start, s, h2 - h1) : null});
    }
  }
  const byPer = Object.fromEntries(PERIODS.map(([p]) => [p, {om: tally(rows.filter(x => x.per === p), 'om'), wn: tally(rows.filter(x => x.per === p), 'wn')}]));
  return {t: new Date(now * 1000).toISOString(), th: {dbz: RAIN_DBZ, say: SAY_RAIN}, all: {om: tally(rows, 'om'), wn: tally(rows, 'wn')}, byPer, rows: rows.slice(-45)};
}

// สรุปทุกเช้าทาง Telegram: ผลเมื่อวานรายช่วง + ความแม่นสะสม · ไม่มีข้อมูลเลย = null (ไม่ส่ง)
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export function morning(S, yday) {
  if (!S.all.om || !(S.all.om.n || S.all.wn.n)) return null;
  const d = new Date(yday + 'T12:00:00+07:00'), f = v => v == null ? '–' : v + '%';
  const mark = (v, rain) => v == null ? '' : (v >= S.th.say) === rain ? '✅' : '❌';
  const acc = c => c.n ? `${c.acc}% (${c.hit + c.cn}/${c.n})` : '–';
  const L = [`<b>📊 พยากรณ์ฝนแม่นแค่ไหน</b> — เมื่อวาน ${d.getDate()} ${TH_MON[d.getMonth()]}`];
  const ys = S.rows.filter(r => r.d === yday);
  L.push(...(ys.length ? ys.map(r => `${r.per}: ${r.rain ? '☔ ฝนตก' : '☀️ ไม่ตก'} · Open-Meteo ${f(r.om)}${mark(r.om, r.rain)} · WeatherNext ${f(r.wn)}${mark(r.wn, r.rain)}`)
    : ['(เมื่อวานเรดาร์ไม่ครบ ไม่ได้ตัดสิน)']));
  L.push('', '<b>สะสม</b>', `Open-Meteo ${acc(S.all.om)}`, `WeatherNext ${acc(S.all.wn)}`,
    ...PERIODS.map(([p]) => `· ${p}: OM ${S.byPer[p].om.n ? S.byPer[p].om.acc + '%' : '–'} · WN ${S.byPer[p].wn.n ? S.byPer[p].wn.acc + '%' : '–'}`));
  return L.join('\n') + `\n\n🔗 https://bangkho.ac.th/water/#c-fc
<i>✅ = พยากรณ์ถูก (≥${S.th.say}% = บอกว่าฝน) · ของจริง = เรดาร์ตรงโรงเรียน ≥${S.th.dbz} dBZ</i>`;
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
  // 1 ต.ค. 69: พยากรณ์ออก 05:00 · ฝนตกช่วงบ่ายจริง (เรดาร์ 40) ช่วงอื่นแห้ง
  const radar = {};
  for (let t = at('2026-10-01', 6); t < at('2026-10-01', 18); t += 600) radar[t] = t >= at('2026-10-01', 15) ? 40 : 0;
  const p = Array(72).fill(0); p[16] = 80; p[7] = 60;           // บ่าย 80% (ถูก) · เช้า 60% (ผิด = เตือนเกิน)
  const L = {t: '2026-09-30T22:00:00Z', om: {start: '2026-10-01T00:00', p}, wn: {start: '2026-10-01T00:00', wet: Array(72).fill(10)}, radar};
  const S = score([L], at('2026-10-01', 20));
  assert(S.rows.length === 3, 'rows ' + S.rows.length);
  const b = S.rows.find(x => x.per === 'บ่าย');
  assert(b.rain && b.om === 80 && b.wn === 10 && b.lead === 10, 'บ่าย ' + JSON.stringify(b));
  assert(S.all.om.hit === 1 && S.all.om.fa === 1 && S.all.om.cn === 1 && S.all.om.acc === 67, 'om ' + JSON.stringify(S.all.om));
  assert(S.all.wn.miss === 1 && S.all.wn.cn === 2, 'wn ' + JSON.stringify(S.all.wn));
  // ช่วงที่ยังไม่จบ / เรดาร์ขาด ไม่ตัดสิน
  assert(score([L], at('2026-10-01', 16)).rows.length === 2, 'ยังไม่จบ');
  const hole = {...L, radar: Object.fromEntries(Object.entries(radar).filter(([t]) => +t < at('2026-10-01', 16)))};
  assert(!score([hole], at('2026-10-01', 20)).rows.some(x => x.per === 'บ่าย'), 'เรดาร์ขาด');
  const m = morning(S, '2026-10-01');
  assert(m.includes('บ่าย: ☔ ฝนตก · Open-Meteo 80%✅ · WeatherNext 10%❌') && m.includes('Open-Meteo 67% (2/3)'), 'morning ' + m);
  assert(morning(score([], 0), '2026-10-01') === null, 'ว่าง = ไม่ส่ง');
  console.log('score.mjs test ผ่าน');
}

if (process.argv[2] === 'test') test();
else if (process.argv[2]) {
  const dir = process.argv[2], lines = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort())
    for (const s of fs.readFileSync(`${dir}/${f}`, 'utf8').split('\n')) { try { if (s) lines.push(JSON.parse(s)); } catch {} }
  const S = score(lines);
  fs.writeFileSync(process.argv[3] || `${dir}/score.json`, JSON.stringify(S));
  console.log(`score: ${S.rows.length} ช่วง · Open-Meteo ${S.all.om?.acc ?? '-'}% · WeatherNext ${S.all.wn?.acc ?? '-'}%`);
  // ส่งสรุปวันละครั้ง รอบแรกที่รันช่วง 06:00–11:59 (ขั้น fclog รันทุก ~3 ชม.) · จำวันที่ส่งไว้ใน fclog/tg-sent.txt
  const bkk = new Date(Date.now() + 7 * 36e5), today = bkk.toISOString().slice(0, 10), h = bkk.getUTCHours();
  const SENT = `${dir}/tg-sent.txt`, last = fs.existsSync(SENT) ? fs.readFileSync(SENT, 'utf8').trim() : '';
  if ((h >= 6 && h < 12 || process.env.FORCE_TG) && last !== today) {
    const m = morning(S, new Date(Date.now() + 7 * 36e5 - 864e5).toISOString().slice(0, 10));
    if (m) try { await send(m); fs.writeFileSync(SENT, today); console.log('score: ส่งสรุปเช้าแล้ว'); } catch (e) { console.log('score: ส่ง Telegram ไม่ได้ —', e.message); }
  }
}
