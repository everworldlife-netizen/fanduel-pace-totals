/* Pregame research: the registry of candidate signals. Each is a function(row) -> number, or null when it is not
 * defined for that row. Rows come from pregame-common.prepare() (r.f = point-in-time features). */
'use strict';
const C = require('./pregame-common');
const hinge = (v, c) => Math.max(0, v - c);
const st = (r) => (r.st === 1 ? 1 : 0);
const nz = (v) => (v == null || !isFinite(v) ? null : v);
module.exports = function build(season) {
const CAND = {};
// candidate signals: name -> function(row) -> number or null (null = not defined for this row)
const add = (name, fn, roles = true) => {
  CAND[name] = fn;
  if (roles) { CAND[name + '|S'] = (r) => { const v = fn(r); return v == null ? null : st(r) ? v : 0; }; CAND[name + '|B'] = (r) => { const v = fn(r); return v == null ? null : st(r) ? 0 : v; }; }
};
// A. volatility
add('sd8', (r) => nz(r.f.sd8)); add('sdSeason', (r) => nz(r.f.sdS)); add('cv8', (r) => (r.f.sd8 != null && r.mpg > 5 ? r.f.sd8 / r.mpg : null)); add('rng8', (r) => nz(r.f.rng8));
add('max8-mpg', (r) => (r.f.max8 != null ? r.f.max8 - r.mpg : null)); add('mpg-min8', (r) => (r.f.min8 != null ? r.mpg - r.f.min8 : null)); add('med8-mpg', (r) => (r.f.med8 != null ? r.f.med8 - r.mpg : null));
// C. last games vs usual / longer memory
add('l1', (r) => nz(r.f.l1)); add('l2', (r) => nz(r.f.l2)); add('l3', (r) => nz(r.f.l3)); add('prev1', (r) => nz(r.f.prev1)); add('slope5', (r) => nz(r.f.slope5));
add('seasonMpg-mpg', (r) => (r.f.seasonMpg != null ? r.f.seasonMpg - r.mpg : null)); add('l10Mpg-mpg', (r) => (r.f.l10Mpg != null ? r.f.l10Mpg - r.mpg : null));
add('cleanMpg-mpg', (r) => (r.f.cleanMpg != null ? r.f.cleanMpg - r.mpg : null));
add('l1*lastBlow', (r) => (r.f.l1 != null ? r.f.l1 * (r.f.lastBlow || 0) : null)); add('l1*lastClose', (r) => (r.f.l1 != null ? r.f.l1 * (1 - (r.f.lastBlow || 0)) : null));
add('l1*lastPf5', (r) => (r.f.l1 != null ? r.f.l1 * (r.f.lastPf5 || 0) : null)); add('l1*lastOT', (r) => (r.f.l1 != null ? r.f.l1 * (r.f.lastOT || 0) : null));
add('lastLeftEarly', (r) => nz(r.f.lastLeftEarly)); add('lastBlow', (r) => nz(r.f.lastBlow)); add('lastOT', (r) => nz(r.f.lastOT)); add('lastPf5', (r) => nz(r.f.lastPf5));
add('lastMarginWin15', (r) => (r.f.lastMargin != null ? (r.f.lastMargin >= 15 ? 1 : 0) : null)); add('lastMarginLoss15', (r) => (r.f.lastMargin != null ? (r.f.lastMargin <= -15 ? 1 : 0) : null));
add('blowShare', (r) => nz(r.f.blowShare)); add('blow15Share', (r) => nz(r.f.blow15Share)); add('blowWinShare', (r) => nz(r.f.blowWinShare)); add('blowLossShare', (r) => nz(r.f.blowLossShare));
add('otMin8', (r) => nz(r.f.otMin)); add('pf5Share', (r) => nz(r.f.pf5Share)); add('absMargin8', (r) => nz(r.f.absMargin8)); add('q4avg', (r) => nz(r.f.q4avg));
// D. fouls
add('pf36', (r) => nz(r.f.pf36)); add('pf36w', (r) => nz(r.f.pf36w));
// B. absences and returns
add('curAbs1-2', (r) => (r.f.curAbs == null ? null : r.f.curAbs >= 1 && r.f.curAbs <= 2 ? 1 : 0)); add('curAbs3-5', (r) => (r.f.curAbs == null ? null : r.f.curAbs >= 3 && r.f.curAbs <= 5 ? 1 : 0)); add('curAbs6+', (r) => (r.f.curAbs == null ? null : r.f.curAbs >= 6 ? 1 : 0));
for (const k of [1, 2, 3, 4, 5]) add(`back${k}_abs3+`, (r) => (r.f.curAbs == null ? null : r.f.curAbs === 0 && r.f.streak === k && r.f.absBefore >= 3 ? 1 : 0));
add('back2-5_abs3+', (r) => (r.f.curAbs == null ? null : r.f.curAbs === 0 && r.f.streak >= 2 && r.f.streak <= 5 && r.f.absBefore >= 3 ? 1 : 0));
add('back1-3_abs5+', (r) => (r.f.curAbs == null ? null : r.f.curAbs === 0 && r.f.streak >= 1 && r.f.streak <= 3 && r.f.absBefore >= 5 ? 1 : 0));
add('back1-3_abs1-2', (r) => (r.f.curAbs == null ? null : r.f.curAbs === 0 && r.f.streak >= 1 && r.f.streak <= 3 && r.f.absBefore >= 1 && r.f.absBefore <= 2 ? 1 : 0));
add('back6-10_abs3+', (r) => (r.f.curAbs == null ? null : r.f.curAbs === 0 && r.f.streak >= 6 && r.f.streak <= 10 && r.f.absBefore >= 3 ? 1 : 0));
add('preAbs-mpg(back<=5)', (r) => (r.f.curAbs === 0 && r.f.streak <= 5 && r.f.absBefore >= 3 && r.f.preAbsMpg != null ? r.f.preAbsMpg - r.mpg : r.f.curAbs == null ? null : 0));
add('preAbs-mpg(first back)', (r) => (r.f.curAbs > 0 && r.f.preAbsMpg != null ? r.f.preAbsMpg - r.mpg : r.f.curAbs == null ? null : 0));
add('ownRest4+', (r) => (r.f.ownRest == null ? null : r.f.ownRest >= 4 ? 1 : 0)); add('ownRest7+', (r) => (r.f.ownRest == null ? null : r.f.ownRest >= 7 ? 1 : 0)); add('ownRest1', (r) => (r.f.ownRest == null ? null : r.f.ownRest === 1 ? 1 : 0));
// H. new team
add('newTeam<=3', (r) => (r.f.newTeam && r.f.gamesHere <= 3 ? 1 : 0)); add('newTeam<=8', (r) => (r.f.newTeam && r.f.gamesHere <= 8 ? 1 : 0)); add('newTeam4-10', (r) => (r.f.newTeam && r.f.gamesHere >= 4 && r.f.gamesHere <= 10 ? 1 : 0));
add('firstHere', (r) => (r.f.gamesHere === 0 ? 1 : 0), false);
// E. coach's rotation
add('rotN10', (r) => nz(r.f.rotN10)); add('rotN10c', (r) => nz(r.f.rotN10c)); add('rotUsed', (r) => nz(r.f.rotUsed)); add('rotTop5', (r) => nz(r.f.rotTop5)); add('rotTop7', (r) => nz(r.f.rotTop7)); add('rotTop7c', (r) => nz(r.f.rotTop7c));
add('rotFives', (r) => nz(r.f.rotFives)); add('rotSd', (r) => nz(r.f.rotSd)); add('teamBlow8', (r) => nz(r.f.teamBlow8)); add('teamMargin8', (r) => nz(r.f.teamMargin8)); add('teamAbsMargin8', (r) => nz(r.f.teamAbsMargin8));
// team quality / season
add('teamWin', (r) => nz(r.f.teamWin)); add('teamNet', (r) => nz(r.f.teamNet)); add('oppNet', (r) => nz(r.f.oppNet));
add('late*badTeam', (r) => (r.f.teamWin == null ? null : r.d.slice(5) >= '03-01' && r.d.slice(5) < '07-01' && r.f.teamWin < 0.4 ? 1 : 0)); add('late*goodTeam', (r) => (r.f.teamWin == null ? null : r.d.slice(5) >= '03-01' && r.d.slice(5) < '07-01' && r.f.teamWin > 0.6 ? 1 : 0));
add('lateSeason', (r) => (r.d.slice(5) >= '03-15' && r.d.slice(5) < '07-01' ? 1 : 0)); add('early20', (r) => (r.f.teamG < 10 ? 1 : 0)); add('last2weeks', (r) => (r.d.slice(5) >= '04-01' && r.d.slice(5) < '07-01' ? 1 : 0));
// G. the books
add('fav', (r) => nz(r.f.fav)); add('absFav', (r) => (r.f.fav == null ? null : Math.abs(r.f.fav))); add('fav>4', (r) => (r.f.fav == null ? null : C.clamp((r.f.fav - 4) / 6, 0, 2))); add('dog>4', (r) => (r.f.fav == null ? null : C.clamp((-r.f.fav - 4) / 6, 0, 2)));
add('fav>10', (r) => (r.f.fav == null ? null : hinge(r.f.fav, 10))); add('dog>10', (r) => (r.f.fav == null ? null : hinge(-r.f.fav, 10))); add('total', (r) => (r.f.total ? (r.f.total - 228) / 10 : null));
add('pB', (r) => nz(r.pB));
// F. positions (posted list)
add('outSame', (r) => nz(r.f.outSame)); add('outOther', (r) => nz(r.f.outOther)); add('inSame', (r) => nz(r.f.inSame)); add('cntSame', (r) => nz(r.f.cntSame)); add('outTot', (r) => nz(r.f.outTot)); add('inTot', (r) => nz(r.f.inTot)); add('activeCount', (r) => nz(r.f.activeCount));
add('outStarters', (r) => nz(r.f.outStarters));
for (const p of ['G', 'F', 'C']) add('pos' + p, (r) => (r.f.pos ? (r.f.pos === p ? 1 : 0) : null));
// starting history (before lineups: nobody knows tonight's five)
add('startShare', (r) => nz(r.f.startShare)); add('lastStarted', (r) => nz(r.f.lastStarted)); add('started3', (r) => nz(r.f.started3));
add('lastStarted*lowMpg', (r) => (r.f.lastStarted == null ? null : r.f.lastStarted * C.clamp((30 - r.mpg) / Math.max(r.mpg, 6), 0, 2.5)), false);
add('notStartedLast*st', (r) => (r.f.lastStarted == null ? null : (1 - r.f.lastStarted) * st(r)), false);
// level of the engine's own number
add('mn', (r) => r.mn[0], true); add('mn>30', (r) => hinge(r.mn[0], 30)); add('mn>33', (r) => hinge(r.mn[0], 33)); add('mn>35', (r) => hinge(r.mn[0], 35)); add('mn<14', (r) => hinge(14, r.mn[0]), false); add('mn<10', (r) => hinge(10, r.mn[0]), false);
add('mn-mp', (r) => r.mn[0] - r.mp); add('mp', (r) => r.mp); add('mp>32', (r) => hinge(r.mp, 32)); add('mpg>32', (r) => hinge(r.mpg, 32)); add('gms', (r) => r.gms); add('gms<=3', (r) => (r.gms <= 3 ? 1 : 0)); add('usg', (r) => r.usg);


// level pieces (minutes)
add('moveBack', (r) => (r.f.regAvg != null && r.f.n >= 1 ? r.f.regAvg - r.mp : null));          // his own recent average minus the plain number
add('moveBack+', (r) => (r.f.regAvg != null && r.f.n >= 1 ? Math.max(r.f.regAvg - r.mp, 0) : null));
add('moveBack-', (r) => (r.f.regAvg != null && r.f.n >= 1 ? Math.min(r.f.regAvg - r.mp, 0) : null));
add('closeGap', (r) => (r.f.closeAvg != null ? r.f.closeAvg - r.f.regAvg : null));
add('fill', (r) => (r.f.closeAvg != null ? r.mp - r.f.closeAvg : null));
add('seasonGap', (r) => (r.f.seasonMpg != null ? r.f.seasonMpg - r.mpg : null));
add('otGap', (r) => (r.f.regAvg != null ? r.mpg - r.f.regAvg : null));
add('blowAvg-closeAvg', (r) => (r.f.blowAvg != null && r.f.nClose >= 2 ? r.f.blowAvg - r.f.closeAvg : null));
// long memory: this season so far, padded with last season's minutes a game (worth K games)
for (const K of [5, 10, 20]) add('longGap' + K, (r) => { const n = r.f.seasonN || 0; const sm = r.f.seasonMpg != null ? r.f.seasonMpg : null; if (sm == null && r.f.lastMpg == null) return null; const tot = (sm != null ? sm * n : 0) + (r.f.lastMpg != null ? K * r.f.lastMpg : 0), w = (sm != null ? n : 0) + (r.f.lastMpg != null ? K : 0); return w >= 3 ? tot / w - r.mpg : null; });
add('lastSeasonGap', (r) => (r.f.lastMpg != null ? r.f.lastMpg - r.mpg : null));
add('availN', (r) => nz(r.f.availN)); add('availN10', (r) => nz(r.f.availN10));
add('q4share', (r) => (r.f.q4avg != null && r.f.regAvg > 4 ? r.f.q4avg / r.f.regAvg : null));
add('q4-quarter', (r) => (r.f.q4avg != null && r.f.regAvg != null ? r.f.q4avg - r.f.regAvg / 4 : null));
// starting history against his usual: +1 = started the last game but rarely before (new starter), -1 = a usual starter who did not start the last one
add('startDrift', (r) => (r.f.lastStarted != null && r.f.startShare != null ? r.f.lastStarted - r.f.startShare : null));
add('newStarter', (r) => (r.f.lastStarted != null ? (r.f.lastStarted === 1 && r.f.startShare < 0.5 ? 1 : 0) : null));
add('demoted', (r) => (r.f.lastStarted != null ? (r.f.lastStarted === 0 && r.f.startShare >= 0.5 ? 1 : 0) : null));
add('lowMinStarter', (r) => (r.f.startShare != null ? (r.st !== 1 && r.f.startShare >= 0.5 && r.f.lastStarted === 1 ? 1 : 0) : null), false);
// first game back: team games he missed right before tonight
add('firstBack', (r) => (r.f.curAbs == null ? null : r.f.curAbs >= 1 ? 1 : 0));
add('firstBackN', (r) => (r.f.curAbs == null ? null : Math.min(r.f.curAbs, 6)));
add('firstBack3+', (r) => (r.f.curAbs == null ? null : r.f.curAbs >= 3 ? 1 : 0));
add('restDays7+', (r) => (r.f.ownRest == null ? null : r.f.ownRest >= 7 ? 1 : 0));
add('restDays>3', (r) => (r.f.ownRest == null ? null : C.clamp(r.f.ownRest - 3, 0, 10)));
// dressed players tonight (posted list)
add('short<=9', (r) => (r.f.activeCount == null ? null : r.f.activeCount <= 9 ? 1 : 0)); add('short<=10', (r) => (r.f.activeCount == null ? null : r.f.activeCount <= 10 ? 1 : 0));
add('dressed-13', (r) => (r.f.activeCount == null ? null : r.f.activeCount - 13)); add('dressed<12', (r) => (r.f.activeCount == null ? null : Math.max(12 - r.f.activeCount, 0))); add('dressed>13', (r) => (r.f.activeCount == null ? null : Math.max(r.f.activeCount - 13, 0)));
add('availShort', (r) => (r.f.availN == null ? null : Math.max(9 - r.f.availN, 0)));
// robust usual minutes: drop his lowest recent game when it is under 60% of his median
add('robustGap', (r) => (r.f.robust != null ? r.f.robust - r.mpg : null));
add('lowOutlier', (r) => (r.f.min8 != null && r.f.med8 != null ? (r.f.min8 < 0.6 * r.f.med8 ? 1 : 0) : null));
add('rest', (r) => r.rest);            // what the engine adds after its learned factor (refill of cut minutes, team scaling, overtime)
add('rest>1', (r) => Math.max(r.rest - 1, 0));
add('lin', (r) => r.lin);
return CAND;
};
