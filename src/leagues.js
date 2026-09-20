/**
 * FanDuel-relevant basketball leagues and how we fetch them.
 *
 * ESPN Site API (probed 2026-09-20) only publishes these basketball slugs:
 *   nba, wnba, nbl, mens-college-basketball, womens-college-basketball,
 *   fiba (World Cup, not BCL), nba-development, euroleague (often empty),
 *   acb (Copa del Rey stub), olympics, summer-league variants.
 *
 * Missing on ESPN: German BBL, Lithuania LKL, FIBA Champions League, Mexico LNBP.
 * Those use optional API-Basketball. Euroleague live games use api-live.euroleague.net.
 */

const FIBA_40 = {
  regulationMinutes: 40,
  periodMinutes: 10,
  periods: 4,
  otMinutes: 5,
  usesHalves: false,
  avgPace: 72, // possessions / 40
  avgPPP: 1.08,
  highElapsed: 20,
  medElapsed: 10,
  lowElapsed: 8,
  blowoutMargin: 20,
  garbageRemain: 5,
};

const NBA_48 = {
  regulationMinutes: 48,
  periodMinutes: 12,
  periods: 4,
  otMinutes: 5,
  usesHalves: false,
  avgPace: 100,
  avgPPP: 1.14,
  highElapsed: 24,
  medElapsed: 12,
  lowElapsed: 8,
  blowoutMargin: 25,
  garbageRemain: 6,
};

const LEAGUES = {
  nba: {
    id: 'nba',
    name: 'NBA',
    abbrev: 'NBA',
    fanduelPriority: true,
    clock: NBA_48,
    espnSlug: 'nba',
    euroCode: null,
    apiBasketball: { names: ['NBA'], country: 'USA', fallbackId: 12 },
  },
  wnba: {
    id: 'wnba',
    name: 'WNBA',
    abbrev: 'WNBA',
    fanduelPriority: true,
    clock: {
      ...FIBA_40,
      avgPace: 80,
      avgPPP: 1.00,
      periodMinutes: 10,
    },
    espnSlug: 'wnba',
    euroCode: null,
    apiBasketball: { names: ['WNBA'], country: 'USA', fallbackId: 13 },
  },
  nbl: {
    id: 'nbl',
    name: 'Australian NBL',
    abbrev: 'NBL',
    fanduelPriority: true,
    clock: { ...FIBA_40, avgPace: 82, avgPPP: 1.10 },
    espnSlug: 'nbl',
    euroCode: null,
    apiBasketball: { names: ['NBL'], country: 'Australia', fallbackId: 1 },
  },
  euroleague: {
    id: 'euroleague',
    name: 'EuroLeague',
    abbrev: 'EUR',
    fanduelPriority: true,
    clock: { ...FIBA_40, avgPace: 70, avgPPP: 1.14 },
    espnSlug: 'euroleague',
    euroCode: 'E',
    apiBasketball: { names: ['Euroleague', 'EuroLeague'], country: null, fallbackId: 120 },
  },
  eurocup: {
    id: 'eurocup',
    name: 'EuroCup',
    abbrev: 'EC',
    fanduelPriority: false,
    clock: { ...FIBA_40, avgPace: 72, avgPPP: 1.10 },
    espnSlug: null,
    euroCode: 'U',
    apiBasketball: { names: ['Eurocup', 'EuroCup'], country: null, fallbackId: 122 },
  },
  bbl: {
    id: 'bbl',
    name: 'German BBL',
    abbrev: 'BBL',
    fanduelPriority: true,
    clock: { ...FIBA_40, avgPace: 74, avgPPP: 1.10 },
    espnSlug: null,
    euroCode: null, // GE on euroleague.net is historical only (2000s)
    apiBasketball: { names: ['BBL', 'Basketball Bundesliga'], country: 'Germany', fallbackId: 40 },
  },
  lkl: {
    id: 'lkl',
    name: 'Lithuania LKL',
    abbrev: 'LKL',
    fanduelPriority: true,
    clock: { ...FIBA_40, avgPace: 74, avgPPP: 1.10 },
    espnSlug: null,
    euroCode: null,
    apiBasketball: { names: ['LKL'], country: 'Lithuania', fallbackId: 110 },
  },
  bcl: {
    id: 'bcl',
    name: 'FIBA Champions League',
    abbrev: 'BCL',
    fanduelPriority: true,
    clock: { ...FIBA_40, avgPace: 72, avgPPP: 1.08 },
    espnSlug: null, // ESPN `fiba` is World Cup, not BCL
    euroCode: null,
    apiBasketball: { names: ['Champions League', 'Basketball Champions League', 'BCL'], country: null, fallbackId: 117 },
  },
  lnbp: {
    id: 'lnbp',
    name: 'Mexico LNBP',
    abbrev: 'LNBP',
    fanduelPriority: true,
    clock: { ...FIBA_40, avgPace: 80, avgPPP: 1.08 },
    espnSlug: null,
    euroCode: null,
    apiBasketball: { names: ['LNBP'], country: 'Mexico', fallbackId: 83 },
  },
  ncaam: {
    id: 'ncaam',
    name: "NCAA Men's",
    abbrev: 'NCAAM',
    fanduelPriority: true,
    clock: {
      regulationMinutes: 40,
      periodMinutes: 20,
      periods: 2,
      otMinutes: 5,
      usesHalves: true,
      avgPace: 68,
      avgPPP: 1.05,
      highElapsed: 20,
      medElapsed: 12,
      lowElapsed: 8,
      blowoutMargin: 22,
      garbageRemain: 5,
    },
    espnSlug: 'mens-college-basketball',
    espnQuery: 'groups=50&limit=200',
    euroCode: null,
    apiBasketball: null,
  },
  ncaaw: {
    id: 'ncaaw',
    name: "NCAA Women's",
    abbrev: 'NCAAW',
    fanduelPriority: false,
    clock: { ...FIBA_40, avgPace: 72, avgPPP: 0.95 },
    espnSlug: 'womens-college-basketball',
    espnQuery: 'groups=50&limit=200',
    euroCode: null,
    apiBasketball: null,
  },
  fiba: {
    id: 'fiba',
    name: 'FIBA World Cup',
    abbrev: 'FIBA',
    fanduelPriority: false,
    clock: FIBA_40,
    espnSlug: 'fiba',
    euroCode: null,
    apiBasketball: null,
  },
  gleague: {
    id: 'gleague',
    name: 'NBA G League',
    abbrev: 'G',
    fanduelPriority: false,
    clock: { ...NBA_48, avgPace: 102, avgPPP: 1.10 },
    espnSlug: 'nba-development',
    euroCode: null,
    apiBasketball: null,
  },
};

const DEFAULT_SCOREBOARD = ['nba', 'wnba', 'nbl', 'euroleague', 'eurocup', 'bbl', 'lkl', 'bcl', 'lnbp', 'ncaam'];

function getLeague(id) {
  return LEAGUES[id] || null;
}

function leagueList() {
  return Object.values(LEAGUES);
}

module.exports = {
  LEAGUES,
  DEFAULT_SCOREBOARD,
  getLeague,
  leagueList,
  FIBA_40,
  NBA_48,
};
