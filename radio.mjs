// สำเนาเพลย์ลิสต์อัตโนมัติ BK Radio → w/radio.json ให้ /keep/player2.html เล่นต่อตอน PHP โฮสต์ล่ม (ฟังอย่างเดียว)
// node radio.mjs <items> <ids> <out>
//   items = keep/api.php?action=list ({items}) หรือ data/items.json (array)
//   ids   = keep/api.php?action=remoteState ({autoIds}) หรือ data/autoplaylist.json ({ids})
// เก็บเฉพาะคลิป YouTube ในเพลย์ลิสต์ (ไฟล์เสียงบนโฮสต์เปิดไม่ได้ตอนล่มอยู่แล้ว) ฟิลด์ id/title/url เท่านั้น — repo นี้สาธารณะ
import fs from 'node:fs';
const [, , fi, fd, out] = process.argv;
const rd = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const I = rd(fi), D = rd(fd);
const items = Array.isArray(I) ? I : I.items || [];
const ids = D.autoIds || D.ids || [];
const yt = u => /(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/.test(u || '');
const by = Object.fromEntries(items.map(i => [i.id, i]));
const pl = ids.map(id => by[id]).filter(i => i && yt(i.url)).map(({id, title, url}) => ({id, title, url}));
if (!pl.length) { console.error('radio: ไม่มีเพลงในเพลย์ลิสต์ ไม่เขียนทับ'); process.exit(1); }
fs.writeFileSync(out, JSON.stringify({t: new Date().toISOString(), items: pl}));
console.log('radio:', pl.length, 'เพลง');
