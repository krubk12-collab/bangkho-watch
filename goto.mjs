// 🤖 น้องบางโค AI สรุป "ถ้าออกเดินทางตอนนี้" ให้หน้า bangkho.ac.th/water/goto (ทริป รร. → ศูนย์ประชุมแห่งชาติสิริกิติ์ 3 ต.ค. 69)
// ทุกรอบ 10 นาที: พยากรณ์ ณ เวลาที่รถจะผ่านแต่ละจุด (Open-Meteo + ECMWF แบบ Windy) + เรดาร์จริง 9 จุด + ฝุ่น + น้ำบนถนน → Gemini → goto_ai.json
// ทำงานเฉพาะ 06:00–20:00 ของวันใน TRIP_DAY (FORCE=1 ข้ามเงื่อนไข) · ทดสอบ: FORCE=1 OUT_DIR=<dir> node goto.mjs
import fs from 'fs';
import {png, dbz} from './rain.mjs';

const TRIP_DAY = '2026-10-03';
const OUT = process.env.OUT_DIR || '.';
const CP = [['โรงเรียนชุมชนวัดบางโค', 13.8508, 100.4031, 0], ['กาญจนาภิเษก ช่วงบางกรวย', 13.8446, 100.4129, 4], ['กาญจนาภิเษก ช่วงตลิ่งชัน', 13.8109, 100.4116, 7.8],
  ['แยกบรมราชชนนี–กาญจนาภิเษก', 13.7821, 100.4192, 11.7], ['บรมราชชนนี ช่วงบางกอกน้อย', 13.7837, 100.4549, 15.7], ['ปิ่นเกล้า (เชิงสะพาน)', 13.7734, 100.4821, 19.4],
  ['เจริญกรุง ช่วงเกาะรัตนโกสินทร์', 13.7471, 100.5009, 23.3], ['พระราม 4 ช่วงสามย่าน', 13.7326, 100.5293, 27.1], ['ศูนย์ประชุมแห่งชาติสิริกิติ์', 13.7234, 100.5599, 31]];
const KM = 31, MIN = 39;

const bkk = (d = new Date()) => new Date(d.getTime() + 7 * 3600e3).toISOString();   // เวลาไทยเป็นสตริง YYYY-MM-DDTHH:MM
const hm = d => bkk(d).slice(11, 16);
const r1 = v => v == null || isNaN(v) ? null : Math.round(v * 10) / 10;
function km(a, b, c, d) { const t = Math.PI / 180, x = Math.sin((c - a) * t / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin((d - b) * t / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); }
async function get(url, as = 'json') {
  for (let k = 0; ; k++) {
    try { const r = await fetch(url, {signal: AbortSignal.timeout(20000)}); if (!r.ok) throw new Error('HTTP ' + r.status); return as === 'json' ? r.json() : Buffer.from(await r.arrayBuffer()); }
    catch (e) { if (k >= 2) throw e; await new Promise(r => setTimeout(r, 5000)); }
  }
}
const soft = p => p.catch(e => (console.log('goto: ข้าม —', e.cause?.code || e.message), null));

// ค่าพยากรณ์ ณ เวลา d: เฉลี่ยตามนาทีระหว่างชั่วโมงนี้กับชั่วโมงถัดไป (แบบเดียวกับหน้าเว็บ)
function at(H, d) {
  const s = bkk(d), k = H.time.indexOf(s.slice(0, 13) + ':00'); if (k < 0) return {};
  const r = +s.slice(14, 16) / 60, lin = a => a?.[k] == null ? null : a[k] + ((a[k + 1] ?? a[k]) - a[k]) * r;
  return {p: Math.round(lin(H.precipitation_probability) ?? 0), mm: H.precipitation[k + 1] ?? 0, t: lin(H.temperature_2m), ft: lin(H.apparent_temperature),
    uv: lin(H.uv_index), g: Math.max(H.wind_gusts_10m[k] ?? 0, H.wind_gusts_10m[k + 1] ?? 0), wc: Math.max(H.weather_code[k] ?? 0, H.weather_code[k + 1] ?? 0)};
}

// เรดาร์: ไทล์ซูม 7 ภาพเดียวครอบทั้งเส้นทาง อ่านพิกเซลที่ 9 จุด (เหมือนหน้าเว็บ)
const C0 = [13.79, 100.48], ZW = 256 * 2 ** 7;
const merc = (lat, lng) => [(lng + 180) / 360 * ZW, (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * ZW];
const PX = CP.map(c => { const a = merc(c[1], c[2]), o = merc(...C0); return [Math.round(128 + a[0] - o[0]), Math.round(128 + a[1] - o[1])]; });
async function radar() {
  const m = await get('https://api.rainviewer.com/public/weather-maps.json'), fr = m.radar.past.slice(-6), Z = [];
  for (const f of fr) {
    try { const {W, px} = png(await get(`${m.host}${f.path}/256/7/${C0[0]}/${C0[1]}/2/0_0.png`, 'buf'));
      Z.push(PX.map(([x, y]) => { let z = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const i = ((y + dy) * W + x + dx) * 4; z = Math.max(z, dbz(px[i], px[i + 1], px[i + 2], px[i + 3])); } return z; })); }
    catch {}
  }
  return Z.length ? {now: Z.at(-1), m30: CP.map((_, i) => Math.max(...Z.slice(-3).map(z => z[i]))), m60: CP.map((_, i) => Math.max(...Z.map(z => z[i]))), t: hm(new Date(fr.at(-1).time * 1000))} : null;
}

async function ask(prompt) {
  for (const m of ['gemini-flash-latest', 'gemini-2.5-flash']) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {method: 'POST', signal: AbortSignal.timeout(60000),
        headers: {'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY},
        body: JSON.stringify({contents: [{parts: [{text: prompt}]}], generationConfig: {responseMimeType: 'application/json', temperature: 0.4}})});
      const j = JSON.parse((await r.json()).candidates?.[0]?.content?.parts?.[0]?.text || 'null');
      if (j?.now) return {...j, model: m};
      console.log('goto:', m, 'ตอบไม่ครบ', r.status);
    } catch (e) { console.log('goto:', m, e.message); }
  }
  return null;
}

