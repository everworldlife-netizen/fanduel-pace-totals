#!/usr/bin/env node
/* early-20: the handful of numbers quoted in the final report (team-game counts, hold variant, listed-view checks). */
'use strict';
const C = require('./early-common');
const a26 = C.load('2026'), a27 = C.load('2027');
const dates = [...new Set(a26.map((o) => o.d))].sort(); const mid = dates[Math.floor(dates.length / 2)];
const tg = (li) => new Set(li.map((o) => o.tg)).size;
const mae = (li, p) => li.reduce((a, o) => a + Math.abs(p(o) - o.ac), 0) / li.length;
for (const [ST, EL] of [['s6', 6], ['s12', 12]]) {
  console.log(`\n===== ${ST} =====`);
  for (const [season, all] of [['2026', a26], ['2027', a27]]) {
    const S = all.filter((o) => o.pre.sT === 1 && o.ac > 0), I = all.filter((o) => o.pre.sT === 0 && o[ST].dnp === 0), N = all.filter((o) => o.pre.sT === 0 && o[ST].dnp === 1);
    const rS = C.ols(S.map((o) => [1, o[ST].mn[0] - 29.5]), S.map((o) => o.ac - o[ST].mn[0]), S.map((o) => o.tg)), rI = C.ols(I.map((o) => [1, o[ST].mn[0] - 21]), I.map((o) => o.ac - o[ST].mn[0]), I.map((o) => o.tg));
    console.log(`${season}: starters n=${S.length} team-games ${tg(S)} slope ${rS.beta[1].toFixed(3)} z ${rS.z[1].toFixed(1)} | bench in n=${I.length} team-games ${tg(I)} slope ${rI.beta[1].toFixed(3)} z ${rI.z[1].toFixed(1)}`);
    // low / high number groups
    for (const [lab, li] of [['starters number<25', S.filter((o) => o[ST].mn[0] < 25)], ['starters number>=34', S.filter((o) => o[ST].mn[0] >= 34)], ['bench in number<17', I.filter((o) => o[ST].mn[0] < 17)], ['bench in number>=25', I.filter((o) => o[ST].mn[0] >= 25)]]) { const g = C.cl(li, (o) => o.ac - o[ST].mn[0]); console.log(`   ${lab.padEnd(22)} n=${li.length} team-games ${g.G} gap ${g.mean.toFixed(2)} z ${g.z.toFixed(1)}`); }
    // not in: played and listed, lastOut, demoted
    const Np = N.filter((o) => o.ac > 0); const gN = C.cl(Np, (o) => o.ac - o[ST].mn[0]), gNl = C.cl(N, (o) => o.ac - o[ST].mn[0]);
    console.log(`   bench not in: played n=${Np.length} team-games ${gN.G} gap ${gN.mean.toFixed(2)} z ${gN.z.toFixed(1)} | listed n=${N.length} gap ${gNl.mean.toFixed(2)} z ${gNl.z.toFixed(1)} | never in ${(100 * N.filter((o) => !(o.ac > 0)).length / N.length).toFixed(1)}% | usual bench check-in before now-1: ${N.filter((o) => o.f.nB >= 2 && o.f.ciBMed <= EL - 1).length} of ${N.filter((o) => o.f.nB >= 2).length}`);
    const LO = N.filter((o) => o.f.nT >= 1 && o.f.lastPlayed[0] === '0'), LI = N.filter((o) => o.f.nT >= 1 && o.f.lastPlayed[0] === '1');
    const gLO = C.cl(LO, (o) => o.ac - o[ST].mn[0]), gLI = C.cl(LI, (o) => o.ac - o[ST].mn[0]); const d = C.diff(LO, LI, (o) => o.ac - o[ST].mn[0]);
    console.log(`   not in & sat out last team game (listed): n=${LO.length} team-games ${gLO.G} gap ${gLO.mean.toFixed(2)} z ${gLO.z.toFixed(1)} never-in ${(100 * LO.filter((o) => !(o.ac > 0)).length / LO.length).toFixed(1)}% | played last game: n=${LI.length} gap ${gLI.mean.toFixed(2)} z ${gLI.z.toFixed(1)} never-in ${(100 * LI.filter((o) => !(o.ac > 0)).length / LI.length).toFixed(1)}% | difference ${d.d.toFixed(2)} z ${d.z.toFixed(1)}`);
    const DM = N.filter((o) => o.f.nP >= 2 && o.f.startShare >= 0.6), DMp = DM.filter((o) => o.ac > 0), ON = Np.filter((o) => !(o.f.nP >= 2 && o.f.startShare >= 0.6));
    if (DMp.length >= 15) { const g1 = C.cl(DMp, (o) => o.ac - o[ST].mn[0]), g2 = C.cl(DM, (o) => o.ac - o[ST].mn[0]), dd = C.diff(DMp, ON, (o) => o.ac - o[ST].mn[0]); console.log(`   demoted starter waiting: played n=${DMp.length} team-games ${g1.G} gap ${g1.mean.toFixed(2)} z ${g1.z.toFixed(1)} | listed n=${DM.length} gap ${g2.mean.toFixed(2)} z ${g2.z.toFixed(1)} | vs other not-in (played) difference ${dd.d.toFixed(2)} z ${dd.z.toFixed(1)} | engine ${(DMp.reduce((a, o) => a + o[ST].mn[0], 0) / DMp.length).toFixed(1)} tip-off# ${(DMp.reduce((a, o) => a + o.pre.mn[0], 0) / DMp.length).toFixed(1)} real ${(DMp.reduce((a, o) => a + o.ac, 0) / DMp.length).toFixed(1)}`); }
    // hold variant: show the tip-off number for bench not yet in
    const te = season === '2026' ? all.filter((o) => o.d >= mid) : all; const t10 = te.filter((o) => o.ac >= 10);
    const hold = (o) => (o.pre.sT === 0 && o[ST].dnp === 1 ? o.pre.pr[0] : o[ST].pr[0]);
    console.log(`   HOLD (tip-off number for bench not yet in), ${season === '2026' ? '2nd half 2026' : '2026-27'}: 10+ ${mae(t10, (o) => o[ST].pr[0]).toFixed(3)} -> ${mae(t10, hold).toFixed(3)} (${(100 * (mae(t10, hold) / mae(t10, (o) => o[ST].pr[0]) - 1)).toFixed(2)}%) vs tip-off ${mae(t10, (o) => o.pre.pr[0]).toFixed(3)} | listed ${mae(te, (o) => o[ST].pr[0]).toFixed(3)} -> ${mae(te, hold).toFixed(3)} (${(100 * (mae(te, hold) / mae(te, (o) => o[ST].pr[0]) - 1)).toFixed(2)}%)`);
    // class contributions to (stage - tip-off) on 10+
    const all10 = all.filter((o) => o.ac >= 10); let s = '';
    for (const [cn, cf] of [['starters', (o) => o.pre.sT === 1], ['bench in', (o) => o.pre.sT === 0 && o[ST].dnp === 0], ['bench not in', (o) => o.pre.sT === 0 && o[ST].dnp === 1]]) { const li = all10.filter(cf); const dlt = li.reduce((a, o) => a + Math.abs(o[ST].pr[0] - o.ac) - Math.abs(o.pre.pr[0] - o.ac), 0); s += ` ${cn}: n=${li.length} ${(dlt / li.length >= 0 ? '+' : '') + (dlt / li.length).toFixed(2)} each, ${(dlt / all10.length >= 0 ? '+' : '') + (dlt / all10.length).toFixed(3)} of total;`; }
    console.log(`   ${ST} minus tip-off miss on the same 10+ players (${season}): total ${(mae(all10, (o) => o[ST].pr[0]) - mae(all10, (o) => o.pre.pr[0])).toFixed(3)} =${s}`);
  }
}
