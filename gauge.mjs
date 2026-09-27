// อ่านไม้วัดระดับน้ำจากกล้อง CCTV (ท่าน้ำนนท์ + ท่าน้ำปากเกร็ด) ด้วย Gemini แล้วเก็บเป็นกราฟ + แจ้ง Telegram
// ขั้นตอน: ffmpeg ดึง 1 เฟรมจากสตรีม → ครอปเฉพาะไม้วัด ขยาย 3 เท่า → Gemini ตอบ JSON → กรองค่าที่ไม่น่าเชื่อ
// env: GEMINI_API_KEY, CAM_KEY, TG_TOKEN, TG_CHAT, OUT_DIR (<file>.json + <file>.jpg ต่อกล้อง), DRY_RUN=1 (ไม่ส่ง Telegram)
// repo สาธารณะ → ห้าม print คีย์/เนื้อหาข้อความลง log
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const OUT = process.env.OUT_DIR || '.';
const KEEP_H = 72;                            // เก็บประวัติ 3 วัน
// ponytail: ยังไม่รู้ระดับล้นจริงของแต่ละท่า — ใช้ระดับตลิ่งปากเกร็ด (2.50) เป็นหลักไปก่อน ได้ตัวเลขจริงแล้วแก้ตรงนี้
const LEVELS = [2.5, 2.8, 3.0];
const RISE_CM_1H = 15;                        // ขึ้นเร็วเกิน 15 ซม./ชม. = แจ้ง
const dry = process.env.DRY_RUN === '1';

const JSON_ASK = 'Reply JSON only: {"visible":bool,"level_m":number|null,"below_gauge":bool,"confidence":0-1,"note":"short"}';
// crop = ตำแหน่งไม้วัดในภาพ (ถ้ากล้องขยับ แก้ตรงนี้) · web = กรอบรูปโชว์บนเว็บ · ref = เทียบกับสถานีปากเกร็ด สสน. ได้ไหม (ต้องใช้ระดับอ้างอิงเดียวกัน)
const CAMS = [
  {id: 'nont', name: 'ท่าน้ำนนท์', file: 'gauge', ref: true, levels: LEVELS,
    stream: 'https://stream.firsttech.co.th/live/nakornnont.stream/playlist.m3u8',
    crop: 'crop=160:600:410:0,scale=480:1800:flags=lanczos', web: 'crop=300:560:330:0',
    prompt: `This is a river staff gauge (Thai style, E-pattern, black marks every 2 cm, labels every 10 cm: 90,80,...,10 then a meter mark, then 90,80,...). The lower segment runs 2.00–2.90 m (labels 90..10 then 2.00 at its bottom end; e.g. "50" means 2.50 m); the upper segment is 3.00–3.90 m. Ignore the red/yellow painted post beside the gauge and the blue pipe; read only where water meets the white gauge face. Find where the WATER SURFACE meets the gauge and read the level in meters (2 decimals). If the water line is not visible, the gauge is hidden/blurred, or the camera is pointing elsewhere, set visible=false.`},
  // ไม้วัดปากเกร็ดใช้ระดับอ้างอิงคนละแบบกับ สสน. (ไม้ 2.20 ตอน สสน. 2.49) — ไม่เทียบกัน ใช้ป้ายของท่าเองแทน
  // zones = ป้ายข้างไม้วัดเทียบตัวเลขบนไม้ (ลูกพี่ดูจากกล้อง 27ก.ย.69): กลางป้าย "เฝ้าระวัง" ≈ 2.20, กลางป้าย "วิกฤต" ≈ 2.90
  {id: 'pakkret', name: 'ท่าน้ำปากเกร็ด', file: 'gauge-pakkret', ref: false, levels: [], zones: [2.20, 2.90],
    // กล้องรับเฉพาะ IP ไทย → ให้โฮสต์ bangkho.ac.th ส่งต่อ 500KB แรกของท่อนล่าสุด (cam.php + secret CAM_KEY)
    relay: 'https://bangkho.ac.th/water/cam.php',
    crop: 'crop=90:480:715:0,scale=270:1440:flags=lanczos', web: 'crop=420:420:520:0',
    prompt: `River staff gauge (yellow, E-pattern, black marks every 2 cm, labels every 10 cm). From the top: 50,40,30,20,10, a meter joint, then 90,80,...,30. The part above the joint is the 3-meter range ("50" = 3.50 m), below it the 2-meter range ("80" = 2.80 m). Labels continue below 30 (20, 10, ...) and the gauge goes down INTO the water; the thin white line under it is only a reflection. Find where the WATER SURFACE meets the yellow gauge and read the level in meters (2 decimals), e.g. water at the "20" label below the joint = 2.20. If the view is dark/blurred/pointing elsewhere set visible=false.`},
];

