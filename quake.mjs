// แผ่นดินไหว → quake.json (หน้า /quake/ อ่าน TMD จากที่นี่ เพราะ RSS กรมอุตุฯ ไม่มี CORS) + Telegram
// เตือนเมื่อ: M≥4.5 ในรัศมี 1,500 กม. จากโรงเรียน (USGS หรือกรมอุตุฯ) หรือกรมอุตุฯ รายงานจุดศูนย์กลางในประเทศไทย M≥3
// env: OUT_DIR, DRY_RUN=1, TG_TOKEN, TG_CHAT · ทดสอบ: node quake.mjs test
import fs from 'node:fs';

const OUT = process.env.OUT_DIR || '.';
const FILE = `${OUT}/quake.json`;
const SITE = 'https://bangkho.ac.th/quake/';
const SCHOOL = [13.851028, 100.403063];
const NEAR_KM = 1500, NEAR_M = 4.5, TH_M = 3.0, FRESH_H = 3, KEEP_D = 30;
const TMD = 'https://earthquake.tmd.go.th/feed/rss_tmd.xml';
const USGS = 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=time';

export const km = (a, b, c, d) => {
  const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
};
// ความรุนแรงที่โรงเรียนโดยประมาณ (Allen, Wald & Worden 2012 IPE, หินแข็ง) · ดินอ่อน กทม.-นนท์ มักแรงกว่านี้ ~1 ระดับ
// ponytail: สูตรเดียวกับ ipe() ใน /quake/index.html — แก้ต้องแก้ทั้งสองที่
export const ipe = (M, distKm, depthKm) => {
  const R = Math.hypot(distKm, depthKm || 10), Rm = 1 + 0.078 * Math.exp(M - 5);
  return Math.max(1, 2.085 + 1.428 * M - 1.402 * Math.log(Math.hypot(R, Rm)) + (R > 50 ? -0.209 * Math.log(R / 50) : 0));
};
const FEEL = ['', 'ไม่รู้สึก', 'ไม่รู้สึก', 'บางคนบนตึกสูงรู้สึก', 'รู้สึกเบา ๆ ของแขวนแกว่ง', 'คนส่วนใหญ่รู้สึก ของตกได้', 'รู้สึกชัด อาคารอาจร้าว', 'อาคารเสียหาย', 'อาคารเสียหายมาก'];
export const feel = mmi => FEEL[Math.min(8, Math.floor(mmi))];

export function parseTmd(xml) {
  const tag = (s, t) => (s.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1]?.trim() ?? '';
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, s]) => ({
    id: 'tmd' + (tag(s, 'link').match(/earthquake=(\d+)/) || [])[1],
    src: 'tmd', place: tag(s, 'title'), near: tag(s, 'comments'),
    lat: +tag(s, 'geo:lat'), lon: +tag(s, 'geo:long'), depth: +tag(s, 'tmd:depth'), mag: +tag(s, 'tmd:magnitude'),
    time: Date.parse(tag(s, 'tmd:time').replace(' UTC', 'Z').replace(' ', 'T')),
  })).filter(e => e.lat && e.time);
}
const fromUsgs = f => ({id: f.id, src: 'usgs', place: f.properties.place, mag: f.properties.mag, time: f.properties.time,
  lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], depth: f.geometry.coordinates[2], url: f.properties.url});

// เหตุการณ์เดียวกันจากสองแหล่ง = ห่างกัน ≤3 นาที และ ≤150 กม.
export const same = (a, b) => Math.abs(a.time - b.time) <= 180e3 && km(a.lat, a.lon, b.lat, b.lon) <= 150;
export const inThai = e => e.src === 'tmd' && !/ประเทศ|ทะเล|หมู่เกาะ|ชายฝั่ง|พรมแดน/.test(e.place);
export const worth = e => {
  const d = km(SCHOOL[0], SCHOOL[1], e.lat, e.lon);
  return (e.mag >= NEAR_M && d <= NEAR_KM) || (inThai(e) && e.mag >= TH_M);
};

export function pick(events, sent, now) {
  const out = [];
  for (const e of events.sort((a, b) => b.mag - a.mag)) {
    if (now - e.time > FRESH_H * 36e5 || !worth(e)) continue;
    if (sent.some(s => s.id === e.id || same(s, e)) || out.some(s => same(s, e))) continue;
    out.push(e);
  }
  return out;
}

const thTime = t => new Date(t).toLocaleString('th-TH', {timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short'});
export function message(e) {
  const d = km(SCHOOL[0], SCHOOL[1], e.lat, e.lon), m = ipe(e.mag, d, e.depth);
  return [`🌏 <b>แผ่นดินไหว ขนาด ${e.mag.toFixed(1)}</b> · ${e.place}`,
    `🕒 ${thTime(e.time)} · ลึก ${Math.round(e.depth)} กม.`,
    e.near ? `📍 ${e.near}` : '',
    `🏫 ห่างโรงเรียน ${Math.round(d).toLocaleString()} กม. · ที่โรงเรียนคาดว่า: ${feel(m)} (ระดับ ${Math.floor(m)})`,
    '', `🔗 ${SITE}`, `<i>${e.src === 'tmd' ? 'กรมอุตุนิยมวิทยา' : 'USGS'} · ความรุนแรงที่โรงเรียนเป็นค่าประมาณจากสูตร ไม่ใช่ค่าวัดจริง</i>`]
    .filter((l, i) => l || i === 4).join('\n');
}

async function send(text) {
  if (process.env.DRY_RUN === '1' || !process.env.TG_TOKEN) { console.log('--- DRY_RUN ---\n' + text); return; }
  const r = await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chat_id: process.env.TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true})});
  const j = await r.json();
  if (!j.ok) throw new Error('telegram ' + (j.error_code || r.status));
}

