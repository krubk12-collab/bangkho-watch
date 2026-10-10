// AI สรุปแนวโน้ม 7 วัน ณ โรงเรียนชุมชนวัดบางโค — รวมทุกข้อมูลที่หน้า /water/ มี แล้วให้ Gemini ประมวลเป็นภาพรวม
// ตัวเลขพยากรณ์ (ฝน/เมฆ/ความกดอากาศ/ลม/พายุฟ้าคะนอง/ฝนสะสม) จาก Open-Meteo ECMWF+GFS · ภาพแผนที่อากาศกรมอุตุฯ + Himawari + ฝนพยากรณ์ สสน.
// + ระดับเฝ้าระวังจาก assess.js + น้ำขึ้นลงคลอง + เขื่อน + ดาวเทียม GISTDA + ไม้วัด AI + หัวข่าว
// ผลเป็น "ความเห็นประกอบ" เท่านั้น ไม่ขับระดับเตือนภัย (ระดับยังมาจาก assess.js ที่เดียว)
// env: DEEPSEEK_API_KEY, GROQ_API_KEY, OUT_DIR (outlook.json), FORCE=1 (ไม่รอครบ 6 ชม.) · repo สาธารณะ ห้าม print คีย์
import fs from 'node:fs';

const SITE = 'https://bangkho.ac.th/water/';
const OUT = process.env.OUT_DIR || '.';
const FILE = `${OUT}/outlook.json`;
const EVERY_H = 6;                        // ponytail: ถามทุก 6 ชม. พอ — พยากรณ์ ECMWF/GFS อัปเดตวันละ 2–4 รอบ
// 💸 11ต.ค.69 ย้ายจาก Gemini Pro → DeepSeek (ถูกกว่ามาก) สำรองด้วย Groq ฟรี · ทั้งคู่อ่านภาพไม่ได้ → ตัดภาพแผนที่อากาศออก ใช้ตัวเลขพยากรณ์ล้วน
const PROVIDERS = [
  {name: 'deepseek-chat', url: 'https://api.deepseek.com/chat/completions', key: 'DEEPSEEK_API_KEY',
   body: {model: 'deepseek-chat', response_format: {type: 'json_object'}}},
  {name: 'groq qwen3.8-27b', url: 'https://api.groq.com/openai/v1/chat/completions', key: 'GROQ_API_KEY',
   body: {model: 'qwen/qwen3.8-27b', response_format: {type: 'json_object'}, reasoning_effort: 'none'}},
];
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
// Open-Meteo ต่อจาก runner GitHub ไม่ติดบางครั้ง (UND_ERR_CONNECT_TIMEOUT) → ลองซ้ำ 3 รอบ
async function get(u, ms = 30000) {
  for (let i = 0; ; i++) {
    try { return await fetch(u, {signal: AbortSignal.timeout(ms)}); }
    catch (e) { if (i >= 2) throw e; await new Promise(r => setTimeout(r, 3000)); }
  }
}
const r1 = v => v == null ? null : Math.round(v * 10) / 10;

// จุดพยากรณ์: โรงเรียน + ต้นน้ำ (ฝนต้นน้ำ = น้ำเหนือที่จะมาถึงใน 1–2 สัปดาห์)
const PTS = [['โรงเรียน (บางใหญ่ นนทบุรี)', 13.851028, 100.403063], ['อยุธยา', 14.35, 100.57], ['ชัยนาท (เขื่อนเจ้าพระยา)', 15.16, 100.19],
  ['นครสวรรค์', 15.70, 100.12], ['เขื่อนภูมิพล', 17.24, 98.97], ['เขื่อนสิริกิติ์', 17.76, 100.56], ['เขื่อนป่าสัก', 14.87, 101.06]];
const COMPASS = d => ['เหนือ', 'ตะวันออกเฉียงเหนือ', 'ตะวันออก', 'ตะวันออกเฉียงใต้', 'ใต้', 'ตะวันตกเฉียงใต้', 'ตะวันตก', 'ตะวันตกเฉียงเหนือ'][Math.round(d / 45) % 8];

