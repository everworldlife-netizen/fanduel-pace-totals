'use strict';
const path = require('path');
const L = require('../lib');
for (const s of [2026, 2027]) {
  const rows = L.readJSON(path.join(L.DATA, 'research', `pregame-rows-${s}.json.gz`));
  const un = rows.filter((r) => r.un);
  const dup = {}; for (const r of un) { const k = r.id + ':' + r.pid; dup[k] = (dup[k] || 0) + 1; }
  const dc = {}; for (const v of Object.values(dup)) dc[v] = (dc[v] || 0) + 1;
  console.log(s, 'un rows', un.length, 'per (game,player) multiplicity', dc);
  for (const g of ['rep', 'pre']) {
    const rs = rows.filter((r) => r.g === g);
    const games = new Set(rs.map((r) => r.id));
    const played = rs.filter((r) => r.ac && r.ac[0] > 0), p10 = rs.filter((r) => r.ac && r.ac[0] >= 10);
    const nul = rs.filter((r) => !r.ac), zero = rs.filter((r) => r.ac && !(r.ac[0] > 0));
    const mean = (a, f) => a.reduce((x, r) => x + f(r), 0) / a.length;
    console.log(g, 'rows', rs.length, 'games', games.size, 'played', played.length, 'p10', p10.length, 'ac null', nul.length, 'ac min 0', zero.length);
    console.log('  miss10 |pr-ac|', mean(p10, (r) => Math.abs(r.pr[0] - r.ac[0])).toFixed(3), 'bias played (ac-mn)', mean(played, (r) => r.ac[0] - r.mn[0]).toFixed(3), 'bias p10', mean(p10, (r) => r.ac[0] - r.mn[0]).toFixed(3),
      'mean mn of ac-null', nul.length ? mean(nul, (r) => r.mn[0]).toFixed(2) : '-', 'pr==mn?', mean(rs, (r) => Math.abs(r.pr[0] - r.mn[0])).toFixed(4), 'mp-mn', mean(rs, (r) => r.mn[0] - r.mp).toFixed(3));
    // by role
    for (const [nm, f] of [['st', (r) => r.st === 1], ['mid 18-24', (r) => r.st !== 1 && r.mpg >= 18], ['bench 10-18', (r) => r.mpg < 18 && r.mpg >= 10], ['low <10', (r) => r.mpg < 10], ['fr', (r) => r.fr === 1], ['dp', (r) => r.dp === 1]]) {
      const a = played.filter(f), b = a.filter((r) => r.ac[0] >= 10), c = rs.filter(f).filter((r) => !r.ac || !(r.ac[0] > 0));
      console.log('   ', nm.padEnd(12), 'played', String(a.length).padStart(6), 'bias', mean(a, (r) => r.ac[0] - r.mn[0]).toFixed(2), 'p10 n', b.length, 'miss', b.length ? mean(b, (r) => Math.abs(r.pr[0] - r.ac[0])).toFixed(2) : '-', '| did not play', c.length, 'their mn', c.length ? mean(c, (r) => r.mn[0]).toFixed(2) : '-');
    }
    // team sums
    const tg = {}; for (const r of rs) { const k = r.id + ':' + r.tm; const t = tg[k] = tg[k] || { mn: 0, ac: 0, n: 0 }; t.mn += r.mn[0]; t.ac += r.ac ? r.ac[0] : 0; t.n++; }
    const T = Object.values(tg);
    console.log('  team-games', T.length, 'avg sum mn', mean(T, (t) => t.mn).toFixed(2), 'avg sum ac (projected players)', mean(T, (t) => t.ac).toFixed(2), 'avg n', mean(T, (t) => t.n).toFixed(2), 'sd sum mn', Math.sqrt(mean(T, (t) => (t.mn - mean(T, (u) => u.mn)) ** 2)).toFixed(2));
  }
}
