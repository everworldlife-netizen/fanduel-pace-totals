/* Courtside Arcade — UI */
(function () {
  'use strict';
  const E = window.Engine, DB = window.DB;
  const view = document.getElementById('view');
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const half = (x) => (Math.round(x * 2) / 2).toString();
  const pct = (p) => `${Math.round(p * 100)}%`;

  // Backtest of this engine on 25 finished games (2026-10-28 → 10-30), players with 10+ minutes.
  const ACCURACY = { games: 25, q3: { pts: 2.36, reb: 1.05, ast: 0.67, fg3m: 0.42 }, half: { pts: 3.47, reb: 1.43, ast: 0.97, fg3m: 0.65 }, pre: { pts: 5.06 }, calib: 'picks rated 70–80% hit 74%' };

  const TEAM = {
    ATL: ['#E03A3E', '#C1D32F'], BOS: ['#007A33', '#BA9653'], BKN: ['#2a2a2a', '#FFFFFF'], CHA: ['#1D1160', '#00788C'],
    CHI: ['#CE1141', '#111111'], CLE: ['#860038', '#FDBB30'], DAL: ['#00538C', '#B8C4CA'], DEN: ['#0E2240', '#FEC524'],
    DET: ['#C8102E', '#1D42BA'], GSW: ['#1D428A', '#FFC72C'], HOU: ['#CE1141', '#C4CED4'], IND: ['#002D62', '#FDBB30'],
    LAC: ['#C8102E', '#1D428A'], LAL: ['#552583', '#FDB927'], MEM: ['#5D76A9', '#12173F'], MIA: ['#98002E', '#F9A01B'],
    MIL: ['#00471B', '#EEE1C6'], MIN: ['#0C2340', '#78BE20'], NOP: ['#0C2340', '#C8102E'], NYK: ['#006BB6', '#F58426'],
    OKC: ['#007AC1', '#EF3B24'], ORL: ['#0077C0', '#C4CED4'], PHI: ['#006BB6', '#ED174C'], PHX: ['#1D1160', '#E56020'],
    POR: ['#E03A3E', '#111111'], SAC: ['#5A2D81', '#63727A'], SAS: ['#8a96a0', '#111111'], TOR: ['#CE1141', '#111111'],
    UTA: ['#002B5C', '#F9A01B'], WAS: ['#002B5C', '#E31837'],
  };
  const badge = (abbr, cls = '') => {
    const [c1, c2] = TEAM[abbr] || ['#555', '#999'];
    return `<span class="badge ${cls}" style="--c1:${c1};--c2:${c2}" aria-hidden="true">${esc(abbr)}</span>`;
  };

  const MASCOT = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="52" r="42" fill="#ff7a1a" stroke="#0c0720" stroke-width="6"/>
    <path d="M10 52h80M50 10v84M22 22c14 14 14 46 0 60M78 22c-14 14-14 46 0 60" fill="none" stroke="#0c0720" stroke-width="4" stroke-linecap="round" opacity=".55"/>
    <ellipse cx="37" cy="46" rx="9" ry="11" fill="#fff" stroke="#0c0720" stroke-width="4"/><ellipse cx="63" cy="46" rx="9" ry="11" fill="#fff" stroke="#0c0720" stroke-width="4"/>
    <circle cx="39" cy="48" r="4.5" fill="#0c0720"/><circle cx="65" cy="48" r="4.5" fill="#0c0720"/><circle cx="40.5" cy="46" r="1.6" fill="#fff"/><circle cx="66.5" cy="46" r="1.6" fill="#fff"/>
    <path d="M38 64q12 11 24 0" fill="#fff" stroke="#0c0720" stroke-width="4" stroke-linejoin="round"/>
    <path d="M14 30q36-22 72 0" fill="none" stroke="#2de2e6" stroke-width="7" stroke-linecap="round"/></svg>`;

  const ICON = {
    games: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M6 5.5c3 3 3 10 0 13M18 5.5c-3 3-3 10 0 13"/></svg>',
    picks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
    combos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.5"/><circle cx="8" cy="17" r="2.5"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg>',
    install: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg>',
  };

  // ------------------------------------------------------------------ settings + state
  const DEFAULTS = { refresh: 20, skipBlowouts: true, sims: 2000, payout: 3, minP: 0.6 };
  const settings = Object.assign({}, DEFAULTS, DB.store.get('settings') || {});
  const saveSettings = () => DB.store.set('settings', settings);

  const X_ACCOUNTS = ['RotoWireNBA', 'UnderdogNBA', 'ShamsCharania', 'TheSteinLine', 'ChrisBHaynes', 'mcten', 'JakeLFischer', 'anthonyVslater',
    'ClutchPoints', 'InStreetClothes', 'BaruthaAlex', 'FantasyProsNBA', 'FantasyLabsNBA', 'SICscore', 'Stokastic'];
  function xSearchUrl(g) {
    const names = [g.visitor_team.name, g.home_team.name, g.visitor_team.city, g.home_team.city];
    const q = `(${X_ACCOUNTS.map((a) => 'from:' + a).join(' OR ')}) (${[...new Set(names)].join(' OR ')}) since:${DB.addDays(state.date, -1)}`;
    return 'https://x.com/search?q=' + encodeURIComponent(q) + '&f=live';
  }
  const ovKey = () => `overrides:${state.date}`;
  const getOverrides = () => DB.store.get(ovKey()) || { in: [], out: [] };
  function setOverride(pid, status) {
    const o = getOverrides();
    o.in = o.in.filter((x) => x !== pid); o.out = o.out.filter((x) => x !== pid);
    if (status === 'in') o.in.push(pid);
    if (status === 'out') o.out.push(pid);
    DB.store.set(ovKey(), o);
  }

  const state = {
    dayOffset: 0, date: DB.etDate(0), slate: [], priors: null, injuries: [],
    logs: new Map(), logTeams: new Set(), proj: new Map(), busy: false, progress: null,
    team: {}, pickFilter: 'all', sheetPid: null, sheetGame: null, installEvt: null, lastErr: null, lastUpdate: 0,
  };

  // ------------------------------------------------------------------ worker
  const worker = new Worker('worker.js');
  let jobId = 0;
  const pending = new Map();
  worker.onmessage = (e) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    pending.delete(e.data.id);
    e.data.ok ? job.res(e.data) : job.rej(new Error(e.data.error));
  };
  const runProjection = (payload) => new Promise((res, rej) => { const id = ++jobId; pending.set(id, { res, rej }); worker.postMessage({ id, payload }); });

  // ------------------------------------------------------------------ data flow
  const st = (g) => E.gameState(g);
  async function loadSlate() {
    state.slate = await DB.slate(state.date);
    state.lastUpdate = Date.now();
  }
  async function ensurePriors() {
    if (state.priors) return;
    const s = DB.seasons(state.date);
    setProgress('Loading player profiles…', 0, 1);
    const [last, cur] = await Promise.all([DB.lastSeasonPriors(s.last), DB.currentSeasonPriors(s.cur, DB.etDate(0))]);
    state.priors = { last, cur };
  }
  async function ensureLogs(teams) {
    const need = teams.filter((t) => !state.logTeams.has(t));
    if (!need.length) return;
    const logs = await DB.teamLogs(need, state.date, { onProgress: (d, n) => setProgress('Scouting recent games…', d, n) });
    for (const l of logs) state.logs.set(l.id, l);
    need.forEach((t) => state.logTeams.add(t));
  }
  async function projectGame(g) {
    const s = st(g);
    const plays = s.phase === 'pre' ? [] : await DB.plays(g.id, s.phase === 'final');
    const logs = [...state.logs.values()].filter((l) => [l.v, l.h].some((t) => t === s.v || t === s.h));
    const props = s.phase === 'final' ? [] : await DB.props(g.id);
    const res = await runProjection({ game: g, plays, logs, priors: state.priors, injuries: state.injuries, nsims: settings.sims, props, seed: g.id, minP: settings.minP, overrides: getOverrides() });
    state.proj.set(g.id, { ...res, at: Date.now() });
    return res;
  }
  async function refreshAll({ games = null, force = false } = {}) {
    if (state.busy && !force) return;
    state.busy = true; setSpinning(true);
    try {
      await loadSlate();
      render();
      if (!state.slate.length) return;
      await ensurePriors();
      state.injuries = await DB.injuries(state.date);
      const teams = [...new Set(state.slate.flatMap((g) => [g.visitor_team.abbreviation, g.home_team.abbreviation]))];
      await ensureLogs(teams);
      setProgress(null);
      const list = games || state.slate;
      for (const g of list) {
        const s = st(g);
        const old = state.proj.get(g.id);
        if (s.phase === 'final' && old && old.proj.state.phase === 'final') continue;
        if (s.phase === 'pre' && old && Date.now() - old.at < 5 * 60000) continue;
        try { await projectGame(g); } catch (e) { console.warn('project', g.id, e); }
        render(true);
      }
      state.lastErr = null;
    } catch (e) {
      console.error(e);
      state.lastErr = e.message;
      toast(navigator.onLine ? 'DataBallr is slow to answer — retrying soon' : 'You’re offline');
    } finally {
      state.busy = false; setSpinning(false); setProgress(null); render(true);
    }
  }

  // ------------------------------------------------------------------ helpers for UI
  function setProgress(label, done, total) { state.progress = label ? { label, done, total } : null; const el = $('#progress'); if (el) el.outerHTML = progressHTML(); }
  function progressHTML() {
    const p = state.progress;
    if (!p) return '<div id="progress"></div>';
    const w = p.total ? Math.max(6, Math.round((100 * p.done) / p.total)) : 30;
    return `<div id="progress" class="card" role="status"><div class="banner">${MASCOT}<div style="flex:1"><b>${esc(p.label)}</b><div class="small muted">${p.total > 1 ? `${p.done} / ${p.total}` : 'One moment'}</div><div class="progress"><i style="width:${w}%"></i></div></div></div></div>`;
  }
  function setSpinning(on) { const b = $('#refreshBtn'); if (b) b.classList.toggle('spin', on); }
  let toastTimer;
  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.className = 'toast'; t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  function statusPill(s) {
    if (s.phase === 'live') return `<span class="pill live">${s.label === 'HALF' ? 'HALFTIME' : `Q${s.period > 4 ? 'OT' + (s.period - 4) : s.period} ${esc(s.clock)}`}</span>`;
    if (s.phase === 'final') return '<span class="pill final">FINAL</span>';
    return `<span class="pill pre">${esc(s.label || 'SOON')}</span>`;
  }
  function stickers(s) {
    const out = [];
    if (E.isBlowout(s)) out.push('<span class="sticker blowout">BLOWOUT</span>');
    else if (s.phase === 'live' && s.period >= 4 && s.margin <= 6) out.push('<span class="sticker clutch">CLUTCH</span>');
    else if (s.phase === 'live' && s.margin <= 5) out.push('<span class="sticker close">CLOSE</span>');
    return out.join('');
  }
  const tier = (p) => (p >= 0.7 ? 't-hi' : p >= 0.5 ? 't-mid' : p >= 0.3 ? 't-lo' : 't-x');
  const tierColor = (p) => (p >= 0.7 ? 'var(--green)' : p >= 0.5 ? 'var(--yellow)' : p >= 0.3 ? 'var(--orange)' : 'var(--red)');
  function dayLabel() {
    const o = state.dayOffset;
    const name = o === 0 ? 'Today' : o === -1 ? 'Yesterday' : o === 1 ? 'Tomorrow' : new Date(state.date + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long' });
    const d = new Date(state.date + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${name}<small>${d}</small>`;
  }
  function emptyHTML(title, text) { return `<div class="card empty">${MASCOT}<h3>${esc(title)}</h3><p>${esc(text)}</p></div>`; }

  // ------------------------------------------------------------------ routing
  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, id] = h.split('/');
    return { name: name || 'games', id };
  }
  function setTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-current', t.dataset.tab === name ? 'page' : 'false'));
  }
  window.addEventListener('hashchange', () => { closeSheet(); window.scrollTo(0, 0); render(); });

  // ------------------------------------------------------------------ render
  let renderQueued = false;
  function render(soft = false) {
    if (soft) { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; doRender(); }); return; }
    doRender();
  }
  function doRender() {
    const r = route();
    const liveN = state.slate.filter((g) => st(g).phase === 'live').length;
    const lc = $('#liveCount');
    if (lc) { lc.className = 'live-count' + (liveN ? '' : ' idle'); lc.innerHTML = liveN ? `<span class="live-dot"></span>${liveN} LIVE` : 'NO LIVE'; }
    const ib = $('#installBtn'); if (ib) ib.hidden = !state.installEvt;
    setTab(r.name === 'game' ? 'games' : r.name);
    if (r.name === 'game') view.innerHTML = gameView(+r.id);
    else if (r.name === 'picks') view.innerHTML = picksView();
    else if (r.name === 'combos') view.innerHTML = combosView();
    else if (r.name === 'settings') view.innerHTML = settingsView();
    else view.innerHTML = gamesView();
    if (state.sheetPid) renderSheet();
  }

  // ---- games list
  function gameCard(g) {
    const s = st(g);
    const pr = state.proj.get(g.id);
    const P = pr && pr.proj;
    let foot = '';
    if (P && s.phase !== 'final') {
      const fav = P.winProb[s.v] >= 0.5 ? s.v : s.h;
      const [c1] = TEAM[s.v] || ['#888']; const [c2] = TEAM[s.h] || ['#aaa'];
      foot = `<div class="gc-foot"><span>Proj <b>${Math.round(P.projScore[s.v])}–${Math.round(P.projScore[s.h])}</b></span><span><b>${fav}</b> ${pct(P.winProb[fav])} to win</span></div>
        <div class="winbar" style="margin-top:8px" aria-hidden="true"><i style="width:${(P.winProb[s.v] * 100).toFixed(0)}%;background:${c1}"></i><i style="flex:1;background:${c2}"></i></div>`;
    } else if (s.phase === 'final') {
      foot = `<div class="gc-foot"><span>Final box & projections recap</span><span>›</span></div>`;
    } else {
      foot = `<div class="gc-foot"><span>Crunching projections…</span><span>⏳</span></div>`;
    }
    const lead = s.vs === s.hs ? null : s.vs > s.hs ? 'v' : 'h';
    const team = (side) => {
      const ab = side === 'v' ? s.v : s.h, nm = side === 'v' ? g.visitor_team : g.home_team, sc = side === 'v' ? s.vs : s.hs;
      return `<div class="gc-row">${badge(ab)}<span class="tname">${esc(nm.name)}<small>${esc(nm.city)}</small></span>${s.phase === 'pre' ? '' : `<span class="score led ${lead && lead !== side ? 'dim' : ''}">${sc}</span>`}</div>`;
    };
    return `<a class="card tap" href="#/game/${g.id}" style="text-decoration:none;color:inherit" aria-label="${esc(g.visitor_team.full_name)} at ${esc(g.home_team.full_name)}">
      <div class="gc-top">${statusPill(s)}<span class="grow"></span>${stickers(s)}</div>${team('v')}${team('h')}${foot}</a>`;
  }
  function gamesView() {
    const groups = { live: [], pre: [], final: [] };
    for (const g of state.slate) groups[st(g).phase].push(g);
    let html = `<div class="datebar">
      <button class="icon-btn" data-act="day" data-d="-1" aria-label="Previous day">${ICON.prev}</button>
      <div class="label">${dayLabel()}</div>
      <button class="icon-btn" data-act="day" data-d="1" aria-label="Next day">${ICON.next}</button></div>`;
    html += progressHTML();
    if (!state.slate.length) return html + (state.busy ? '<div class="stack" style="margin-top:14px"><div class="skeleton"></div><div class="skeleton"></div></div>' : emptyHTML('No games on the board', 'Try another day with the arrows above.'));
    const sec = (title, arr) => (arr.length ? `<div class="section-title">${title}<span class="count">${arr.length}</span></div><div class="stack">${arr.map(gameCard).join('')}</div>` : '');
    html += sec('🔴 LIVE NOW', groups.live) + sec('⏰ UP NEXT', groups.pre) + sec('🏁 FINAL', groups.final);
    html += `<div class="updated">Updated ${new Date(state.lastUpdate || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })} · auto every ${settings.refresh}s</div>`;
    return html;
  }

  // ---- single game
  function gameView(id) {
    const g = state.slate.find((x) => x.id === id);
    const back = `<div class="row" style="margin-bottom:12px"><a class="icon-btn" href="#/games" aria-label="Back to games">${ICON.back}</a><div class="section-title" style="margin:0">GAME CENTER</div></div>`;
    if (!g) return back + emptyHTML('Game not on this day', 'Head back and pick a game.');
    const s = st(g);
    const pr = state.proj.get(id);
    const P = pr && pr.proj;
    const ls = (side) => s[side === 'v' ? 'v' : 'h'];
    const lines = s.lines;
    const lsRow = (side) => `<tr><td>${ls(side)}</td>${lines[side].map((x) => `<td>${x == null || s.phase === 'pre' ? '–' : x}</td>`).join('')}<td class="tot">${s.phase === 'pre' ? '–' : side === 'v' ? s.vs : s.hs}</td></tr>`;
    let html = back + `<div class="card scoreboard">
      <div class="sb-main">
        <div class="sb-team">${badge(s.v)}<span class="nm">${esc(g.visitor_team.name)}</span>${s.phase === 'pre' ? '' : `<span class="sb-score led">${s.vs}</span>`}</div>
        <div class="sb-clock">${statusPill(s)}<span class="clock">${s.phase === 'live' ? (s.label === 'HALF' ? 'HALF' : esc(s.clock)) : s.phase === 'final' ? 'FINAL' : 'TIP-OFF'}</span>${stickers(s)}</div>
        <div class="sb-team">${badge(s.h)}<span class="nm">${esc(g.home_team.name)}</span>${s.phase === 'pre' ? '' : `<span class="sb-score led">${s.hs}</span>`}</div>
      </div>
      <table class="linescore" aria-label="Score by quarter"><tr><th></th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>T</th></tr>${lsRow('v')}${lsRow('h')}</table></div>`;
    if (!P) return html + progressHTML() + '<div class="stack" style="margin-top:14px"><div class="skeleton"></div><div class="skeleton"></div></div>';
    const [c1] = TEAM[s.v] || ['#888']; const [c2] = TEAM[s.h] || ['#aaa'];
    const blow = P.blowout.pBlow;
    html += `<div class="meters">
      <div class="meter wide"><div class="lbl">Projected final</div><div class="val">${s.v} ${Math.round(P.projScore[s.v])} – ${Math.round(P.projScore[s.h])} ${s.h}</div>
        <div class="winbar" aria-label="Win chance"><i style="width:${(P.winProb[s.v] * 100).toFixed(0)}%;background:${c1}"></i><i style="flex:1;background:${c2}"></i></div>
        <div class="row between small muted" style="margin-top:4px;font-weight:800"><span>${s.v} ${pct(P.winProb[s.v])}</span><span>${pct(P.winProb[s.h])} ${s.h}</span></div></div>
      <div class="meter"><div class="lbl">Starters-sit risk</div><div class="val">${pct(blow)}</div><div class="gauge"><i style="width:${(blow * 100).toFixed(0)}%;background:${blow >= 0.4 ? 'var(--red)' : blow >= 0.2 ? 'var(--yellow)' : 'var(--green)'}"></i></div></div>
      <div class="meter"><div class="lbl">Pace (poss/48)</div><div class="val">${Math.round(s.phase === 'pre' ? P.pace.season : P.pace.live)}</div><div class="small muted" style="font-weight:700">Season norm ${Math.round(P.pace.season)}</div></div>
    </div>`;
    html += `<a class="btn alt" style="width:100%;margin-top:12px;text-decoration:none" href="${xSearchUrl(g)}" target="_blank" rel="noopener">𝕏 CHECK YOUR 15 X ACCOUNTS FOR THIS GAME</a>`;
    const tm = state.team[id] || s.v;
    html += `<div class="seg" role="group" aria-label="Team">${[s.v, s.h].map((t) => `<button data-act="team" data-g="${id}" data-t="${t}" aria-pressed="${t === tm}">${badge(t, 'sm')}${t}</button>`).join('')}</div>`;
    const players = P.players.filter((p) => p.team === tm && (p.proj.min >= 6 || p.now.min > 0));
    html += `<div class="stack">${players.map((p) => playerCard(p, id, s)).join('') || emptyHTML('No rotation yet', 'Projections appear once data loads.')}</div>`;
    const absent = (P.absent || []).filter((a) => a.team === tm);
    if (absent.length) {
      html += `<div class="section-title">🩹 NOT EXPECTED TONIGHT</div><div class="card stack" style="gap:8px">${absent.map((a) => `<div class="row between"><div><b>${esc(a.name)}</b><div class="small muted" style="font-weight:700">${esc(a.why)}</div></div>
        <button class="btn small ghost" data-act="ov" data-g="${id}" data-p="${a.pid}" data-s="in">HE'S PLAYING</button></div>`).join('')}
        <div class="small muted" style="font-weight:600">His minutes and shots are shared with teammates. Tap if X says he's active.</div></div>`;
    }
    html += `<div class="updated">${s.phase === 'live' ? 'Live from DataBallr play-by-play · ' : ''}${P.sims.toLocaleString()} simulations · updated ${new Date(pr.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</div>`;
    return html;
  }
  function playerCard(p, gid, s) {
    const tags = [];
    if (p.flags.includes('hot')) tags.push('<span class="tag hot">🔥 HOT</span>');
    if (p.flags.includes('cold')) tags.push('<span class="tag cold">🧊 COLD</span>');
    if (p.flags.some((f) => f.startsWith('foul'))) tags.push(`<span class="tag foul">⚠️ ${p.now.pf} FOULS</span>`);
    if (p.flags.includes('sitrisk')) tags.push('<span class="tag sit">💤 MAY SIT LATE</span>');
    if (p.flags.includes('out')) tags.push('<span class="tag out">OUT</span>');
    if (p.dnpYet && s.phase === 'live') tags.push('<span class="tag">NOT IN YET</span>');
    const stat = (k, lbl) => `<div class="stat"><small>${lbl}</small><div class="proj">${half(p.proj[k])}</div><div class="now">${s.phase === 'pre' ? 'proj' : `now <b>${p.now[k]}</b>`}</div></div>`;
    const fouls = Array.from({ length: 6 }, (_, i) => `<i class="${i < p.now.pf ? 'f' : ''}"></i>`).join('');
    const showNow = s.phase !== 'pre';
    return `<button class="card" data-act="player" data-g="${gid}" data-p="${p.pid}" aria-label="${esc(p.name)} details">
      <div class="pc-head"><span class="oncourt ${p.on ? 'on' : ''}" title="${p.on ? 'On the floor' : 'On the bench'}"></span><b>${esc(p.name)}</b><span class="grow"></span>
        <span class="mins">${showNow ? `${Math.round(p.now.min)}′ → ` : ''}${Math.round(p.proj.min)}′</span></div>
      ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
      <div class="statrow">${stat('pts', 'PTS')}${stat('reb', 'REB')}${stat('ast', 'AST')}${stat('fg3m', '3PM')}</div>
      <div class="pc-foot"><div class="minbar" aria-hidden="true"><i class="proj" style="width:${Math.min(100, (p.proj.min / 48) * 100).toFixed(0)}%"></i><i class="played" style="width:${Math.min(100, (p.now.min / 48) * 100).toFixed(0)}%"></i></div>
        <span class="usg">USG ${pct(p.usage.proj)}</span><span class="fouls ${p.now.pf >= 4 ? 'danger' : ''}" aria-label="${p.now.pf} fouls">${fouls}</span></div>
    </button>`;
  }

  // ---- player sheet
  function openSheet(gid, pid) { state.sheetGame = gid; state.sheetPid = pid; renderSheet(); }
  function closeSheet() { state.sheetPid = null; const s = $('#sheetWrap'); if (s) s.remove(); }
  function renderSheet() {
    const pr = state.proj.get(state.sheetGame);
    const p = pr && pr.proj.players.find((x) => x.pid === state.sheetPid);
    if (!p) return closeSheet();
    const s = pr.proj.state;
    let wrap = $('#sheetWrap');
    const fresh = !wrap;
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'sheetWrap'; document.body.appendChild(wrap); }
    const ladder = (k, label) => {
      const rungs = p.ladders[k].filter((r) => r.t > p.now[k] && r.p >= 0.04).slice(0, 6);
      if (!rungs.length) return '';
      const m = p.market && p.market[k];
      const book = m ? `<div class="book">Book line <b>${m.line}</b> · model <b>${pct(m.model)}</b> over vs book <b>${pct(m.book)}</b>${m.model - m.book >= 0.03 ? ' · <b style="color:var(--green)">value ✓</b>' : ''}</div>` : '';
      return `<h3>${label} · now ${p.now[k]} → ${half(p.proj[k])}</h3><div class="ladder">${rungs.map((r) => `<div class="rung"><span>${r.t}+ ${E.STAT_LABEL[k]}</span><div class="bar"><i class="${tier(r.p)}" style="width:${(r.p * 100).toFixed(0)}%"></i></div><span class="pct">${pct(r.p)}</span></div>`).join('')}</div>${book}`;
    };
    const qmax = Math.max(12, ...[1, 2, 3, 4].map((q) => p.qavg[q] || 0));
    const usage = (x) => (x == null ? '–' : pct(x));
    wrap.innerHTML = `<div class="sheet-backdrop" data-act="close"></div>
      <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(p.name)}">
        <div class="grab"></div>
        <div class="row">${badge(p.team)}<div style="flex:1;min-width:0"><h2>${esc(p.name)}</h2><div class="small muted" style="font-weight:700">${p.team} vs ${p.opp} · ${s.phase === 'pre' ? 'pregame' : `${p.now.pts} PTS · ${p.now.reb} REB · ${p.now.ast} AST · ${Math.round(p.now.min)} MIN`}</div></div>
          <button class="icon-btn" data-act="close" aria-label="Close">✕</button></div>
        <div class="row" style="margin-top:12px;gap:8px"><span class="small muted" style="font-weight:800;flex:1">Status tonight (from X / news)</span>
          <button class="chip" data-act="ov" data-g="${state.sheetGame}" data-p="${p.pid}" data-s="clear" aria-pressed="${!getOverrides().out.includes(p.pid)}">PLAYING</button>
          <button class="chip" data-act="ov" data-g="${state.sheetGame}" data-p="${p.pid}" data-s="out" aria-pressed="${getOverrides().out.includes(p.pid)}">OUT</button></div>
        ${ladder('pts', 'POINTS')}${ladder('reb', 'REBOUNDS')}${ladder('ast', 'ASSISTS')}${ladder('fg3m', 'THREES')}${ladder('pra', 'PTS+REB+AST')}
        <h3>SHOT PROFILE</h3>
        <div class="grid3">
          <div class="kv"><small>Usage now</small><b>${usage(p.usage.tonight)}</b></div>
          <div class="kv"><small>Usage season</small><b>${usage(p.usage.season)}</b></div>
          <div class="kv"><small>Usage proj</small><b>${usage(p.usage.proj)}</b></div>
          <div class="kv"><small>FGA → proj</small><b>${p.now.fga} → ${half(p.proj.fga)}</b></div>
          <div class="kv"><small>3PA → proj</small><b>${p.now.fg3a} → ${half(p.proj.fg3a)}</b></div>
          <div class="kv"><small>FTA → proj</small><b>${p.now.fta} → ${half(p.proj.fta)}</b></div>
          <div class="kv"><small>2P%</small><b>${pct(p.shooting.p2)}</b></div>
          <div class="kv"><small>3P%</small><b>${pct(p.shooting.p3)}</b></div>
          <div class="kv"><small>FT%</small><b>${pct(p.shooting.ft)}</b></div>
        </div>
        <h3>MINUTES BY QUARTER</h3>
        <div class="qbars">${[1, 2, 3, 4].map((q) => `<div class="qbar"><div class="col" style="height:${Math.max(4, ((p.qavg[q] || 0) / qmax) * 64)}px"></div>Q${q} · ${(p.qavg[q] || 0).toFixed(1)}′</div>`).join('')}</div>
        <p class="small muted" style="font-weight:600;margin-top:10px">Season average minutes per quarter (${p.games} recent games). Projected ${Math.round(p.proj.min)} total minutes tonight.</p>
      </section>`;
    if (fresh) wrap.querySelector('.sheet').focus?.();
  }

  // ---- picks
  function slatePicks() {
    const out = [];
    for (const g of state.slate) {
      const s = st(g);
      if (s.phase === 'final') continue;
      if (settings.skipBlowouts && E.isBlowout(s)) continue;
      const pr = state.proj.get(g.id);
      if (pr) out.push(...pr.picks);
    }
    return out;
  }
  function pickCard(k) {
    const edge = k.edge != null ? `<span class="edge">+${Math.round(k.edge * 100)}% vs book</span>` : '<span class="edge na">model pick</span>';
    return `<button class="card pick" data-act="player" data-g="${k.gameId}" data-p="${k.pid}">
      <div class="ring" style="--p:${Math.round(k.prob * 100)};--tier:${tierColor(k.prob)}"><span>${pct(k.prob)}</span></div>
      <div class="who"><b>${esc(k.name)}</b><div class="what">${k.kind === 'line' ? 'OVER ' : ''}${esc(k.label)}</div>
        <div class="sub">${esc(k.game)} · now ${k.now} · proj ${half(k.proj)}</div></div>${edge}</button>`;
  }
  function picksView() {
    const filters = [['all', 'ALL'], ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['fg3m', '3PM'], ['pra', 'PRA']];
    let picks = slatePicks();
    if (state.pickFilter !== 'all') picks = picks.filter((k) => k.stat === state.pickFilter);
    let html = `<div class="section-title" style="margin-top:4px">🎯 TOP OVERS</div>
      <div class="chips" role="group" aria-label="Stat filter">${filters.map(([k, l]) => `<button class="chip" data-act="filter" data-f="${k}" aria-pressed="${state.pickFilter === k}">${l}</button>`).join('')}</div>
      <div class="card row between" style="padding:10px 14px"><div><b>Skip blowouts</b><div class="small muted" style="font-weight:600">Hide games up 15+, or 12+ after halftime</div></div>
      <label class="toggle"><input type="checkbox" data-act="skipblow" ${settings.skipBlowouts ? 'checked' : ''} aria-label="Skip blowouts"><span></span></label></div>`;
    html += progressHTML();
    if (!picks.length) return html + (state.busy || state.progress ? '<div class="stack" style="margin-top:14px"><div class="skeleton"></div></div>' : emptyHTML('No overs clear the bar yet', 'Picks show when a player is 60%+ to clear a book line with value, or 75%+ on a model rung.'));
    const value = picks.filter((k) => k.kind === 'line'), safe = picks.filter((k) => k.kind !== 'line');
    if (value.length) html += `<div class="section-title">💎 VALUE OVERS <span class="count">model beats the book line</span></div><div class="stack">${value.slice(0, 25).map(pickCard).join('')}</div>`;
    if (safe.length) html += `<div class="section-title">🛡️ SAFE LADDER <span class="count">75%+ rungs</span></div><div class="stack">${safe.sort((a, b) => b.prob - a.prob).slice(0, 25).map(pickCard).join('')}</div>`;
    html += `<p class="updated">Value = model chance minus the no-vig book chance from DataBallr props. Safe ladder = highest rung still 75%+.</p>`;
    return html;
  }

  // ---- combos
  function combosView() {
    const picks = slatePicks();
    const C = E.buildCombos(picks, { payout: settings.payout, max: 6 });
    let html = `<div class="section-title" style="margin-top:4px">🎟️ 2-LEG OVER TICKETS</div>
      <div class="chips" role="group" aria-label="Payout">${[2, 2.5, 3, 4, 5].map((x) => `<button class="chip" data-act="payout" data-x="${x}" aria-pressed="${settings.payout === x}">PAYS ${x}x</button>`).join('')}</div>
      <div class="card small" style="font-weight:700">Break-even win chance at ${settings.payout}x: <b class="led">${pct(C.breakEven)}</b>. Every ticket below beats it.</div>`;
    html += progressHTML();
    const ticket = (c, alt) => `<div class="ticket ${alt ? 'alt' : ''}">${c.legs.map((l) => `<div class="leg">${badge(l.team, 'sm')}<div><div>${esc(l.name)} · ${l.kind === 'line' ? 'O ' : ''}${esc(l.label)}</div><small>${esc(l.game)} · now ${l.now}</small></div><span class="p">${pct(l.prob)}</span></div>`).join('')}
      <div class="tfoot"><span>HITS ${pct(c.joint)}</span><span>${c.sameGame ? 'SAME GAME · ' : ''}+${Math.round(c.ev * 100)}% VALUE</span></div></div>`;
    if (!C.repeats.length) return html + emptyHTML('No tickets beat the payout yet', 'Lower the payout or check back as games heat up.');
    html += `<div class="section-title">1️⃣ EACH PLAYER ONCE</div><div class="stack">${C.once.map((c) => ticket(c, false)).join('')}</div>`;
    html += `<div class="section-title">🔁 REPEATS ALLOWED</div><div class="stack">${C.repeats.map((c) => ticket(c, true)).join('')}</div>`;
    return html;
  }

  // ---- settings
  function settingsView() {
    const chipRow = (act, vals, cur, fmt) => `<div class="chips">${vals.map((v) => `<button class="chip" data-act="${act}" data-x="${v}" aria-pressed="${cur === v}">${fmt(v)}</button>`).join('')}</div>`;
    const a = ACCURACY;
    return `<div class="section-title" style="margin-top:4px">⚙️ SETTINGS</div>
      <div class="card">
        <div class="setting"><div><b>Auto refresh</b><small>How often live data updates</small></div></div>
        ${chipRow('refresh', [15, 20, 30, 60], settings.refresh, (v) => `${v}s`)}
        <div class="setting"><div><b>Simulation depth</b><small>More sims = smoother percentages</small></div></div>
        ${chipRow('sims', [1000, 2000, 4000], settings.sims, (v) => (v === 1000 ? 'FAST' : v === 2000 ? 'SHARP' : 'MAX'))}
        <div class="setting"><div><b>Skip blowouts</b><small>Hide games up 15+, or 12+ after halftime, from picks</small></div>
          <label class="toggle"><input type="checkbox" data-act="skipblow" ${settings.skipBlowouts ? 'checked' : ''} aria-label="Skip blowouts"><span></span></label></div>
        <div class="setting"><div><b>Pick confidence floor</b><small>Minimum model chance for book-line overs</small></div></div>
        ${chipRow('minp', [0.55, 0.6, 0.65, 0.7], settings.minP, (v) => pct(v))}
      </div>
      <div class="section-title">🎯 MODEL ACCURACY</div>
      <div class="card">
        <div class="small muted" style="font-weight:700;margin-bottom:8px">Backtested on ${a.games} finished games. Average miss per player:</div>
        <div class="small" style="font-weight:800;margin:6px 0 4px">From end of Q3</div>
        <div class="acc"><div><b>${a.q3.pts}</b><small>PTS</small></div><div><b>${a.q3.reb}</b><small>REB</small></div><div><b>${a.q3.ast}</b><small>AST</small></div><div><b>${a.q3.fg3m}</b><small>3PM</small></div></div>
        <div class="small" style="font-weight:800;margin:10px 0 4px">From halftime</div>
        <div class="acc"><div><b>${a.half.pts}</b><small>PTS</small></div><div><b>${a.half.reb}</b><small>REB</small></div><div><b>${a.half.ast}</b><small>AST</small></div><div><b>${a.half.fg3m}</b><small>3PM</small></div></div>
        <p class="small muted" style="font-weight:600;margin:10px 0 0">Calibrated: ${a.calib}. Built from DataBallr play-by-play, usage, shot mix, defense, pace and each coach's blowout habits.</p>
      </div>
      <div class="section-title">📲 APP</div>
      <div class="card stack">
        ${state.installEvt ? `<button class="btn" data-act="install">${ICON.install} INSTALL ON THIS PHONE</button>` : '<div class="small muted" style="font-weight:700">To install: Chrome menu ⋮ → <b>Install app</b> (or Add to Home screen).</div>'}
        <button class="btn ghost" data-act="clear">CLEAR SAVED DATA</button>
        <div class="small muted" style="font-weight:600">Data: DataBallr (live games, play-by-play, season stats, injuries, props). Projections are estimates.</div>
      </div>`;
  }

  // ------------------------------------------------------------------ events
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'player') { e.preventDefault(); openSheet(+el.dataset.g, +el.dataset.p); }
    else if (act === 'close') closeSheet();
    else if (act === 'ov') {
      setOverride(+el.dataset.p, el.dataset.s === 'clear' ? null : el.dataset.s);
      toast(el.dataset.s === 'out' ? 'Marked out — minutes shared with teammates' : 'Got it — counted as playing');
      if (el.dataset.s === 'out') closeSheet();
      const g = state.slate.find((x) => x.id === +el.dataset.g);
      if (g) { await projectGame(g); render(); }
    }
    else if (act === 'team') { state.team[+el.dataset.g] = el.dataset.t; render(); }
    else if (act === 'filter') { state.pickFilter = el.dataset.f; render(); }
    else if (act === 'payout') { settings.payout = +el.dataset.x; saveSettings(); render(); }
    else if (act === 'refresh') { settings.refresh = +el.dataset.x; saveSettings(); restartTimer(); render(); }
    else if (act === 'sims') { settings.sims = +el.dataset.x; saveSettings(); state.proj.clear(); render(); refreshAll({ force: true }); }
    else if (act === 'minp') { settings.minP = +el.dataset.x; saveSettings(); state.proj.clear(); render(); refreshAll({ force: true }); }
    else if (act === 'day') {
      state.dayOffset += +el.dataset.d; state.date = DB.etDate(state.dayOffset);
      state.slate = []; state.proj.clear(); render(); refreshAll({ force: true });
    } else if (act === 'refresh-now') refreshAll({ force: true });
    else if (act === 'install' && state.installEvt) { state.installEvt.prompt(); state.installEvt = null; render(); }
    else if (act === 'clear') { DB.clearCache(); state.logs.clear(); state.logTeams.clear(); state.priors = null; state.proj.clear(); toast('Saved data cleared'); refreshAll({ force: true }); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-act="skipblow"]')) { settings.skipBlowouts = e.target.checked; saveSettings(); render(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installEvt = e; render(true); });

  // ------------------------------------------------------------------ live loop
  let timer;
  function restartTimer() {
    clearInterval(timer);
    timer = setInterval(() => {
      if (document.hidden) return;
      const r = route();
      const live = state.slate.filter((g) => st(g).phase === 'live');
      if (r.name === 'game') {
        const g = state.slate.find((x) => x.id === +r.id);
        refreshAll({ games: g ? [g] : [] });
      } else refreshAll({ games: state.slate.filter((g) => st(g).phase !== 'final' || !state.proj.has(g.id)).sort((a) => (live.includes(a) ? -1 : 1)) });
    }, settings.refresh * 1000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(); });

  // ------------------------------------------------------------------ boot
  $('#mascot').innerHTML = MASCOT;
  document.querySelectorAll('[data-icon]').forEach((n) => { n.innerHTML = ICON[n.dataset.icon] + n.innerHTML; });
  $('#refreshBtn').addEventListener('click', () => refreshAll({ force: true }));
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
  refreshAll({ force: true });
  restartTimer();
})();
