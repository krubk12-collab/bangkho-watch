// นับการดึงข้อมูลภาครัฐ/สาธารณะของทุกสคริปต์ → ai-hub /hit (โหลดด้วย NODE_OPTIONS=--import ./govhit.mjs)
// ดัก globalThis.fetch ไม่ต้องแก้สคริปต์ทีละไฟล์ · ส่งยอดรวมครั้งเดียวตอนสคริปต์จบ (process.exit() ตรง ๆ จะไม่ถูกนับ)
const DATA = /(\.go\.th|\.or\.th|thaiwater\.net|open-meteo\.com|rainviewer\.com|jma\.go\.jp)$/;
const TOKEN = process.env.AI_HUB_TOKEN || process.env.AI_HUB_GAUGE;
const sys = 'watch:' + (process.argv[1] || '').split(/[\\/]/).pop().replace(/\.m?js$/, '');
const hits = {}, orig = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  let host = '';
  try { host = new URL(typeof input === 'string' ? input : input.url).hostname; } catch {}
  if (!DATA.test(host)) return orig(input, init);
  const t = Date.now(), h = hits[host] ??= { n: 0, err: 0, ms: 0 };
  h.n++;
  try {
    const r = await orig(input, init);
    if (!r.ok) h.err++;
    return r;
  } catch (e) { h.err++; throw e; }
  finally { h.ms += Date.now() - t; }
};

let sent = false;
process.on('beforeExit', async () => {
  if (sent || !TOKEN || !Object.keys(hits).length) return;
  sent = true;
  try {
    await orig('https://ai-hub.krubk12.workers.dev/hit', {
      method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ sys, hits }), signal: AbortSignal.timeout(8000) });
  } catch {}
});
