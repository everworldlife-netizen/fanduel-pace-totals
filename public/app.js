const POLL = 15000;
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'nba', label: 'NBA' },
  { id: 'wnba', label: 'WNBA' },
  { id: 'nbl', label: 'NBL' },
  { id: 'euroleague', label: 'Euro' },
  { id: 'bbl', label: 'BBL' },
  { id: 'lkl', label: 'LKL' },
  { id: 'bcl', label: 'BCL' },
  { id: 'lnbp', label: 'LNBP' },
  { id: 'ncaam', label: 'NCAAM' },
];

let games = [];
let selectedId = null;
let filter = 'all';
let detail = null;
let pollTimer = null;

const $ = (id) => document.getElementById(id);

function loadLines(id) {
  try {
    return JSON.parse(localStorage.getItem(`fd-lines:${id}`) || '{}');
  } catch {
    return {};
  }
}

function saveLines(id) {
  const payload = {
    gameTotal: $('line-game').value,
    quarterTotal: $('line-q').value,
    halfTotal: $('line-h').value,
    awayTotal: $('line-away').value,
    homeTotal: $('line-home').value,
  };
  localStorage.setItem(`fd-lines:${id}`, JSON.stringify(payload));
  return payload;
}

function fillLines(id) {
  const l = loadLines(id);
  $('line-game').value = l.gameTotal || '';
  $('line-q').value = l.quarterTotal || '';
  $('line-h').value = l.halfTotal || '';
  $('line-away').value = l.awayTotal || '';
  $('line-home').value = l.homeTotal || '';
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function statusLabel(g) {
  if (g.status === 'final') return 'Final';
  if (g.status === 'scheduled') {
    try {
      return new Date(g.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch {
      return 'Sched';
    }
  }
  if (g.status === 'halftime') return 'HT';
  return `${g.periodText || ''} ${g.clock || ''}`.trim();
}

function isLive(g) {
  return g.status === 'in_progress' || g.status === 'halftime';
}

function renderFilters() {
  const el = $('filters');
  el.innerHTML = FILTERS.map((f) =>
    `<button class="chip ${filter === f.id ? 'on' : ''}" data-id="${f.id}">${f.label}</button>`
  ).join('');
  el.querySelectorAll('.chip').forEach((btn) => {
    btn.onclick = () => {
      filter = btn.dataset.id;
      renderFilters();
      renderList();
    };
  });
}

function visibleGames() {
  if (filter === 'all') return games;
  if (filter === 'live') return games.filter(isLive);
  return games.filter((g) => g.leagueId === filter);
}

function renderList() {
  const el = $('game-list');
  const list = visibleGames();
  if (!list.length) {
    el.innerHTML = `<div class="skeleton">No games in this filter. Try All or Live. BBL/LKL/BCL/LNBP live scores come from FanDuel’s in-play board; set API_BASKETBALL_KEY for box stats.</div>`;
    return;
  }
  el.innerHTML = list.map((g) => {
    const live = isLive(g);
    const score = g.status === 'scheduled' ? '' : `${g.away.score}–${g.home.score}`;
    return `<div class="game-row ${g.id === selectedId ? 'active' : ''}" data-id="${g.id}">
      <div>
        <div class="match">${g.away.abbrev || g.away.shortName} @ ${g.home.abbrev || g.home.shortName}</div>
        <div class="sub"><span>${g.leagueAbbrev}</span><span>${statusLabel(g)}</span>${live ? '<span class="badge-live">LIVE</span>' : ''}</div>
      </div>
      <div class="score">${score}</div>
    </div>`;
  }).join('');
  el.querySelectorAll('.game-row').forEach((row) => {
    row.onclick = () => selectGame(row.dataset.id);
  });
}

function qCells(team, opp) {
  const qs = team?.qScores || [];
  if (!qs.length) return '';
  const labels = qs.map((_, i) => `<span>${i < 4 ? 'Q' + (i + 1) : 'OT'}</span>`).join('');
  const vals = qs.map((n) => `<span>${n}</span>`).join('');
  return `<div class="qs">${vals}</div>`;
}

function renderHero(game) {
  const live = isLive(game);
  $('hero').innerHTML = `
    <div class="team-block">
      ${game.away.logo ? `<img src="${game.away.logo}" alt="" onerror="this.style.display='none'">` : ''}
      <div>
        <div class="team-name">${game.away.name}</div>
        <div class="team-score">${game.status === 'scheduled' ? '—' : game.away.score}</div>
      </div>
    </div>
    <div class="mid">
      <div class="clock">${live ? (game.periodText + ' ' + (game.clock || '')).trim() : statusLabel(game)}</div>
      <div class="league-chip">${game.leagueName}</div>
      ${qCells(game.away)}
      ${qCells(game.home)}
    </div>
    <div class="team-block right">
      <div>
        <div class="team-name">${game.home.name}</div>
        <div class="team-score">${game.status === 'scheduled' ? '—' : game.home.score}</div>
      </div>
      ${game.home.logo ? `<img src="${game.home.logo}" alt="" onerror="this.style.display='none'">` : ''}
    </div>
  `;
  $('label-away').childNodes[0].textContent = `${game.away.abbrev || 'Away'} team `;
  $('label-home').childNodes[0].textContent = `${game.home.abbrev || 'Home'} team `;
}

function renderPace(snapshot) {
  const unit = snapshot.regulationMinutes;
  const src = snapshot.source === 'box' ? 'box stats' : snapshot.source === 'score_clock' ? 'score+clock (LOW)' : 'league prior';
  $('pace-strip').innerHTML = [
    ['Poss so far', snapshot.gamePossessions ?? '—', ''],
    [`Pace /${unit}`, snapshot.pace ?? '—', 'teal'],
    ['PPP', snapshot.ppp ?? '—', 'teal'],
    ['Fair total', snapshot.fairGameTotal ?? '—', ''],
    ['Elapsed', `${snapshot.elapsed}m`, ''],
  ].map(([k, v, cls]) => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`).join('')
    + `<p class="hint" style="grid-column:1/-1;margin-top:4px">Model source: ${src}. Remaining ${snapshot.remaining} min · proj leftover ${snapshot.remainingPoints} pts.</p>`;
}

function renderAdvice(advice) {
  if (!advice) {
    $('advice').innerHTML = '<p class="hint" style="margin-top:16px">Paste a FanDuel game total to get Over / Under / Pass.</p>';
    return;
  }
  const cards = advice.markets.map((m) => {
    const call = m.call || '—';
    const cls = m.call || 'Pass';
    return `<article class="call-card ${cls}">
      <div>
        <div class="call-name">${m.label}</div>
        <div class="call-big">${call.toUpperCase()}</div>
      </div>
      <div class="nums">
        Fair <strong>${m.fair ?? '—'}</strong> vs FD <strong>${m.line ?? '—'}</strong>
        ${m.edge != null ? ` · edge ${m.edge > 0 ? '+' : ''}${m.edge}` : ''}
        <div class="hint">${m.reason || `Stake hint: ${m.stake}`}</div>
      </div>
      <span class="conf ${m.confidence}">${m.confidence}</span>
    </article>`;
  }).join('');
  $('advice').innerHTML = `
    <div class="advice">${cards}</div>
    <p class="why">${advice.why}</p>
    <p class="risks">${(advice.risks || []).join(' · ')}</p>
    <p class="disclaimer">${advice.disclaimer}</p>
  `;
}

async function selectGame(id, { keepLines = false } = {}) {
  selectedId = id;
  renderList();
  $('empty').classList.add('hidden');
  $('detail').classList.remove('hidden');
  if (!keepLines) fillLines(id);
  try {
    detail = await api(`/api/games/${encodeURIComponent(id)}`);
    renderHero(detail.game);
    renderPace(detail.snapshot);
    const lines = loadLines(id);
    if (lines.gameTotal) await evaluateNow();
    else renderAdvice(null);
  } catch (err) {
    $('hero').innerHTML = `<p class="hint">${err.message}</p>`;
  }
}

async function evaluateNow() {
  if (!selectedId) return;
  const lines = saveLines(selectedId);
  if (!lines.gameTotal) {
    renderAdvice(null);
    return;
  }
  try {
    const data = await api('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: selectedId, lines }),
    });
    detail = data;
    renderHero(data.game);
    renderPace(data.snapshot);
    renderAdvice(data.advice);
  } catch (err) {
    $('advice').innerHTML = `<p class="risks">${err.message}</p>`;
  }
}

async function refresh() {
  try {
    const data = await api('/api/games');
    games = data.games || [];
    renderList();
    const note = [];
    const fdOk = data.fanduelLive && data.fanduelLive.ok;
    const fdCount = data.fanduelLive && data.fanduelLive.liveCount;
    const banner = $('feed-banner');
    if (data.apiBasketball && !data.apiBasketball.enabled) {
      banner.classList.remove('hidden');
      banner.textContent = fdOk
        ? `API-Basketball key is off. Live BBL / LKL / BCL / LNBP scores and clocks come from FanDuel’s public in-play board${fdCount ? ` (${fdCount} live)` : ''}. Paste totals yourself — this app never invents odds. Set API_BASKETBALL_KEY for box stats.`
        : 'API-Basketball key is off. BBL / LKL / BCL / LNBP need API_BASKETBALL_KEY or FanDuel’s live scoreboard feed (scores and clock only; lines stay paste-only).';
      note.push(fdOk
        ? 'FanDuel live scoreboard on (scores/clock). Box stats for BBL/LKL need API_BASKETBALL_KEY.'
        : 'FanDuel live scoreboard unreachable. Set API_BASKETBALL_KEY for BBL/LKL/BCL/LNBP.');
    } else {
      banner.classList.add('hidden');
    }
    $('feed-note').textContent = note.join(' ');
    $('updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    if (selectedId) {
      const still = games.find((g) => g.id === selectedId);
      if (still) await selectGame(selectedId, { keepLines: true });
    } else {
      const live = games.find(isLive);
      if (live) await selectGame(live.id);
    }
  } catch (err) {
    $('game-list').innerHTML = `<div class="skeleton">${err.message}</div>`;
  }
}

function init() {
  renderFilters();
  $('lines-form').addEventListener('submit', (e) => {
    e.preventDefault();
    evaluateNow();
  });
  ['line-game', 'line-q', 'line-h', 'line-away', 'line-home'].forEach((id) => {
    $(id).addEventListener('change', () => {
      if (selectedId) saveLines(selectedId);
    });
  });
  refresh();
  pollTimer = setInterval(refresh, POLL);
}

init();
