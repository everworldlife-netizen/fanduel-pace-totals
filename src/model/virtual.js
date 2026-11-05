// FanDuel sim boards: "GG League", "H2H GG", "ACE ... Sims", "JUDGEMENT"/"Judgment".
// \bace\b and \bgg\b are whole-word only, so real "Las Vegas Aces" and "NBA G League" stay.
const VIRTUAL_RE = /(ebasketball|e-basketball|\benba\b|virtual|sim(?:ulated)?|\b2k\b|cyber\s*hoops|esport|e-sport|nba\s*2k|ebl\b|e-bl\b|\bgg\b|\bh2h\b|\bace\b|\bjudge?ment\b)/i;

function isVirtualGame(game = {}) {
  if (game.isVirtual === true) return true;
  const blobs = [
    game.name,
    game.shortName,
    game.leagueName,
    game.home?.name,
    game.away?.name,
    game.home?.abbrev,
    game.away?.abbrev,
  ]
    .filter(Boolean)
    .join(' ');
  return VIRTUAL_RE.test(blobs);
}

module.exports = { isVirtualGame, VIRTUAL_RE };
