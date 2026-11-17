/* late-cand: candidate new inputs for the late stages. Every one uses only what the live app has at that moment:
 * the player's usual minutes (mpg) and role flags, tonight's box so far (minutes, stints, fouls), who is on the floor for
 * both teams, the score, and (closing group) the team's last 8 games inside 21 days with stints and scores.
 * st = usual heavy-minute player (24+ a game) = the engine's own "starter" flag. am = |margin|. */
'use strict';
const am = (r) => Math.abs(r.mg);
const S = (r) => r.st === 1, D = (r) => r.st !== 1 && r.mpg < 14, B = (r) => r.st !== 1 && r.mpg >= 14;
const off = (r) => !r.on, on = (r) => !!r.on;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const C42 = {
  // white flag: the game is decided (16+) and the team has at most one usual starter on the floor
  flagOffReg: (r) => (off(r) && !D(r) && r.stOn <= 1 && am(r) >= 16 ? 1 : 0), // a regular who is sitting: he is done
  flagOnBench: (r) => (on(r) && !S(r) && r.stOn <= 1 && am(r) >= 16 ? 1 : 0), // the unit on the floor plays it out
  flagOnS: (r) => (on(r) && S(r) && r.stOn <= 1 && am(r) >= 16 ? 1 : 0),
  deepWait: (r) => (off(r) && D(r) && am(r) >= 16 && r.stOn >= 2 ? 1 : 0), // decided, regulars still out there: the deep bench is next
  restClose: (r) => (off(r) && S(r) && am(r) <= 10 && r.sitFor < 12 ? 1 : 0), // starter taking his rest at 6:00 of a close game: he comes back
  closerOff: (r) => (off(r) && !S(r) && am(r) <= 10 && r.cgNA >= 2 && r.cgRkA <= 5 ? 1 : 0), // non-starter who has been closing
  deepOffClose: (r) => (off(r) && D(r) && am(r) <= 10 ? 1 : 0), // deep bench sitting in a close game: not coming back
  sOnT16: (r) => (on(r) && S(r) && r.mg <= -16 && r.mg >= -20 && r.stOn >= 3 ? 1 : 0), // starters still out there down 16-20: pulled soon
  sOnT21: (r) => (on(r) && S(r) && r.mg <= -21 && r.stOn >= 2 ? 1 : 0), // still out there down 21+: the coach lets them play
  benchOffT: (r) => (off(r) && B(r) && r.mg <= -11 && r.mg >= -20 && r.stOn >= 3 ? 1 : 0),
};
const C36 = {
  deepLop: (r) => (D(r) ? clamp((am(r) - 10) / 10, 0, 2) : 0), // deep bench in a lopsided game after three quarters
  deepOffClose: (r) => (off(r) && D(r) && am(r) <= 10 ? 1 : 0),
  midBenchClose: (r) => (!S(r) && r.mpg >= 18 && am(r) <= 15 ? 1 : 0), // 18-24 minute players: treated as bench, play like regulars
  midBenchLead: (r) => (!S(r) && r.mpg >= 18 && r.mg >= 16 ? 1 : 0),
  lowStarterLop: (r) => (S(r) && r.mpg < 27 && am(r) >= 16 ? 1 : 0),
  benchHot: (r) => (B(r) ? clamp((r.now0 - 0.75 * r.mpg) / 6, -1, 1.5) : 0), // bench player running ahead of his usual minutes tonight
  sOffLop26: (r) => (S(r) && off(r) && am(r) >= 26 ? 1 : 0),
  sFullQ3: (r) => (S(r) && on(r) && r.stintNow >= 11.9 ? 1 : 0), // played the whole third quarter: sits to start the fourth
  freshOn: (r) => (on(r) && r.stintNow < 4 ? 1 : 0), // checked in late in Q3: carries on into Q4
  startsBench: (r) => (!S(r) && r.sT === 1 ? 1 : 0), // starts tonight, usual minutes under 24
  starterBenched: (r) => (S(r) && r.sT === 0 ? 1 : 0), // usual 24+ player coming off the bench tonight
  flagOffS: (r) => (off(r) && S(r) && r.stOn <= 1 && am(r) >= 21 ? 1 : 0),
};
module.exports = { C42, C36, S, B, D, am };
