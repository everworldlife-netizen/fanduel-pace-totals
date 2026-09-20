function parseClockToMinutes(clock) {
  if (clock === 0) return 0;
  if (clock == null || clock === '') return 0;
  const s = String(clock).trim();
  if (!s || s === '--') return 0;
  if (s.includes(':')) {
    const parts = s.split(':');
    const m = Number(parts[0]);
    const sec = Number(parts[1]);
    if (!Number.isFinite(m) || !Number.isFinite(sec)) return 0;
    return Math.max(m + sec / 60, 0);
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  // API-Basketball sometimes sends leftover seconds as a bare number
  if (n > 15 && n <= 75) return n / 60;
  return Math.max(n, 0);
}

function elapsedGameMinutes(period, clock, league, { isHalftime = false } = {}) {
  const cfg = league.clock || league;
  if (isHalftime) return cfg.regulationMinutes / 2;
  if (!period || period <= 0) return 0;

  const completedReg = Math.min(period - 1, cfg.periods);
  const completedOT = Math.max(period - 1 - cfg.periods, 0);
  const completed = completedReg * cfg.periodMinutes + completedOT * cfg.otMinutes;
  const currentLen = period <= cfg.periods ? cfg.periodMinutes : cfg.otMinutes;
  const remaining = Math.min(parseClockToMinutes(clock), currentLen);
  const elapsedInPeriod = Math.max(currentLen - remaining, 0);
  return completed + elapsedInPeriod;
}

function remainingInPeriodMinutes(period, clock, league, { isHalftime = false } = {}) {
  const cfg = league.clock || league;
  if (isHalftime) return 0;
  if (!period || period <= 0) return cfg.periodMinutes;
  const currentLen = period <= cfg.periods ? cfg.periodMinutes : cfg.otMinutes;
  return Math.min(Math.max(parseClockToMinutes(clock), 0), currentLen);
}

function remainingRegulationMinutes(period, clock, league, opts = {}) {
  const cfg = league.clock || league;
  const elapsed = elapsedGameMinutes(period, clock, league, opts);
  if (period > cfg.periods) {
    return remainingInPeriodMinutes(period, clock, league, opts);
  }
  return Math.max(cfg.regulationMinutes - elapsed, 0);
}

function remainingScheduledMinutes(period, clock, league, opts = {}) {
  const cfg = league.clock || league;
  const elapsed = elapsedGameMinutes(period, clock, league, opts);
  if (period > cfg.periods) {
    return remainingInPeriodMinutes(period, clock, league, opts);
  }
  return Math.max(cfg.regulationMinutes - elapsed, 0);
}

function periodLabel(period, league, { isHalftime = false, status } = {}) {
  const cfg = league.clock || league;
  if (status === 'final') return 'Final';
  if (isHalftime || status === 'halftime') return 'HT';
  if (!period || status === 'scheduled') return '';
  if (period > cfg.periods) return `OT${period - cfg.periods === 1 ? '' : period - cfg.periods}`;
  if (cfg.usesHalves) return `H${period}`;
  return `Q${period}`;
}

function halfLength(league) {
  const cfg = league.clock || league;
  return cfg.regulationMinutes / 2;
}

module.exports = {
  parseClockToMinutes,
  elapsedGameMinutes,
  remainingInPeriodMinutes,
  remainingRegulationMinutes,
  remainingScheduledMinutes,
  periodLabel,
  halfLength,
};