const ZONE = ['ต่ำกว่าป้าย', 'เฝ้าระวัง', 'วิกฤต'];
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

async function grab(c) {
  const raw = `${OUT}/_frame.jpg`, crop = `${OUT}/_crop.png`;
  let src = c.stream;
  if (c.relay) {   // โหลดเองด้วย fetch — ถ้าส่ง URL ให้ ffmpeg ข้อความ error จะพิมพ์กุญแจลง log สาธารณะ
    const r = await fetch(c.relay + '?k=' + encodeURIComponent(process.env.CAM_KEY || ''), {signal: AbortSignal.timeout(40000)});
    if (!r.ok) throw new Error('relay ' + r.status);
    src = `${OUT}/_seg.ts`;
    fs.writeFileSync(src, Buffer.from(await r.arrayBuffer()));
  }
  const net = c.relay ? [] : ['-rw_timeout', '20000000', '-user_agent', 'Mozilla/5.0'];   // ใช้กับ URL เท่านั้น ไฟล์ในเครื่องจะ error
  try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...net, '-i', src, '-frames:v', '1', raw], {timeout: 60000}); }
  finally { if (c.relay) fs.rmSync(src, {force: true}); }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', c.crop, crop]);
  // รูปที่โชว์บนเว็บ: ไม้วัด + ผิวน้ำ ขนาดเล็ก
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', c.web, '-q:v', '5', `${OUT}/${c.file}.jpg`]);
  const imgs = [fs.readFileSync(crop).toString('base64')];
  fs.rmSync(raw); fs.rmSync(crop);
  return imgs;
}

async function ask(c, imgs) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({contents: [{parts: [{text: c.prompt + ' ' + JSON_ASK}, ...imgs.map(data => ({inlineData: {mimeType: 'image/png', data}}))]}],
      generationConfig: {responseMimeType: 'application/json', temperature: 0}})});
  const j = await r.json();
  const t = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('');
  if (!t) throw new Error('gemini ' + (j.error?.code || r.status));
  const v = JSON.parse(t);
  return Array.isArray(v) ? v[0] : v;
}

// สถานีปากเกร็ด สสน. (สะพานนวลฉวี) ใช้เช็คว่าค่าที่ AI อ่านไม่หลุดโลก
async function pakKret() {
  try {
    const j = await (await fetch('https://bangkho.ac.th/water/api.php')).json();
    const s = j.stations.find(x => x.id === 26);
    return s && s.wl != null ? {wl: s.wl, dt: s.dt} : null;
  } catch { return null; }
}

// คืนเหตุผลที่ไม่รับค่า หรือ '' ถ้ารับ
export function reject(v, hist, pk, now) {
  if (!v || !v.visible) return 'มองไม่เห็นผิวน้ำ';
  if (v.below_gauge) return 'น้ำต่ำกว่าปลายไม้วัด';
  const x = +v.level_m;
  if (!(x >= 1 && x <= 3.99)) return 'ค่าอยู่นอกช่วงไม้วัด';
  if ((+v.confidence || 0) < 0.6) return 'AI ไม่มั่นใจ';
  if (pk && Math.abs(x - pk.wl) > 0.6) return 'ต่างจากปากเกร็ดเกิน 60 ซม.';
  const last = [...hist].reverse().find(h => h.ok);
  if (last && now - Date.parse(last.t) < 40 * 60e3 && Math.abs(x - last.m) > 0.25) return 'กระโดดเกิน 25 ซม. ใน 40 นาที';
  return '';
}

function send(text) {
  if (dry) { console.log('--- DRY_RUN ---\n' + text); return; }
  return fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chat_id: process.env.TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true})});
}

const FOOT = `\n\n🔗 https://bangkho.ac.th/water/#gauge\n<i>AI อ่านจากกล้อง CCTV อาจคลาดเคลื่อน ไม่ใช่ประกาศทางการ</i>`;