const getText = async (u, tries = 3) => {
  for (let i = 1; ; i++) {
    try { const r = await fetch(u, {signal: AbortSignal.timeout(30e3)}); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); }
    catch (e) { if (i >= tries) throw e; await new Promise(r => setTimeout(r, 5e3)); }
  }
};

function test() {
  const assert = (c, m) => { if (!c) throw new Error('FAIL ' + m); };
  const xml = `<item><title>ประเทศเมียนมา (Myanmar)</title><link>https://earthquake.tmd.go.th/inside-info.html?earthquake=17259</link>
    <geo:lat>20.666</geo:lat><geo:long>98.746</geo:long><tmd:depth>10</tmd:depth><tmd:magnitude>4.6</tmd:magnitude>
    <tmd:time>2026-10-19 14:05:35 UTC</tmd:time><comments>ห่าง อ.ฝาง 96 กม.</comments></item>
    <item><title>อ.แม่ลาว จ.เชียงราย</title><link>x?earthquake=1</link><geo:lat>19.7</geo:lat><geo:long>99.7</geo:long>
    <tmd:depth>5</tmd:depth><tmd:magnitude>3.1</tmd:magnitude><tmd:time>2026-10-19 14:30:00 UTC</tmd:time><comments></comments></item>`;
  const t = parseTmd(xml);
  assert(t.length === 2 && t[0].id === 'tmd17259' && t[0].time === Date.parse('2026-10-19T14:05:35Z'), 'parse ' + JSON.stringify(t[0]));
  assert(!inThai(t[0]) && inThai(t[1]), 'inThai');
  const now = Date.parse('2026-10-19T15:00:00Z');
  const u = {id: 'us1', src: 'usgs', place: 'Myanmar', mag: 4.7, time: t[0].time + 30e3, lat: 20.7, lon: 98.8, depth: 10};
  const p = pick([t[0], t[1], u], [], now);
  assert(p.length === 2 && p[0].id === 'us1' && p[1].id === 'tmd1', 'pick+ตัดซ้ำ ' + p.map(e => e.id));
  assert(pick([t[0]], [{...u}], now).length === 0, 'ส่งแล้วไม่ส่งซ้ำ');
  assert(pick([t[0]], [], now + 4 * 36e5).length === 0, 'เก่าเกิน 3 ชม. ไม่ส่ง');
  // ตรวจสูตรกับเหตุการณ์จริง: เชียงราย M6.3 2557 ใกล้จุดศูนย์กลาง VII–VIII · เมียนมา M7.7 2568 ถึง กทม. ~1,000 กม. ≈ III (ดินอ่อนจริง ~IV)
  assert([7, 8].includes(Math.floor(ipe(6.3, 5, 7))), 'ipe near ' + ipe(6.3, 5, 7));
  assert(Math.floor(ipe(7.7, 1000, 10)) === 2 || Math.floor(ipe(7.7, 1000, 10)) === 3, 'ipe far ' + ipe(7.7, 1000, 10));
  assert(message(p[0]).includes('ห่างโรงเรียน'), 'msg');
  console.log('quake.mjs test ผ่าน');
}

async function main() {
  if (process.argv[2] === 'test') return test();
  const prev = (() => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } })();
  const now = Date.now(), errs = [];
  let tmd = [], usgs = [];
  try { tmd = parseTmd(await getText(TMD)); } catch (e) { errs.push('tmd ' + (e.cause?.code || e.message)); }
  try {
    const q = `&starttime=${new Date(now - 864e5).toISOString().slice(0, 19)}&latitude=${SCHOOL[0]}&longitude=${SCHOOL[1]}&maxradiuskm=${NEAR_KM}&minmagnitude=${NEAR_M}`;
    usgs = JSON.parse(await getText(USGS + q)).features.map(fromUsgs);
  } catch (e) { errs.push('usgs ' + (e.cause?.code || e.message)); }
  // เก็บ TMD สะสม 30 วัน (RSS มีแค่ 10 รายการล่าสุด)
  const keep = new Map((prev.tmd || []).filter(e => now - e.time < KEEP_D * 864e5).map(e => [e.id, e]));
  for (const e of tmd) keep.set(e.id, e);
  const sent = (prev.sent || []).filter(s => now - s.time < 2 * 864e5);
  // รอบแรก (ยังไม่มีไฟล์) ไม่ส่ง กันเตือนของเก่าทั้งชุด
  const fresh = prev.t ? pick([...tmd, ...usgs], sent, now) : [];
  for (const e of fresh) {
    try { await send(message(e)); sent.push({id: e.id, time: e.time, lat: e.lat, lon: e.lon}); }
    catch (err) { errs.push(err.message); }
  }
  if (!prev.t) sent.push(...[...tmd, ...usgs].map(e => ({id: e.id, time: e.time, lat: e.lat, lon: e.lon})));
  const list = [...keep.values()].sort((a, b) => b.time - a.time);
  fs.writeFileSync(FILE, JSON.stringify({t: new Date(now).toISOString(), ok: tmd.length > 0, tmd: list, sent, errs}));
  console.log(`quake: tmd ${tmd.length} (สะสม ${list.length}) usgs ${usgs.length} ส่ง ${fresh.length}${errs.length ? ' · ' + errs.join(', ') : ''}`);
}
await main();
