// Lấy tỷ số từ football-data.org rồi gộp vào results.json
const fs = require('fs');
const LG = { PL: 'EPL', PD: 'LL', SA: 'SA', BL1: 'BL', FL1: 'L1', CL: 'UCL' };
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

(async () => {
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) throw new Error('Thiếu secret FOOTBALL_DATA_KEY');
  const url = `https://api.football-data.org/v4/matches?dateFrom=${day(-7)}&dateTo=${day(2)}`;
  const res = await fetch(url, { headers: { 'X-Auth-Token': key } });
  if (!res.ok) throw new Error(`API lỗi ${res.status}: ${await res.text()}`);
  const { matches } = await res.json();

  let old = [];
  try { old = JSON.parse(fs.readFileSync('docs/results.json', 'utf8')); } catch {}
  const all = new Map(old.map(m => [m.id, m]));
  for (const m of matches) {
    const lg = LG[m.competition.code];
    if (!lg || m.status !== 'FINISHED' || m.score.fullTime.home == null) continue;
    all.set(m.id, {
      id: m.id, lg, utc: m.utcDate,
      home: [m.homeTeam.name, m.homeTeam.shortName],
      away: [m.awayTeam.name, m.awayTeam.shortName],
      hs: m.score.fullTime.home, as: m.score.fullTime.away
    });
  }
  const out = [...all.values()].sort((a, b) => a.utc.localeCompare(b.utc) || a.id - b.id);
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/results.json', JSON.stringify(out, null, 1) + '\n');
  console.log(`Đã lưu ${out.length} kết quả`);
})().catch(e => { console.error(e.message); process.exit(1); });