async function runCam(c, pk) {
  const now = Date.now(), FILE = `${OUT}/${c.file}.json`;
  const G = readJson(FILE, {h: [], alerts: {}});
  G.h = G.h.filter(h => now - Date.parse(h.t) < KEEP_H * 3600e3);
  let v, why;
  try { v = await ask(c, await grab(c)); } catch (e) { why = 'ดึงภาพ/อ่านไม่สำเร็จ'; console.log(c.id + ':', e.message.split('\n')[0]); }
  why = why || reject(v, G.h, c.ref ? pk : null, now);
  const rec = {t: new Date(now).toISOString(), m: v?.level_m != null ? Math.round(v.level_m * 100) / 100 : null, ok: !why};
  if (why) rec.why = why;
  if (rec.ok && c.zones) rec.zone = c.zones.filter(z => rec.m >= z - 0.005).length;   // 0 ต่ำกว่าป้าย, 1 เฝ้าระวัง, 2 วิกฤต
  G.h.push(rec);
  Object.assign(G, {pk, levels: c.levels, zones: c.zones, name: c.name});

  // ป้ายข้างไม้วัด: น้ำถึงขั้นเดิม 2 รอบติด → แจ้ง (ขั้นเดียวกันซ้ำได้หลัง 12 ชม.)
  const [p1, p2] = G.h.slice(-2).filter(h => h.ok), z = Math.min(p1?.zone ?? 0, p2?.zone ?? 0), zk = 'z' + z;
  if (z >= 1 && (!G.alerts[zk] || now - G.alerts[zk] > 12 * 3600e3)) {
    G.alerts[zk] = now;
    await send(`${z === 2 ? '🔴' : '🟡'} <b>${c.name}: น้ำถึงป้าย "${ZONE[z]}" แล้ว (${c.zones[z - 1].toFixed(2)} ม.)</b>${rec.ok ? ` · ไม้วัด ${rec.m.toFixed(2)} ม.` : ''}` +
      (pk ? `\nปากเกร็ด (สสน.) ${pk.wl.toFixed(2)} ม.` : '') + FOOT);
  }

  if (rec.ok) {
    const x = rec.m;
    const hourAgo = G.h.filter(h => h.ok && now - Date.parse(h.t) >= 50 * 60e3 && now - Date.parse(h.t) <= 80 * 60e3).pop();
    const rise = hourAgo ? Math.round((x - hourAgo.m) * 100) : null;
    const msgs = [];
    for (const L of c.levels) {   // ข้ามขึ้นเหนือระดับ แจ้งซ้ำได้อีกเมื่อผ่านไป 12 ชม. (น้ำขึ้นลงวันละ 2 รอบ)
      const k = String(L);
      if (x >= L && (!G.alerts[k] || now - G.alerts[k] > 12 * 3600e3)) { msgs.push(`ถึง ${L.toFixed(2)} ม. แล้ว`); G.alerts[k] = now; }
    }
    if (rise != null && rise >= RISE_CM_1H && (!G.alerts.rise || now - G.alerts.rise > 3 * 3600e3)) {
      msgs.push(`ขึ้นเร็ว +${rise} ซม. ใน 1 ชม.`); G.alerts.rise = now;
    }
    if (msgs.length) await send(`🌊 <b>ไม้วัด${c.name} ${x.toFixed(2)} ม.</b>\n${msgs.join(' · ')}` +
      (rise != null ? `\nเทียบ 1 ชม.ก่อน: ${rise >= 0 ? '+' : ''}${rise} ซม.` : '') +
      (pk ? `\nปากเกร็ด (สสน.) ${pk.wl.toFixed(2)} ม. · ตลิ่ง 2.50` : '') + FOOT);
  }
  fs.writeFileSync(FILE, JSON.stringify(G));
  console.log(`${c.id}: ${rec.ok ? rec.m + ' ม.' : 'ข้าม — ' + rec.why}${rec.zone ? ' · ป้าย' + ZONE[rec.zone] : ''}`);
}

async function main() {
  const pk = await pakKret();
  for (const c of CAMS) await runCam(c, pk).catch(e => console.log(c.id + ': ' + e.message.split('\n')[0]));   // กล้องหนึ่งพังไม่ลากอีกตัว
}

if (process.argv[1]?.endsWith('gauge.mjs') && process.argv[2] !== 'test') await main();

if (process.argv[2] === 'test') {   // node gauge.mjs test
  const t = Date.parse('2026-09-27T14:00:00Z'), ok = (m, min) => ({t: new Date(t - min * 60e3).toISOString(), m, ok: true});
  const V = m => ({visible: true, level_m: m, confidence: 0.8});
  const eq = (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); };
  eq(reject(V(2.37), [ok(2.35, 10)], {wl: 2.52}, t), '');
  eq(reject({visible: false}, [], null, t), 'มองไม่เห็นผิวน้ำ');
  eq(reject({...V(null), below_gauge: true}, [], null, t), 'น้ำต่ำกว่าปลายไม้วัด');
  eq(reject({...V(2.4), confidence: 0.3}, [], null, t), 'AI ไม่มั่นใจ');
  eq(reject(V(3.4), [], {wl: 2.5}, t), 'ต่างจากปากเกร็ดเกิน 60 ซม.');
  eq(reject(V(2.8), [ok(2.4, 10)], null, t), 'กระโดดเกิน 25 ซม. ใน 40 นาที');
  eq(reject(V(2.8), [ok(2.4, 120)], null, t), '');
  console.log('ok');
}