async function main() {
  const now = new Date(), s = bkk(now), h = +s.slice(11, 13);
  if (!process.env.FORCE && (s.slice(0, 10) !== TRIP_DAY || h < 6 || h >= 20)) return console.log('goto: นอกวัน/เวลาทริป ข้าม');
  const q = `latitude=${CP.map(c => c[1])}&longitude=${CP.map(c => c[2])}&timezone=Asia%2FBangkok&forecast_days=2&hourly=`;
  const [F, E, R, AIR, W] = await Promise.all([
    get('https://api.open-meteo.com/v1/forecast?' + q + 'precipitation_probability,precipitation,temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,uv_index,wind_gusts_10m'),
    soft(get('https://api.open-meteo.com/v1/forecast?' + q + 'precipitation&models=ecmwf_ifs025')),
    soft(radar()), soft(get('https://bangkho.ac.th/water/air.php?all=1')), soft(get('https://bangkho.ac.th/water/api.php'))]);
  const eta = CP.map(c => new Date(now.getTime() + c[3] / KM * MIN * 60000));
  const pts = CP.map((c, i) => {
    const a = at(F[i].hourly, eta[i]), ek = E ? E[i].hourly.time.indexOf(bkk(eta[i]).slice(0, 13) + ':00') : -1, ec = ek >= 0 ? E[i].hourly.precipitation[ek + 1] : null;
    const pm = (AIR?.st || []).map(x => ({...x, d: km(c[1], c[2], x.lat, x.lon)})).filter(x => x.d <= 3 && x.pm != null).sort((x, y) => x.d - y.d)[0];
    return {'จุด': c[0], 'กม': c[3], 'เวลาผ่าน': hm(eta[i]), 'โอกาสฝน%': a.p, 'ฝนมม/ชม': r1(a.mm), 'อุณหภูมิ': r1(a.t), 'รู้สึกเหมือน': r1(a.ft), 'UV': r1(a.uv), 'ลมกระโชก': r1(a.g),
      'รหัสอากาศWMO': a.wc, 'ECMWFฝนมม/ชม': r1(ec), 'เรดาร์ตอนนี้dBZ': R?.now[i] ?? null, 'เรดาร์สูงสุด30นาที': R?.m30[i] ?? null, 'เรดาร์สูงสุด60นาที': R?.m60[i] ?? null, 'PM2.5ใกล้สุด': r1(pm?.pm)};
  });
  const road = (W?.road || []).filter(r => r.lat && CP.some(c => km(c[1], c[2], +r.lat, +r.lng) <= 2)).map(r => ({'ที่': r.name, 'ซม': r1(+r.cm)}));
  const facts = {'เวลาตอนนี้': hm(now), 'เรดาร์เวลา': R?.t ?? 'ไม่มีข้อมูล', 'ขับรวม': `${KM} กม. ราว ${MIN} นาทีถ้ารถไม่ติด`, 'จุด': pts, 'น้ำบนถนนใกล้เส้นทาง': road};

  const prompt = 'คุณคือ "น้องบางโค" มาสคอตเด็กผู้หญิงชั้นประถมของโรงเรียนชุมชนวัดบางโค (พูดลงท้าย ค่ะ/นะคะ) รายงานอากาศให้คุณครูที่กำลังจะขับรถจากโรงเรียน (นนทบุรี) ไปถ่ายรูปชุดครุยที่ศูนย์ประชุมแห่งชาติสิริกิติ์\n'
    + 'สมมติว่าออกเดินทางตอนนี้ ข้อมูลจริงด้านล่าง (เรดาร์ ≥20 dBZ = มีฝนตกจริง, ≥35 ฝนหนัก · พยากรณ์ = ณ เวลาที่รถผ่านจุดนั้น · ECMWF คือโมเดลเดียวกับที่ Windy ใช้):\n'
    + JSON.stringify(facts) + '\n\n'
    + 'ตอบเป็น JSON เท่านั้น: {"now":"สภาพตอนนี้ที่โรงเรียน","way":"ระหว่างทางจะเจออะไร บอกชื่อช่วงถนนถ้ามีฝน/น้ำ","dest":"ถึงศูนย์ประชุมฯ ราวกี่โมง อากาศเป็นอย่างไร ถ่ายรูปกลางแจ้งได้ไหม","tip":"คำแนะนำสั้นที่สุด 1 อย่าง"}\n'
    + 'แต่ละช่องภาษาไทย 1 ประโยคสั้น ไม่เกิน 90 ตัวอักษร น้ำเสียงสดใสเป็นกันเอง ใช้ตัวเลขจริงจากข้อมูล ห้ามแต่งข้อมูลที่ไม่มี ห้ามพูดคำว่า dBZ/WMO/ECMWF หรือศัพท์เทคนิค ใช้ภาษาที่ครูทั่วไปเข้าใจ ถ้าเรดาร์บอกฝนตกให้เชื่อเรดาร์มากกว่าพยากรณ์';
  const ai = await ask(prompt);
  if (!ai) return console.log('goto: AI ไม่ตอบ คงไฟล์เดิมไว้');

  // ท่าน้อง (ไฟล์ /water/mascot-*.webp): ฝนตกจริง/โอกาสสูง > ร่ม+หมวก > ฝุ่น > แดด > ปกติ
  const maxP = Math.max(...pts.map(p => p['โอกาสฝน%'] ?? 0)), uv = Math.max(...pts.map(p => p.UV ?? 0)), pmMax = Math.max(0, ...pts.map(p => p['PM2.5ใกล้สุด'] ?? 0));
  const wet = pts.some(p => p['เรดาร์ตอนนี้dBZ'] >= 20) || maxP >= 60;
  const pose = wet ? 'rain' : maxP >= 30 && uv >= 6 ? 'sunrain' : pmMax > 37.5 ? 'dust' : uv >= 8 ? 'sun' : 'normal';
  const out = {at: hm(now), ts: Math.floor(now / 1000), pose, model: ai.model};
  for (const k of ['now', 'way', 'dest', 'tip']) out[k] = String(ai[k] ?? '').slice(0, 200);
  fs.writeFileSync(`${OUT}/goto_ai.json`, JSON.stringify(out));
  console.log('goto:', JSON.stringify(out));
}
await main();