async function forecast() {
  const q = `latitude=${PTS.map(p => p[1])}&longitude=${PTS.map(p => p[2])}&timezone=Asia%2FBangkok&forecast_days=7`;
  // รายชั่วโมง (best match) → สรุปรายวัน · ฝนรายวันแยก ECMWF/GFS ดูว่าแบบจำลองเห็นตรงกันไหม
  const [h, d] = await Promise.all([
    get(`https://api.open-meteo.com/v1/forecast?${q}&hourly=precipitation,precipitation_probability,cloud_cover,pressure_msl,wind_speed_10m,wind_gusts_10m,wind_direction_10m,cape,weather_code`).then(r => r.json()),
    get(`https://api.open-meteo.com/v1/forecast?${q}&daily=precipitation_sum&models=ecmwf_ifs025,gfs_seamless`).then(r => r.json())]);
  return PTS.map((p, i) => {
    const H = h[i].hourly, D = d[i].daily, days = {};
    H.time.forEach((t, k) => (days[t.slice(0, 10)] ||= []).push(k));
    return {name: p[0], days: Object.entries(days).map(([date, ks], j) => {
      const v = key => ks.map(k => H[key][k]).filter(x => x != null);
      const sum = a => a.reduce((x, y) => x + y, 0), avg = a => a.length ? sum(a) / a.length : null;
      const wd = v('wind_direction_10m');
      return {date, rain_mm: r1(sum(v('precipitation'))), rain_prob_max: Math.max(...v('precipitation_probability')),
        ecmwf_mm: r1(D.precipitation_sum_ecmwf_ifs025?.[j]), gfs_mm: r1(D.precipitation_sum_gfs_seamless?.[j]),
        cloud_avg: Math.round(avg(v('cloud_cover'))), pressure_min: r1(Math.min(...v('pressure_msl'))),
        wind_max_kmh: r1(Math.max(...v('wind_speed_10m'))), gust_max_kmh: r1(Math.max(...v('wind_gusts_10m'))),
        wind_from: wd.length ? COMPASS(avg(wd)) : null, cape_max: Math.round(Math.max(...v('cape'))),
        thunder_hours: v('weather_code').filter(c => c >= 95).length};
    })};
  });
}

// ภาพที่ AI ดู: แผนที่อากาศผิวพื้น + ลมชั้นบน + ดาวเทียมเมฆ (กรมอุตุฯ/สสน.) + ฝนพยากรณ์ WRF ของ สสน.
async function images(D) {
  const picks = [...(D.wmap || []).slice(0, 4).map(w => [w.name, w.img]), ...(D.fc?.th || []).slice(0, 7).map(f => [`ฝนพยากรณ์ สสน. (WRF) ${f.dt}`, f.img])];
  const out = [];
  for (const [name, url] of picks) {
    try {
      const r = await get(url, 20000);
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !type.startsWith('image/')) continue;
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length > 4e6) continue;
      out.push({name, part: {inlineData: {mimeType: type.split(';')[0], data: b.toString('base64')}}});
    } catch { /* ภาพไหนโหลดไม่ได้ข้ามไป — ตัวเลขยังพอ */ }
  }
  return out;
}

