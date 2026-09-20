/**
 * Possession estimator.
 * Official: poss ≈ FGA + 0.44*FTA − ORB + TO
 * Game possessions = average of both teams (they should be close).
 */

function teamPossessions({ fga, fta, orb, to }) {
  const FGA = Number(fga) || 0;
  const FTA = Number(fta) || 0;
  const ORB = Number(orb) || 0;
  const TO = Number(to) || 0;
  return FGA + 0.44 * FTA - ORB + TO;
}

function hasBoxStats(box) {
  if (!box) return false;
  const fga = Number(box.fga) || 0;
  const to = Number(box.to) || 0;
  const fta = Number(box.fta) || 0;
  return fga + to + fta >= 8;
}

function gamePossessions(homeBox, awayBox) {
  const homeOk = hasBoxStats(homeBox);
  const awayOk = hasBoxStats(awayBox);
  if (homeOk && awayOk) {
    return (teamPossessions(homeBox) + teamPossessions(awayBox)) / 2;
  }
  if (homeOk) return teamPossessions(homeBox);
  if (awayOk) return teamPossessions(awayBox);
  return null;
}

function combinedPossessions(homeBox, awayBox) {
  const gp = gamePossessions(homeBox, awayBox);
  return gp == null ? null : gp * 2;
}

function livePace(gamePoss, elapsedMinutes, regulationMinutes) {
  if (!gamePoss || elapsedMinutes < 0.5 || !regulationMinutes) return null;
  return (gamePoss * regulationMinutes) / elapsedMinutes;
}

function pointsPerPossession(totalScore, combinedPoss) {
  if (!combinedPoss || combinedPoss <= 0) return null;
  return totalScore / combinedPoss;
}

module.exports = {
  teamPossessions,
  hasBoxStats,
  gamePossessions,
  combinedPossessions,
  livePace,
  pointsPerPossession,
};
