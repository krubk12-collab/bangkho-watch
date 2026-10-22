// เตือนฝนแม้ปิดแอป (Today To Dry) — อ่านผู้รับจาก Worker todry-push → เรดาร์ RainViewer รอบจุดของแต่ละคน → สั่ง Worker ส่ง Web Push
// สูตรเดียวกับแอป (/todry/index.html motion + tl): ทิศฝนจากภาพ 1 ชม.ก่อน→ล่าสุด แล้วมองย้อนทิศลมว่าฝนจะถึงจุดนั้นเมื่อไร
// repo สาธารณะ → ห้าม log พิกัด/ชื่อจุด · env: TODRY_PUSH_ADMIN · ทดสอบ: node todry_push.mjs test
import assert from 'node:assert';
import {png, dbz} from './rain.mjs';
import {pathToFileURL} from 'node:url';

const API = 'https://todry-push.krubk12.workers.dev', P = 128, HOUR = 3600e3;

export function grid(px) { const m = new Uint8Array(65536); for (let i = 0; i < 65536; i++) m[i] = dbz(px[i * 4], px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3]); return m; }
export function motion(A, B) {   // เลื่อนภาพเก่า ±30 ช่อง หาตำแหน่งที่ทับภาพใหม่มากสุด (เหมือนแอป)
  const all = []; for (let i = 0; i < 65536; i++) if (A[i] >= 20) all.push(i);
  if (all.length < 30 || B.filter(v => v >= 20).length < 30) return null;
  const st = Math.ceil(all.length / 4000), pts = all.filter((_, k) => k % st === 0);
  let best = -1, bx = 0, by = 0;
  for (let dy = -30; dy <= 30; dy++) for (let dx = -30; dx <= 30; dx++) {
    let n = 0; for (const i of pts) { const x = (i & 255) + dx, y = (i >> 8) + dy; if (x >= 0 && x < 256 && y >= 0 && y < 256 && B[y * 256 + x] >= 20) n++; }
    if (n > best || (n === best && dx * dx + dy * dy < bx * bx + by * by)) { best = n; bx = dx; by = dy; }
  }
  return best < pts.length * 0.2 ? null : {dx: bx, dy: by};
}
const zAt = (G, x, y, r = 2) => { let m = 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = Math.round(x) + dx, Y = Math.round(y) + dy; if (X >= 0 && X < 256 && Y >= 0 && Y < 256) m = Math.max(m, G[Y * 256 + X]); } return m; };   // r=2 ≈ ±2.4 กม.

// → {wet} ฝนตกตรงนั้นแล้ว · {eta: นาทีหลังภาพล่าสุด} ฝนกำลังมา · null ไม่มี
export function check(M, L, mn, lat) {
  if (zAt(L, P, P, 1) >= 20) return {wet: true};
  const mv = M && motion(M, L); if (!mv) return null;
  const pxkm = 156543.03 * Math.cos(lat * Math.PI / 180) / 128 / 1000, len = Math.hypot(mv.dx, mv.dy);
  if (len * pxkm / mn * 60 < 4) return null;   // แทบไม่เคลื่อน
  const ppm = len / mn, ux = mv.dx / len, uy = mv.dy / len;
  for (let t = 5; t <= 90; t += 5) if (zAt(L, P - ux * ppm * t, P - uy * ppm * t) >= 20) return {eta: t};
  return null;
}

async function get(u, buf) { const r = await fetch(u, {signal: AbortSignal.timeout(20000)}); if (!r.ok) throw new Error(`${r.status}`); return buf ? Buffer.from(await r.arrayBuffer()) : r.json(); }