async function context() {
  const code = await (await get(SITE + 'assess.js')).text();
  globalThis.window = globalThis;
  new Function(code)();
  const W = globalThis.WaterAssess, r = await W.load(SITE + 'api.php');
  if (!r.D?.stations) throw new Error('api ไม่ตอบ');
  const a = r.a, strip = s => s.replace(/<[^>]+>/g, '');
  const news = await get(SITE + 'news.php').then(x => x.json()).catch(() => null);
  const gauge = f => get(`https://raw.githubusercontent.com/krubk12-collab/bangkho-watch/status/${f}.json`).then(x => x.json()).catch(() => null);
  const [gN, gP] = await Promise.all([gauge('gauge'), gauge('gauge-pakkret')]);
  const lastPts = g => (g?.h || g?.hist || []).slice(-6);
  const c13 = r.D.stations.find(s => s.id === 2744);
  // WeatherNext 2 (wn.mjs รันก่อนใน workflow เดียวกัน) — ทิ้งถ้าเก่าเกิน 13 ชม.
  const wn = readJson(`${OUT}/wn.json`, null), wnOk = wn && Date.now() - Date.parse(wn.t) < 13 * 36e5;
  return {
    D: r.D,
    text: {
      now: new Date().toLocaleString('th-TH', {timeZone: 'Asia/Bangkok'}),
      level_by_formula: a.name, local_factors: a.L.map(x => [x[0], strip(x[1])]), upstream_factors: a.U.map(x => [x[0], strip(x[1])]),
      canal_tide_mahasawat_vs_bank: a.tide,
      c13_last_24h: c13?.s?.slice(-24), sea_tide_peak_7d: r.TIDE?.peakDay,
      dams: (r.D.dams || []).map(d => ({name: d.name, pct: d.pct, inflow: d.inflow, release: d.release})),
      stations_over_bank_chaophraya: (r.D.over || []).slice(0, 12).map(o => `${o.name} ${o.prov} +${o.diff} ม.`),
      gistda_3days: r.GI?.['3days'] ? {nont: r.GI['3days'].nont, near: r.GI['3days'].near.slice(0, 8), total_rai: r.GI['3days'].rai} : null,
      staff_gauge_ai: {nont_pier: lastPts(gN), pakkret_pier_zones_watch_2_20_critical_2_90: lastPts(gP)},
      weathernext2_ensemble64_pct: wnOk ? {
        school_daily_pct_heavy_ge35_veryheavy_ge90: wn.school.map(d => ({date: d.date, rain: d.rain, heavy: d.heavy, vheavy: d.vheavy, median_mm: d.med, p90_mm: d.p90})),
        upstream_3day_sum_pct_ge60_ge120: wn.upstream.map(u => ({name: u.name, travel_days_to_nont: u.travel, worst: u.worst}))} : null,
      news_titles: (news?.items || []).slice(0, 12).map(n => n.t),
      // ponytail: รายงานจากครูใส่มือ หมดอายุเอง 36 ชม. — ถ้ามีไม้วัดที่ร่องข้างอาคารแล้ว ค่อยทำเป็นไฟล์/ฟอร์มให้ครูอัปเดตเอง
      school_observation: Date.now() < Date.parse('2026-09-29T23:00:00+07:00') ? 'ครูถ่ายรูปที่โรงเรียน 28 ก.ย. 2569 ช่วงสาย: น้ำในร่อง/บ่อข้างอาคารสูง แต่ยังต่ำกว่าขอบลานทางเดินราว 20–30 ซม. ลานยังแห้ง' : 'ไม่มีรายงานจากโรงเรียนล่าสุด — ห้ามสรุปสภาพลานโรงเรียนเอง',
    }};
}

const PROMPT = `คุณเป็นผู้ช่วยวิเคราะห์สถานการณ์น้ำให้ "โรงเรียนชุมชนวัดบางโค" (ต.บางแม่นาง อ.บางใหญ่ จ.นนทบุรี ฝั่งตะวันตกแม่น้ำเจ้าพระยา ใกล้คลองมหาสวัสดิ์/คลองอ้อมนนท์)
ผู้อ่านคือครู ผู้ปกครอง ผู้สูงอายุ — ต้องไม่ประมาท แต่ห้ามทำให้ตื่นตระหนก: ใช้ภาษาเรียบ ๆ บอกข้อเท็จจริงและสิ่งที่ควรทำ ไม่ใช้คำเร้าอารมณ์
ประมวลทุกข้อมูลด้านล่าง: ตัวเลขพยากรณ์ 7 วัน (ฝน ECMWF เทียบ GFS, ความน่าจะเป็นฝน, เมฆ, ความกดอากาศต่ำสุด, ลม/ลมกระโชก, CAPE, ชั่วโมงพายุฝนฟ้าคะนอง) ที่โรงเรียนและต้นน้ำ,
% โอกาสฝนหนักจาก Google WeatherNext 2 (64 ชุด ensemble — ใช้บอกความไม่แน่นอน ถ้า % ต่ำแต่ ECMWF/GFS ฝนมาก = มีโอกาสแต่ไม่แน่นอน, ถ้าเห็นตรงกันความมั่นใจสูงขึ้น; เป็นแบบจำลองทดลอง ใช้ประกอบ),
ระดับน้ำคลอง/แม่น้ำ, น้ำขึ้นลงเทียบตลิ่ง, น้ำเหนือ C.13, เขื่อน, น้ำทะเลหนุน, ดาวเทียมน้ำท่วม, หัวข่าว
เกณฑ์ risk รายวัน (ให้ตรงกับระดับของเว็บ): 0 ปกติ · 1 เฝ้าระวัง · 2 เตือนภัย · 3 วิกฤต
- ระดับ 2 ขึ้นไปต้องมีหลักฐานชัด เช่น ฝนพยากรณ์ที่โรงเรียนเกิน 90 มม./วัน ที่ ECMWF และ GFS เห็นตรงกัน, หรือน้ำคลองเกินตลิ่งแม้ช่วงน้ำลง, หรือ C.13 เกิน 2,500 และยังเพิ่ม ร่วมกับน้ำทะเลหนุนสูง
- คลองล้นตลิ่งเฉพาะช่วงยอดน้ำขึ้นแล้วลดลงต่ำกว่าตลิ่ง = เฝ้าระวัง
- ถ้าแบบจำลองเห็นต่างกันมาก ให้บอกว่าความมั่นใจต่ำ อย่าเลือกตัวที่น่ากลัวกว่า
ตอบ JSON เท่านั้น ภาษาไทย:
{"trend":"ดีขึ้น|ทรงตัว|ต้องจับตา|แย่ลง","headline":"ประโยคเดียว ไม่เกิน 90 ตัวอักษร","summary":"3-4 ประโยค อธิบายภาพรวมว่าทำไม",
"days":[{"date":"YYYY-MM-DD","risk":0,"rain":"เช่น ฝนเล็กน้อย 5–10 มม.","note":"สั้น ๆ เช่น น้ำขึ้นสูงช่วงเย็น"}],
"weather":"สรุปลักษณะอากาศจากตัวเลข (ความกดอากาศ ลม พายุฝนฟ้าคะนอง) 1-2 ประโยค","upstream":"น้ำเหนือจะมาเพิ่มไหม เมื่อไร 1-2 ประโยค",
"watch":["สิ่งที่ต้องจับตา สูงสุด 4 ข้อ"],"advice":"คำแนะนำสำหรับโรงเรียน 1-2 ประโยค","confidence":"สูง|ปานกลาง|ต่ำ","why_confidence":"สั้น ๆ"}
days ต้องครบ 7 วันตามวันที่ในพยากรณ์`;

