const VIRTUAL_RE = /(ebasketball|e-basketball|\benba\b|virtual|\bsim(?:s|ulated)?\b|\b2k\b|cyber\s*hoops|esport|e-sport|nba\s*2k|\bebl\b|\be-bl\b|\bgg\s*league\b|\bh2h\b|\bace\b|judge?ment)/i;

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
