'use strict';
/* The scenario book of the audit. Every scenario is a yes/no question about a row that the live app can answer at that
 * moment (row fields, the tip-off row of the same game, the closing line). [name, group, predicate, where]
 * where: 'any' = every stage, 'live' = game in progress, 'tip' = tip-off stage on (needs the posted lineup). */
const C = require('./audit-common');
const IX = C.IX;
const live = (r) => r._s >= 2;
const per = (r) => Math.min((r.per || Math.ceil(r.el / 12)) + 1, 5); // the engine's foul-trouble line
const S = [];
const add = (name, group, f, where = 'any') => S.push({ name, group, f, where });

add('everyone', 'base', () => true);
// --- score right now (team's lead; negative = behind)
add('lead 20+', 'margin', (r) => r.mg >= 20, 'live');
add('lead 13-19', 'margin', (r) => r.mg >= 13 && r.mg <= 19, 'live');
add('lead 6-12', 'margin', (r) => r.mg >= 6 && r.mg <= 12, 'live');
add('close (within 5)', 'margin', (r) => Math.abs(r.mg) <= 5, 'live');
add('within 2', 'margin', (r) => Math.abs(r.mg) <= 2, 'live');
add('trail 6-12', 'margin', (r) => r.mg <= -6 && r.mg >= -12, 'live');
add('trail 13-19', 'margin', (r) => r.mg <= -13 && r.mg >= -19, 'live');
add('trail 20+', 'margin', (r) => r.mg <= -20, 'live');
add('lopsided 13+ either way', 'margin', (r) => Math.abs(r.mg) >= 13, 'live');
add('lopsided 20+ either way', 'margin', (r) => Math.abs(r.mg) >= 20, 'live');
// --- fouls for the time
add('foul trouble flag', 'fouls', (r) => r.x[IX.fouls] === 1, 'live');
add('one foul short of trouble', 'fouls', (r) => r.pf === per(r) - 1 && r.pf >= 1 && r.pf < 5, 'live');
add('fouls 1.0+ over the pace (pfX>=1)', 'fouls', (r) => r.x[IX.pfX] >= 1, 'live');
add('fouls 0 to 1 over the pace', 'fouls', (r) => r.x[IX.pfX] > 0 && r.x[IX.pfX] < 1, 'live');
add('no fouls yet (has played)', 'fouls', (r) => r.pf === 0 && r.now[0] >= 3, 'live');
add('5 fouls', 'fouls', (r) => r.pf === 5, 'live');
add('4 fouls', 'fouls', (r) => r.pf === 4, 'live');
add('3 fouls', 'fouls', (r) => r.pf === 3, 'live');
add('2 fouls', 'fouls', (r) => r.pf === 2, 'live');
// --- his own scoring pace (points so far against his rate x minutes so far)
add('scoring far ahead of pace (z>=1.5)', 'hot', (r) => r._hot != null && r._hot >= 1.5, 'live');
add('scoring ahead (0.75..1.5)', 'hot', (r) => r._hot != null && r._hot >= 0.75 && r._hot < 1.5, 'live');
add('scoring behind (-1.5..-0.75)', 'hot', (r) => r._hot != null && r._hot <= -0.75 && r._hot > -1.5, 'live');
add('scoring far behind pace (z<=-1.5)', 'hot', (r) => r._hot != null && r._hot <= -1.5, 'live');
// --- where he is right now
add('on the floor', 'floor', (r) => r.on === 1, 'live');
add('off the floor (has played)', 'floor', (r) => r.on === 0 && r.dnp === 0, 'live');
add('off, sat under 3 min', 'floor', (r) => r.on === 0 && r.dnp === 0 && r.x[IX.sitLong] < 0.5, 'live');
add('off, sat 3-6 min', 'floor', (r) => r.on === 0 && r.dnp === 0 && r.x[IX.sitLong] >= 0.5 && r.x[IX.sitLong] < 1, 'live');
add('off, sat 6-12 min', 'floor', (r) => r.x[IX.sitLong] >= 1 && r.x[IX.sitLong] < 2, 'live');
add('off, sat 12+ min', 'floor', (r) => r.x[IX.sitLong] >= 2, 'live');
add('not checked in yet', 'floor', (r) => r.dnp === 1, 'live');
add('minutes ahead of usual pattern (minTrack>=+0.25)', 'floor', (r) => r.x[IX.minTrack] >= 0.25, 'live');
add('minutes behind usual pattern (minTrack<=-0.25)', 'floor', (r) => r.x[IX.minTrack] <= -0.25, 'live');
// --- role
add('starts tonight', 'role', (r) => r.sT === 1, 'tip');
add('comes off the bench tonight', 'role', (r) => r.sT === 0, 'tip');
add('usual starter who starts', 'role', (r) => r.st === 1 && r.sT === 1, 'tip');
add('usual starter off the bench', 'role', (r) => r.st === 1 && r.sT === 0, 'tip');
add('reserve who starts', 'role', (r) => r.st !== 1 && r.sT === 1, 'tip');
add('reserve off the bench', 'role', (r) => r.st !== 1 && r.sT === 0, 'tip');
add('usual 30+ minutes', 'role', (r) => r.mpg >= 30);
add('usual 24-30 minutes', 'role', (r) => r.mpg >= 24 && r.mpg < 30);
add('usual 18-24 minutes', 'role', (r) => r.mpg >= 18 && r.mpg < 24);
add('usual 12-18 minutes', 'role', (r) => r.mpg >= 12 && r.mpg < 18);
add('usual under 12 minutes', 'role', (r) => r.mpg < 12);
add('high usage (28%+)', 'role', (r) => r.usg >= 0.28);
add('blowout-proof player', 'role', (r) => r.x[IX.proof] === 1);
add('thin log (5 games or fewer)', 'role', (r) => r.gms <= 5);
add('back from a layoff', 'role', (r) => r._fr === 1, 'tip');
add('deep bench', 'role', (r) => r._dp === 1, 'tip');
// --- the night
add('back-to-back', 'night', (r) => r._b2b === 1);
add('home', 'night', (r) => r.hm === 1);
add('away', 'night', (r) => r.hm === 0);
add('short-handed team (load<=-1)', 'night', (r) => r._ld != null && r._ld <= -1);
add('crowded team (load>=+1)', 'night', (r) => r._ld != null && r._ld >= 1);
add('heavy favorite (10+)', 'night', (r) => r._fav != null && r._fav >= 10);
add('favorite 5-9.5', 'night', (r) => r._fav != null && r._fav >= 5 && r._fav < 10);
add('underdog 5-9.5', 'night', (r) => r._fav != null && r._fav <= -5 && r._fav > -10);
add('long shot (10+ underdog)', 'night', (r) => r._fav != null && r._fav <= -10);
add('fast teams (pace input >= +0.3)', 'night', (r) => r.x[IX.pace] >= 0.3);
add('slow teams (pace input <= -0.6)', 'night', (r) => r.x[IX.pace] <= -0.6);
add('high total (238+)', 'night', (r) => r._tot != null && r._tot >= 238);
add('low total (222 or less)', 'night', (r) => r._tot != null && r._tot <= 222);
add('game running 5+ possessions fast', 'night', (r) => r.x[IX.livePace] >= 1, 'live');
add('game running 5+ possessions slow', 'night', (r) => r.x[IX.livePace] <= -1, 'live');
add('blowout chance 50%+', 'night', (r) => r.pB >= 0.5);
add('blowout chance 25-50%', 'night', (r) => r.pB >= 0.25 && r.pB < 0.5);
add('October-November', 'calendar', (r) => r.d.slice(5, 7) === '10' || r.d.slice(5, 7) === '11');
add('December-January', 'calendar', (r) => r.d.slice(5, 7) === '12' || r.d.slice(5, 7) === '01');
add('February-March', 'calendar', (r) => r.d.slice(5, 7) === '02' || r.d.slice(5, 7) === '03');
add('April', 'calendar', (r) => r.d.slice(5, 7) === '04');

function applies(sc, stage) {
  if (sc.where === 'live') return stage !== 'rep' && stage !== 'pre';
  if (sc.where === 'tip') return stage !== 'rep';
  return true;
}
const ROLES = [['all', () => true], ['starter', (r) => r.st === 1], ['reserve', (r) => r.st !== 1]];
module.exports = { S, ROLES, applies };
