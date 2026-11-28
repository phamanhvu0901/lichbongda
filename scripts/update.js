// Lấy tỷ số từ football-data.org (châu Âu) và Highlightly (AFC Champions League Elite) rồi gộp vào results.json
const fs = require('fs');
const LG = { PL: 'EPL', PD: 'LL', SA: 'SA', BL1: 'BL', FL1: 'L1', CL: 'UCL' };
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

// ---- AFC Champions League Elite (Highlightly)
const ACLE_LEAGUE = 'AFC Champions League Elite'; // đổi nếu Highlightly đặt tên giải khác
// Tên Highlightly có thể dùng khác với tên trên trang. Thêm vào đây khi log báo "Chưa khớp"
const ACLE_ALIAS = {
  'Al Quwa Al Jawiya': ['Air Force', 'Al Quwa Al Jawiya SC'],
  'Neftchi': ['Neftchi Fargona', 'Neftchi Fergana'],
  'Jeonbuk Hyundai Motors': ['Jeonbuk Motors', 'Jeonbuk'],
  'Daejeon Hana Citizen': ['Daejeon Citizen', 'Daejeon'],
  'Công an Hà Nội': ['Cong An Ha Noi', 'Hanoi Police'],
};
const simple = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/ø/gi, 'o')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
  .filter(w => w && !['fc', 'sc', 'sfc', 'cf', 'club'].includes(w)).join(' ');
const same = (ours, api) => [ours, ...(ACLE_ALIAS[ours] || [])].some(n => simple(n) === simple(api));

async function addAcle(all) {
  const key = process.env.HIGHLIGHTLY_API_KEY;
  if (!key) { console.log('AFC Elite: chưa có HIGHLIGHTLY_API_KEY, bỏ qua'); return; }
  // Lịch AFC Elite đọc thẳng từ trang: dòng "ACLE|chủ nhà|khách|giờ UTC|bàn chủ|bàn khách"
  const fixtures = fs.readFileSync('docs/index.html', 'utf8').split(/\r?\n/)
    .filter(l => l.startsWith('ACLE|'))
    .map(l => { const [, h, a, iso, hs] = l.split('|'); return { h, a, hs, t: Date.parse(iso + ':00Z') }; });
  const saved = [...all.values()].filter(m => m.lg === 'ACLE');
  const now = Date.now();
  // Chỉ hỏi những trận đã đá xong trong 7 ngày qua mà chưa có tỷ số, để tiết kiệm lượt gọi
  const pending = fixtures.filter(f => !f.hs && now >= f.t + 115 * 60000 && now - f.t < 7 * 864e5
    && !saved.some(m => m.home[0] === f.h && m.away[0] === f.a));
  if (!pending.length) { console.log('AFC Elite: không có trận nào đang chờ tỷ số'); return; }

  const dateOf = f => new Date(f.t).toISOString().slice(0, 10);
  // Tối đa 2 yêu cầu mỗi lần chạy, ưu tiên ngày mới nhất
  const dates = [...new Set(pending.map(dateOf))].sort().reverse().slice(0, 2);
  for (const date of dates) {
    const url = 'https://soccer.highlightly.net/matches?' + new URLSearchParams({ leagueName: ACLE_LEAGUE, date });
    const res = await fetch(url, { headers: { 'x-rapidapi-key': key } });
    if (!res.ok) throw new Error(`Highlightly lỗi ${res.status}`);
    const list = (await res.json()).data || [];
    console.log(`AFC Elite ${date}: Highlightly trả về ${list.length} trận`);
    for (const f of pending.filter(p => dateOf(p) === date)) {
      const m = list.find(x => same(f.h, x.homeTeam.name) && same(f.a, x.awayTeam.name));
      if (!m) {
        console.log(`  Chưa khớp: ${f.h} - ${f.a}. Tên bên Highlightly: ${list.map(x => `${x.homeTeam.name} - ${x.awayTeam.name}`).join('; ') || '(trống)'}`);
        continue;
      }
      const score = /^(\d+)\s*-\s*(\d+)$/.exec(m.state?.score?.current || '');
      if (!/^Finished/.test(m.state?.description || '') || !score) continue; // chưa kết thúc
      // id âm để không trùng với id của football-data.org; tên đội ghi đúng như trên trang
      all.set(-m.id, {
        id: -m.id, lg: 'ACLE', utc: new Date(f.t).toISOString(),
        home: [f.h, f.h], away: [f.a, f.a], hs: +score[1], as: +score[2]
      });
      console.log(`  ${f.h} ${score[1]}-${score[2]} ${f.a}`);
    }
  }
}

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
  // Highlightly lỗi thì chỉ ghi log, không làm hỏng phần cập nhật châu Âu
  try { await addAcle(all); } catch (e) { console.warn('AFC Elite:', e.message); }

  const out = [...all.values()].sort((a, b) => a.utc.localeCompare(b.utc) || a.id - b.id);
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/results.json', JSON.stringify(out, null, 1) + '\n');
  console.log(`Đã lưu ${out.length} trận (kết quả và lịch)`);
})().catch(e => { console.error(e.message); process.exit(1); });
