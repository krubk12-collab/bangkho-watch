// อ่านไม้วัดระดับน้ำท่าน้ำนนท์จากกล้อง CCTV เทศบาลนครนนทบุรี ด้วย Gemini แล้วเก็บเป็นกราฟ + แจ้ง Telegram
// ขั้นตอน: ffmpeg ดึง 1 เฟรมจากสตรีม → ครอปเฉพาะไม้วัด ขยาย 3 เท่า → Gemini ตอบ JSON → กรองค่าที่ไม่น่าเชื่อ
// env: GEMINI_API_KEY, TG_TOKEN, TG_CHAT, OUT_DIR (gauge.json + gauge.jpg), DRY_RUN=1 (ไม่ส่ง Telegram)
// repo สาธารณะ → ห้าม print คีย์/เนื้อหาข้อความลง log
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const STREAM = 'https://stream.firsttech.co.th/live/nakornnont.stream/playlist.m3u8';
const CROP = 'crop=110:360:430:0';          // ตำแหน่งไม้วัดในภาพ 800×600 — ถ้ากล้องขยับ แก้ตรงนี้
const OUT = process.env.OUT_DIR || '.';
const FILE = `${OUT}/gauge.json`;
const KEEP_H = 72;                            // เก็บประวัติ 3 วัน
// ponytail: ยังไม่รู้ระดับล้นจริงของท่าน้ำนนท์ — ใช้ระดับตลิ่งปากเกร็ด (2.50) เป็นหลักไปก่อน ได้ตัวเลขจริงแล้วแก้ตรงนี้
const LEVELS = [2.5, 2.8, 3.0];
const RISE_CM_1H = 15;                        // ขึ้นเร็วเกิน 15 ซม./ชม. = แจ้ง
const dry = process.env.DRY_RUN === '1';

const PROMPT = `This is a river staff gauge (Thai style, E-pattern, black marks every 2 cm, labels every 10 cm: 90,80,...,10 then a meter mark, then 90,80,...). The lower segment's labels are in the 2-meter range (e.g. "50" means 2.50 m); the upper segment is the 3-meter range. Find where the WATER SURFACE meets the gauge and read the level in meters (2 decimals). If the water line is not visible, the gauge is hidden/blurred, or the camera is pointing elsewhere, set visible=false. Reply JSON only: {"visible":bool,"level_m":number,"confidence":0-1,"note":"short"}`;

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

function grab() {
  const raw = `${OUT}/_frame.jpg`, crop = `${OUT}/_crop.png`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-rw_timeout', '20000000', '-i', STREAM, '-frames:v', '1', raw], {timeout: 60000});
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', `${CROP},scale=330:1080:flags=lanczos`, crop]);
  // รูปที่โชว์บนเว็บ: ไม้วัด + ผิวน้ำ ขนาดเล็ก
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', 'crop=300:420:330:0', '-q:v', '5', `${OUT}/gauge.jpg`]);
  const b = fs.readFileSync(crop).toString('base64');
  fs.rmSync(raw); fs.rmSync(crop);
  return b;
}

async function ask(img) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({contents: [{parts: [{text: PROMPT}, {inlineData: {mimeType: 'image/png', data: img}}]}],
      generationConfig: {responseMimeType: 'application/json', temperature: 0}})});
  const j = await r.json();
  const t = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('');
  if (!t) throw new Error('gemini ' + (j.error?.code || r.status));
  const v = JSON.parse(t);
  return Array.isArray(v) ? v[0] : v;
}

// ปากเกร็ด (เหนือน้ำ ~12 กม.) ใช้เช็คว่าค่าที่ AI อ่านไม่หลุดโลก
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

async function main() {
  const now = Date.now();
  const G = readJson(FILE, {h: [], alerts: {}});
  G.h = G.h.filter(h => now - Date.parse(h.t) < KEEP_H * 3600e3);
  let v, why;
  try { v = await ask(grab()); } catch (e) { why = 'ดึงภาพ/อ่านไม่สำเร็จ'; console.log('gauge:', e.message.split('\n')[0]); }
  const pk = await pakKret();
  why = why || reject(v, G.h, pk, now);
  const rec = {t: new Date(now).toISOString(), m: v?.level_m != null ? Math.round(v.level_m * 100) / 100 : null, ok: !why};
  if (why) rec.why = why;
  G.h.push(rec);
  G.pk = pk;
  G.levels = LEVELS;

  if (rec.ok) {
    const x = rec.m;
    const hourAgo = G.h.filter(h => h.ok && now - Date.parse(h.t) >= 50 * 60e3 && now - Date.parse(h.t) <= 80 * 60e3).pop();
    const rise = hourAgo ? Math.round((x - hourAgo.m) * 100) : null;
    const msgs = [];
    for (const L of LEVELS) {   // ข้ามขึ้นเหนือระดับ แจ้งซ้ำได้อีกเมื่อผ่านไป 12 ชม. (น้ำขึ้นลงวันละ 2 รอบ)
      const k = String(L);
      if (x >= L && (!G.alerts[k] || now - G.alerts[k] > 12 * 3600e3)) { msgs.push(`ถึง ${L.toFixed(2)} ม. แล้ว`); G.alerts[k] = now; }
    }
    if (rise != null && rise >= RISE_CM_1H && (!G.alerts.rise || now - G.alerts.rise > 3 * 3600e3)) {
      msgs.push(`ขึ้นเร็ว +${rise} ซม. ใน 1 ชม.`); G.alerts.rise = now;
    }
    if (msgs.length) await send(`🌊 <b>ไม้วัดท่าน้ำนนท์ ${x.toFixed(2)} ม.รทก.</b>\n${msgs.join(' · ')}` +
      (rise != null ? `\nเทียบ 1 ชม.ก่อน: ${rise >= 0 ? '+' : ''}${rise} ซม.` : '') +
      (pk ? `\nปากเกร็ด (สสน.) ${pk.wl.toFixed(2)} ม. · ตลิ่ง 2.50` : '') +
      `\n\n🔗 https://bangkho.ac.th/water/#gauge\n<i>AI อ่านจากกล้อง CCTV อาจคลาดเคลื่อน ไม่ใช่ประกาศทางการ</i>`);
  }
  fs.writeFileSync(FILE, JSON.stringify(G));
  console.log(`gauge: ${rec.ok ? rec.m + ' ม.' : 'ข้าม — ' + rec.why}`);
}

if (process.argv[1]?.endsWith('gauge.mjs') && process.argv[2] !== 'test') await main();

if (process.argv[2] === 'test') {   // node gauge.mjs test
  const t = Date.parse('2026-09-27T14:00:00Z'), ok = (m, min) => ({t: new Date(t - min * 60e3).toISOString(), m, ok: true});
  const V = m => ({visible: true, level_m: m, confidence: 0.8});
  const eq = (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); };
  eq(reject(V(2.37), [ok(2.35, 10)], {wl: 2.52}, t), '');
  eq(reject({visible: false}, [], null, t), 'มองไม่เห็นผิวน้ำ');
  eq(reject({...V(2.4), confidence: 0.3}, [], null, t), 'AI ไม่มั่นใจ');
  eq(reject(V(3.4), [], {wl: 2.5}, t), 'ต่างจากปากเกร็ดเกิน 60 ซม.');
  eq(reject(V(2.8), [ok(2.4, 10)], null, t), 'กระโดดเกิน 25 ซม. ใน 40 นาที');
  eq(reject(V(2.8), [ok(2.4, 120)], null, t), '');
  console.log('ok');
}
