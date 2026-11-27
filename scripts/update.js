// Lấy tỷ số từ football-data.org rồi gộp vào results.json
const fs = require('fs');
const LG = { PL: 'EPL', PD: 'LL', SA: 'SA', BL1: 'BL', FL1: 'L1', CL: 'UCL' };
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

(async () => {
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) throw new Error('Thiếu secret FOOTBALL_DATA_KEY');
  // Mỗi lần gọi tối đa 10 ngày: một lần lấy kết quả, một lần lấy lịch sắp tới
  const matches = [];
  for (const [from, to] of [[-7, 2], [2, 12]]) {
    const url = `https://api.football-data.org/v4/matches?dateFrom=${day(from)}&dateTo=${day(to)}`;
    const res = await fetch(url, { headers: { 'X-Auth-Token': key } });
    if (!res.ok) throw new Error(`API lỗi ${res.status}: ${await res.text()}`);
    matches.push(...(await res.json()).matches);
  }

  let old = [];
  try { old = JSON.parse(fs.readFileSync('docs/results.json', 'utf8')); } catch {}
  // Giữ kết quả cũ; lịch chưa đá được lấy mới hoàn toàn ở mỗi lần chạy
  const all = new Map(old.filter(m => m.hs != null).map(m => [m.id, m]));
  for (const m of matches) {
    const lg = LG[m.competition.code];
    if (!lg || ['POSTPONED', 'CANCELLED', 'SUSPENDED'].includes(m.status)) continue;
    if (!m.homeTeam.name || !m.awayTeam.name) continue; // chưa xác định đội
    const done = m.status === 'FINISHED' && m.score.fullTime.home != null;
    // API đôi khi trả lại trạng thái cũ: không xóa tỷ số đã lưu
    if (!done && all.get(m.id)?.hs != null) continue;
    all.set(m.id, {
      id: m.id, lg, utc: m.utcDate,
      home: [m.homeTeam.name, m.homeTeam.shortName],
      away: [m.awayTeam.name, m.awayTeam.shortName],
      hs: done ? m.score.fullTime.home : null, as: done ? m.score.fullTime.away : null
    });
  }
  const out = [...all.values()].sort((a, b) => a.utc.localeCompare(b.utc) || a.id - b.id);
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/results.json', JSON.stringify(out, null, 1) + '\n');
  console.log(`Đã lưu ${out.length} trận (kết quả và lịch)`);
})().catch(e => { console.error(e.message); process.exit(1); });
