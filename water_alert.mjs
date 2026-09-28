// เฝ้าระดับน้ำ ณ โรงเรียนชุมชนวัดบางโค แล้วแจ้ง Telegram เมื่อระดับเปลี่ยน
// ใช้สูตรเดียวกับหน้าเว็บ: ดึง /water/assess.js จากเว็บจริงมาคำนวณ (แก้เกณฑ์ที่เดียว)
// env: TG_TOKEN, TG_CHAT, OUT_DIR (เก็บ water.json = สถานะรอบก่อน), DRY_RUN=1 (พิมพ์ข้อความแทนการส่ง)
// repo สาธารณะ → ห้าม print token/chat id หรือเนื้อหาข้อความลง log
import fs from 'node:fs';

const SITE = 'https://bangkho.ac.th/water/';
const OUT = process.env.OUT_DIR || '.';
const STATE_FILE = `${OUT}/water.json`;
const ICON = ['🟢', '🟡', '🟠', '🔴'];
const dry = process.env.DRY_RUN === '1';

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return null; } };
const saveState = s => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1));

async function assessNow() {
  const code = await (await fetch(SITE + 'assess.js', {cache: 'no-store'})).text();
  globalThis.window = globalThis;
  new Function(code)();
  const r = await globalThis.WaterAssess.load(SITE + 'api.php');
  if (!r.D || !r.D.stations) throw new Error('api ไม่ตอบ');
  return r;
}

function message(a, prevLvl) {
  const W = globalThis.WaterAssess;
  const arrow = prevLvl == null ? '' : a.lvl > prevLvl ? ` ⬆️ (จาก${W.NAMES[prevLvl]})` : ` ⬇️ (จาก${W.NAMES[prevLvl]})`;
  const pick = list => [...list.filter(x => x[0] >= 1), ...list.filter(x => x[0] === 0)].slice(0, 4)
    .map(x => `${ICON[x[0]]} ${x[1].replace(/<(?!\/?b>)[^>]+>/g, '')}`).join('\n');
  // น้ำขึ้นลงวันละ 2 รอบ — บอกยอด/ต่ำสุดแต่ละรอบเทียบตลิ่ง (ระดับคิดจากยอด 24 ชม. จึงไม่สลับตามน้ำขึ้นลง)
  const tide = a.tide && a.tide.length ? `<b>น้ำขึ้น-ลง คลองมหาสวัสดิ์</b> (ตลิ่ง ${a.canal.bank.toFixed(2)} ม.)\n` +
    a.tide.map(r => `${r.type === 'hi' ? '⬆️' : '⬇️'} ${r.when} ${r.day} ${r.time} <b>${r.v.toFixed(2)}</b> ${r.over ? `เกินตลิ่ง +${r.cm}` : `ต่ำกว่าตลิ่ง ${-r.cm}`} ซม.`).join('\n') + '\n\n' : '';
  return `${ICON[a.lvl]} <b>ระดับเฝ้าระวัง ณ โรงเรียนชุมชนวัดบางโค: ${a.name}</b>${arrow}\n${a.advice}\n\n` +
    `<b>ในพื้นที่รอบโรงเรียน</b>\n${pick(a.L)}\n\n${tide}<b>ต้นทาง</b>\n${pick(a.U)}\n\n` +
    `🔗 ${SITE}\n<i>ประเมินอัตโนมัติ ไม่ใช่ประกาศทางการ · เหตุฉุกเฉินโทร 1784</i>`;
}

async function send(text) {
  if (dry) { console.log('--- DRY_RUN ---\n' + text); return; }
  const r = await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chat_id: process.env.TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true})});
  const j = await r.json();
  if (!j.ok) throw new Error('telegram ' + (j.error_code || r.status));
}

// เน็ตจาก runner GitHub → โฮสต์ไทย/Open-Meteo สะดุดบ่อย (เคยข้าม 4 ใน 60 รอบ "fetch failed") → ลองซ้ำ 3 ครั้ง ห่าง 15 วิ
let r, why = '';
for (let i = 0; i < 3; i++) {
  if (i) await new Promise(ok => setTimeout(ok, 15000));
  try { r = await assessNow(); why = r.FC && r.TIDE ? '' : 'พยากรณ์ยังโหลดไม่ครบ'; }
  catch (e) { r = null; why = e.cause?.code || e.message; }
  if (!why) break;
}
// เว็บล่ม watch.py แจ้งอยู่แล้ว · ข้อมูลขาดห้ามคำนวณ ไม่งั้นระดับตกเพราะข้อมูลหาย
if (why) { console.log('water: ข้ามรอบนี้ (ลอง 3 ครั้ง) —', why); process.exit(0); }

const a = r.a, now = new Date().toISOString();
const st = readState() || {};
// ยืนยัน 2 รอบติดกันก่อนแจ้ง (กันค่าที่แกว่งชั่วคราว) — ยกเว้นขึ้นเป็นวิกฤตแจ้งทันที
const seen = st.pendingLvl === a.lvl ? (st.pendingCount || 0) + 1 : 1;
let sent = false;
if (st.alertedLvl == null) {
  await send('📡 เริ่มเฝ้าระวังน้ำอัตโนมัติ (ตรวจทุก 10 นาที แจ้งเมื่อระดับเปลี่ยน)\n\n' + message(a, null)); sent = true;
} else if (a.lvl !== st.alertedLvl && (seen >= 2 || a.lvl === 3)) {
  await send(message(a, st.alertedLvl)); sent = true;
}
// ดาวเทียม GISTDA: แจ้งเมื่อพบตำบลใหม่ที่น้ำท่วมขังในนนทบุรี/อำเภอใกล้เคียง (3 วันล่าสุด)
const g3 = r.GI && r.GI['3days'];
let gSeen = st.gistdaSeen || [];
if (g3) {
  const rows = [...g3.nont.map(x => [...x, 1]), ...g3.near.map(x => [...x, 0])];
  const fresh = rows.filter(x => !gSeen.includes(x.slice(0, 3).join('|')));
  if (fresh.length) {
    const inNont = fresh.filter(x => x[6]);
    await send(`🛰️ <b>ดาวเทียม GISTDA พบน้ำท่วมขัง${inNont.length ? 'ใน<u>นนทบุรี</u>' : 'ใกล้นนทบุรี'} ${fresh.length} ตำบลใหม่</b>\n` +
      fresh.slice(0, 10).map(x => `${x[6] ? '🔴' : '🟡'} ${x[2]} ${x[1]} ${x[0].replace('จ.', '')} · ${x[3].toLocaleString('th-TH')} ไร่`).join('\n') +
      (fresh.length > 10 ? `\n… และอีก ${fresh.length - 10} ตำบล` : '') +
      `\n\n🔗 ${SITE}#sat\n<i>ข้อมูลภาพดาวเทียม 3 วันล่าสุดจาก disaster.gistda.or.th</i>`);
  }
  gSeen = rows.map(x => x.slice(0, 3).join('|'));   // ตำบลที่หายไปแล้วกลับมาใหม่ = แจ้งอีกรอบ
}
saveState({
  gistdaSeen: gSeen,
  lvl: a.lvl, name: a.name, checkedAt: now,
  alertedLvl: sent ? a.lvl : st.alertedLvl, alertedAt: sent ? now : st.alertedAt,
  pendingLvl: a.lvl, pendingCount: seen,
});
console.log(`water: ระดับ ${a.lvl}${sent ? ' (ส่งแจ้งเตือนแล้ว)' : ''}`);
