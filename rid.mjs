// น้ำเหนือจากรายงานรายวันกรมชลประทาน (SWOC daily.pdf) — C.29B สามโคก ไม่มีใน สสน. ต้องถอดจาก PDF
// ดึง C.2 / C.13 / เขื่อนพระรามหก / C.29B (ลบ.ม./วิ วันนี้+เมื่อวาน) + ความเค็มท่าน้ำนนท์ → rid.json (เก็บย้อนหลัง 14 วัน)
// api.php บนเว็บอ่าน rid.json ไปใส่ D.rid → assess.js ใช้เป็นปัจจัยต้นทาง (ดันได้แค่เฝ้าระวัง)
// ต้องมี pdftotext (poppler-utils) · env: OUT_DIR, FORCE=1 · ทดสอบ: node rid.mjs <ไฟล์.txt ที่ถอดแล้ว>
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';

const URL = 'https://water.rid.go.th/flood/flood/daily.pdf';
const OUT = process.env.OUT_DIR || '.';
const FILE = `${OUT}/rid.json`;
const EVERY_H = 2;                        // ponytail: PDF ออกวันละครั้งช่วงเช้า ดึงทุก 2 ชม. พอ
const MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const PDF = os.tmpdir() + '/rid.pdf';
const num = s => +s.replace(/,/g, '');

// pdftotext ทำสระไทยสลับที่ (เช่น "เม่ือวาน") → ยึดคำภาษาอังกฤษ/ตัวเลขเป็นหลัก
export function parse(txt) {
  const T = txt.replace(/\s+/g, ' ');
  const flow = anchor => {
    const i = T.indexOf(anchor);
    if (i < 0) return null;
    const m = [...T.slice(i, i + 300).matchAll(/([\d,]{2,})\s*ลบ\.\s*ม/g)];
    return m.length ? {q: num(m[0][1]), prev: m[1] ? num(m[1][1]) : null} : null;
  };
  const d = T.match(new RegExp(`(\\d{1,2}) (${MON.map(m => m.replace(/\./g, '\\.')).join('|')}) (25\\d\\d)`));
  const s = T.match(/นนทบุรี จ\.นนทบุรี ([\d.]+) (\S+)/);
  return {
    date: d ? `${+d[3] - 543}-${String(MON.indexOf(d[2]) + 1).padStart(2, '0')}-${d[1].padStart(2, '0')}` : null,
    c2: flow('สถานี C.2 '), c13: flow('สถานี C.13'), rama6: flow('พระรามหก'), c29b: flow('C.29B'),
    salt: s ? {v: +s[1], status: s[2]} : null,
  };
}

async function main() {
  const prev = (() => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } })();
  if (process.argv[2]) { console.log(JSON.stringify(parse(fs.readFileSync(process.argv[2], 'utf8')), null, 1)); return; }
  if (!process.env.FORCE && prev.fetched && Date.now() - new Date(prev.fetched) < EVERY_H * 36e5) { console.log('rid: ยังไม่ครบรอบ'); return; }
  const r = await fetch(URL, {headers: {'user-agent': 'Mozilla/5.0'}, signal: AbortSignal.timeout(60000)});
  if (!r.ok) throw new Error('rid: HTTP ' + r.status);
  fs.writeFileSync(PDF, Buffer.from(await r.arrayBuffer()));
  const p = parse(execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', PDF, '-']).toString());
  // ค่าแปลก = รูปแบบ PDF เปลี่ยน → ไม่เขียนทับของเดิม
  if (!p.date || !p.c29b || p.c29b.q < 50 || p.c29b.q > 8000) { console.log('rid: ถอดไม่ได้', JSON.stringify(p)); return; }
  const {salt, ...flows} = p;
  const hist = [...(prev.hist || []).filter(h => h.date !== p.date),
    {date: p.date, ...Object.fromEntries(Object.entries(flows).filter(([k]) => k !== 'date').map(([k, v]) => [k, v?.q ?? null])), salt: salt?.v ?? null}]
    .sort((a, b) => a.date < b.date ? -1 : 1).slice(-14);
  fs.writeFileSync(FILE, JSON.stringify({fetched: new Date().toISOString(), src: URL, ...p, hist}));
  console.log(`rid: ${p.date} C.29B ${p.c29b.q} (เมื่อวาน ${p.c29b.prev}) พระรามหก ${p.rama6?.q}`);
}
main().catch(e => { console.log(String(e.message || e)); process.exitCode = 1; });