async function main() {
  if (process.argv[2] === 'test') return test();
  const auth = {Authorization: 'Bearer ' + process.env.TODRY_PUSH_ADMIN};
  if (!process.env.TODRY_PUSH_ADMIN) return console.log('todry_push: ไม่มี TODRY_PUSH_ADMIN ข้าม');
  const {subs} = await (await fetch(API + '/subs', {headers: auth})).json();
  if (!subs?.length) return console.log('todry_push: ยังไม่มีผู้รับ');
  const m = await get('https://api.rainviewer.com/public/weather-maps.json'), fr = m.radar.past, fL = fr.at(-1), fM = fr.at(-7) || fr[0];
  const mn = (fL.time - fM.time) / 60, now = Date.now(), hr = (new Date(now).getUTCHours() + 7) % 24, cache = {}, alerts = [];
  const tile = async (f, lat, lon) => grid(png(await get(`${m.host}${f.path}/256/7/${lat}/${lon}/2/0_0.png`, true)));
  for (const s of subs) {
    const k0 = s.lat + ',' + s.lon;
    cache[k0] ??= Promise.all([tile(fM, s.lat, s.lon).catch(() => null), tile(fL, s.lat, s.lon)]).then(([M, L]) => check(M, L, mn, s.lat)).catch(() => 'err');
    const r = await cache[k0]; if (!r || r === 'err') continue;
    const name = s.name || 'จุดเตือนของคุณ';
    let a = null; const car = s.app === 'carwash';   // /carwash/ ล้างรถ ใช้ระบบเดียวกัน ต่างแค่ข้อความ
    if (r.wet) a = {k: 'wet', body: car ? `ฝนเริ่มตกที่${name}แล้ว ถ้ารถเพิ่งล้าง จอดในร่มหรือรอฝนหยุดค่อยออกเดินทาง` : `ฝนเริ่มตกที่${name}แล้ว เก็บผ้าด่วน!`};
    else { const at = fL.time * 1000 + r.eta * 60e3, left = Math.round((at - now) / 60e3), hm = new Date(at + 7 * HOUR).toISOString().slice(11, 16);
      if (left >= 0 && left <= s.lead) a = {k: 'eta', body: car ? `${name}: ฝนอาจมาถึงราว ${hm} น. (อีก ~${left} นาที) อย่าเพิ่งล้างรถ ถ้าล้างแล้วหาที่จอดในร่มก่อนนะ` : `${name}: ฝนอาจมาถึงราว ${hm} น. (อีก ~${left} นาที) เก็บผ้าก่อนนะ`}; }
    if (a && car) a.title = '🚗 ล้างรถวันไหนดี';
    if (!a) continue;
    if (s.quiet && (hr >= 21 || hr < 6)) continue;
    if (s.lastk === a.k && now - (s.last || 0) < HOUR) continue;   // เตือนเรื่องเดิมไม่เกินชั่วโมงละครั้ง · มา→ตก เตือนซ้ำได้
    alerts.push({id: s.id, ...a});
  }
  let sent = [];
  for (let i = 0; i < alerts.length; i += 40)   // Worker ฟรีเรียกออกได้ 50 ครั้งต่อรอบ → ส่งทีละ 40
    sent.push(...((await (await fetch(API + '/alert', {method: 'POST', headers: {...auth, 'Content-Type': 'application/json'}, body: JSON.stringify({alerts: alerts.slice(i, i + 40)})})).json()).sent || []));
  console.log(`todry_push: ผู้รับ ${subs.length} · จุด ${Object.keys(cache).length} · เตือน ${alerts.length} · ส่งได้ ${sent.filter(x => x[1] >= 200 && x[1] < 300).length} · ภาพ ${Math.round((now - fL.time * 1000) / 60e3)} นาทีก่อน`);
}

function test() {
  const blank = () => new Uint8Array(65536), put = (G, cx, cy, r = 6) => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) G[y * 256 + x] = 35; return G; };
  // ฝนอยู่ทางตะวันตก 40 ช่อง เคลื่อนมาทางตะวันออก 10 ช่อง/ชม. → ถึงเราใน ~ (40-6-2)/10 ชม. ≈ 3 ชม. เกิน 90 นาที = null
  assert.equal(check(put(blank(), 78, 128), put(blank(), 88, 128), 60, 13.85), null);
  // เคลื่อน 20 ช่อง/ชม. ห่าง 20 ช่อง → ~36 นาที
  const r = check(put(blank(), 88, 128), put(blank(), 108, 128), 60, 13.85); assert.ok(r && r.eta >= 25 && r.eta <= 45, JSON.stringify(r));
  // ฝนเคลื่อนออกห่าง → null
  assert.equal(check(put(blank(), 108, 128), put(blank(), 88, 128), 60, 13.85), null);
  // ตกตรงนี้
  assert.deepEqual(check(blank(), put(blank(), 128, 128, 2), 60, 13.85), {wet: true});
  console.log('todry_push test ผ่าน');
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
