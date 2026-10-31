// ตัวตั้งเวลาสำรองให้ bangkho-watch — cron ของ GitHub เลื่อนเป็นทุก 2–5 ชม. (พบ 28ก.ย.69)
// Cloudflare cron ทุก 10 นาที → สั่ง workflow_dispatch ของ watch.yml
// 31ต.ค.69 + daily-digest 04:15 UTC (11:15 ไทย) — cron GitHub ของ digest มาช้า 3–7 ชม.
// secret GH_TOKEN = fine-grained token repo bangkho-watch + daily-digest สิทธิ์ Actions: read & write
const JOBS = {
  '*/10 * * * *': 'bangkho-watch/actions/workflows/watch.yml',
  '15 4 * * *': 'daily-digest/actions/workflows/daily-digest.yml',
};

export default {
  async scheduled(event, env, ctx) {
    const wf = JOBS[event.cron];
    if (!wf) throw new Error('ไม่รู้จัก cron ' + event.cron);
    const r = await fetch(`https://api.github.com/repos/krubk12-collab/${wf}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'bangkho-watch-cron',
      },
      body: JSON.stringify({ref: 'main'}),
    });
    if (r.status !== 204) throw new Error(`dispatch ${wf} ${r.status}: ${(await r.text()).slice(0, 200)}`);   // ขึ้นใน log ของ Worker
  },
};
