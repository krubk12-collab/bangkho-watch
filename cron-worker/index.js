// ตัวตั้งเวลาสำรองให้ bangkho-watch — cron ของ GitHub เลื่อนเป็นทุก 2–5 ชม. (พบ 28ก.ย.69)
// Cloudflare cron ทุก 10 นาที → สั่ง workflow_dispatch ของ watch.yml
// secret GH_TOKEN = fine-grained token เฉพาะ repo bangkho-watch สิทธิ์ Actions: read & write
export default {
  async scheduled(event, env, ctx) {
    const r = await fetch('https://api.github.com/repos/krubk12-collab/bangkho-watch/actions/workflows/watch.yml/dispatches', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'bangkho-watch-cron',
      },
      body: JSON.stringify({ref: 'main'}),
    });
    if (r.status !== 204) throw new Error(`dispatch ${r.status}: ${(await r.text()).slice(0, 200)}`);   // ขึ้นใน log ของ Worker
  },
};