async function askAI(prompt) {
  let last;
  for (const p of PROVIDERS) {
    try {
      if (!process.env[p.key]) throw new Error(`${p.name} ไม่มีคีย์`);
      const r = await fetch(p.url, {
        method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${process.env[p.key]}`}, signal: AbortSignal.timeout(180000),
        body: JSON.stringify({...p.body, temperature: 0.2, max_tokens: 3000, messages: [{role: 'user', content: prompt}]})});
      const j = await r.json();
      const t = j.choices?.[0]?.message?.content;
      if (!t) throw new Error(`${p.name} ${j.error?.code || j.error?.message?.slice(0, 40) || r.status}`);
      const v = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
      if (!Array.isArray(v.days) || !v.headline) throw new Error(`${p.name} รูปแบบผิด`);
      return {...v, model: p.name};
    } catch (e) { last = e; console.log('outlook:', String(e.message).slice(0, 80)); }
  }
  throw last;
}

async function run() {
  const prev = readJson(FILE, null);
  if (process.env.FORCE !== '1' && prev?.t && Date.now() - Date.parse(prev.t) < EVERY_H * 36e5 - 10 * 6e4) { console.log('outlook: ยังไม่ครบรอบ'); return prev; }
  const [ctx, fc] = await Promise.all([context().catch(e => { throw new Error('ข้อมูลน้ำ: ' + (e.cause?.code || e.message)); }), forecast().catch(e => { throw new Error('พยากรณ์: ' + (e.cause?.code || e.message)); })]);
  const v = await askAI(PROMPT + '\n\nข้อมูลสถานการณ์ปัจจุบัน:\n' + JSON.stringify(ctx.text) + '\n\nตัวเลขพยากรณ์รายวัน 7 วัน:\n' + JSON.stringify(fc));
  // ระดับรายวันต้องอยู่ 0–3 และวันแรกไม่ต่ำกว่าระดับที่สูตรคิดตอนนี้ (AI ห้ามบอกว่าปลอดภัยกว่าข้อมูลจริง)
  const W = globalThis.WaterAssess, now = W.NAMES.indexOf(ctx.text.level_by_formula);
  v.days = v.days.slice(0, 7).map((d, i) => ({...d, risk: Math.max(0, Math.min(3, Math.round(+d.risk || 0)), i === 0 ? now : 0)}));
  const out = {t: new Date().toISOString(), level_now: now, images: [], ...v,
    fc: fc[0].days.map(d => ({date: d.date, ecmwf: d.ecmwf_mm, gfs: d.gfs_mm, prob: d.rain_prob_max, thunder: d.thunder_hours, gust: d.gust_max_kmh}))};
  fs.writeFileSync(FILE, JSON.stringify(out, null, 1));
  console.log(`outlook: ${out.model} · ${out.trend}`);
  return out;
}

run().catch(e => { console.log('outlook error:', String(e.message).slice(0, 120)); process.exitCode = 1; });
