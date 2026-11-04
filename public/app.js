/* CourtSide Pace — FanDuel eBasketball live totals (H2H GG League 4x5) */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  const S = {
    view: store.get('cs.view', 'board'),
    board: null,
    selected: store.get('cs.selected', null),
    detail: null,
    settings: { edge: 4, ev: 3, poll: 8, ...store.get('cs.settings', {}) },
    qTrack: {},
    players: null,
    playerSort: 'n',
    perfDays: 7,
    lg: { games: [], filter: 'live', selected: null, detail: null },
    timers: [],
    loadingBoard: false,
  };

  // ---------- formatting ----------
  const n1 = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : (Math.round(Number(v) * 10) / 10).toFixed(1));
  const sign = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${v > 0 ? '+' : ''}${n1(v)}`);
  const odds = (o) => (o == null ? '' : o > 0 ? `+${o}` : `${o}`);
  const pct = (p) => (p == null ? '—' : `${Math.round(p * 1000) / 10}%`);
  const evPct = (e) => (e == null ? '—' : `${e > 0 ? '+' : ''}${Math.round(e * 1000) / 10}%`);
  const hhmm = (ms) => { try { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
  const callCls = (c) => (c === 'Over' ? 'over' : c === 'Under' ? 'under' : '');

  function toast(msg, ms = 3600) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.add('hidden'), ms);
  }

  async function api(path, opts) {
    const res = await fetch(path, { cache: 'no-store', headers: { Accept: 'application/json' }, ...opts });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(body.error || `HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return body;
  }

  function qparams() {
    return `edge=${encodeURIComponent(S.settings.edge)}&ev=${encodeURIComponent(S.settings.ev / 100)}`;
  }

  // ---------- views ----------
  function setView(v) {
    S.view = v;
    store.set('cs.view', v);
    document.querySelectorAll('.view').forEach((el) => el.classList.toggle('hidden', el.dataset.view !== v));
    document.querySelectorAll('[data-view]').forEach((b) => { if (b.tagName === 'BUTTON') b.classList.toggle('active', b.dataset.view === v); });
    window.scrollTo({ top: 0 });
    if (v === 'game') loadDetail();
    if (v === 'lab') loadPlayers();
    if (v === 'results') loadPerformance();
    if (v === 'leagues') loadLeagues();
  }

  // ---------- board ----------
  function progressBar(f) {
    const w = Math.max(0, Math.min(1, f || 0)) * 100;
    return `<div class="progress"><i style="width:${w}%"></i><span class="tick" style="left:25%"></span><span class="tick" style="left:50%"></span><span class="tick" style="left:75%"></span></div>`;
  }

  function quarterLabel(ev, status) {
    if (status === 'pre' || status === 'scheduled') return 'PRE';
    const f = ev?.progress?.f || 0;
    if (f >= 0.999) return 'END';
    const q = Math.min(4, Math.floor(f * 4) + 1);
    return `Q${q} ~${Math.round(f * 100)}%`;
  }

  function gameCard(g) {
    const ev = g.eval;
    const gm = ev.markets.find((m) => m.id === 'game') || {};
    const call = gm.call && gm.call !== 'Pass' ? gm.call : null;
    const live = g.status === 'live';
    const sel = S.selected === g.eventId ? ' selected' : '';
    const gapCls = gm.gap > 0 ? 'pos' : gm.gap < 0 ? 'neg' : '';
    return `<article class="panel game-card${sel}" data-event="${esc(g.eventId)}">
      <div class="gc-top">
        <div class="gc-teams">
          <div class="gc-line"><div class="gc-player">${esc(g.away.player)}<span class="gc-team">${esc(g.away.team)}</span></div><div class="gc-score">${live ? g.away.score : ''}</div></div>
          <div class="gc-line"><div class="gc-player">${esc(g.home.player)}<span class="gc-team">${esc(g.home.team)}</span></div><div class="gc-score">${live ? g.home.score : ''}</div></div>
        </div>
      </div>
      ${live ? progressBar(ev.progress.f) : ''}
      <div class="gc-nums">
        <div class="kv"><div class="k">FD total</div><div class="v">${gm.line ?? '—'} <small>${gm.line != null ? odds(gm.overOdds) : ''}</small></div></div>
        <div class="kv"><div class="k">Our proj</div><div class="v">${n1(gm.mean)}</div></div>
        <div class="kv"><div class="k">Gap</div><div class="v ${gapCls}">${sign(gm.gap)}</div></div>
      </div>
      <div class="gc-meta">
        <span class="chip ${live ? 'live' : 'pre'}">${live ? 'LIVE' : `TIP ${hhmm(g.tipMs || g.scheduledMs)}`}</span>
        ${live ? `<span class="chip">${quarterLabel(ev, g.status)}</span>` : ''}
        ${call ? `<span class="chip ${callCls(call)}">${call.toUpperCase()} ${gm.line} · EV ${evPct(gm.ev)}</span>` : `<span class="chip">${esc(gm.reason || 'Pass')}</span>`}
        <span class="chip">${ev.confidence.level}</span>
        ${gm.open === false ? '<span class="chip warn">SUSPENDED</span>' : ''}
      </div>
    </article>`;
  }

  function upcomingCard(u) {
    const ev = u.eval;
    const h1 = ev.markets.find((m) => m.id === 'half1');
    const l10 = h1?.last10;
    const pair = ev.pregame.pair;
    return `<article class="panel game-card" data-lab="${esc(u.away.player)}|${esc(u.home.player)}">
      <div class="gc-top"><div class="gc-teams">
        <div class="gc-line"><div class="gc-player">${esc(u.away.player)}<span class="gc-team">${esc(u.away.team)}</span></div></div>
        <div class="gc-line"><div class="gc-player">${esc(u.home.player)}<span class="gc-team">${esc(u.home.team)}</span></div></div>
      </div></div>
      <div class="gc-nums">
        <div class="kv"><div class="k">Our total</div><div class="v">${n1(ev.pregame.expected)}</div></div>
        <div class="kv"><div class="k">Our 1H</div><div class="v">${n1(h1?.mean)}</div></div>
        <div class="kv"><div class="k">Last-10 1H</div><div class="v">${l10 ? n1(l10.avg) : '—'}</div></div>
      </div>
      <div class="gc-meta">
        <span class="chip pre">${hhmm(u.scheduledMs)}</span>
        ${u.stream ? `<span class="chip">${esc(u.stream)}</span>` : ''}
        ${pair && pair.n >= 3 ? `<span class="chip accent">H2H ${pair.n}× avg ${n1(pair.avgTotal)}</span>` : ''}
        <span class="chip">FD line posts ~5 min before tip</span>
      </div>
    </article>`;
  }

  function pickCard(p) {
    const m = p.market;
    return `<article class="panel pick" data-event="${esc(p.eventId)}">
      <div class="row1">
        <div class="who">${esc(p.away.player)} <span class="muted">vs</span> ${esc(p.home.player)}</div>
        <span class="verdict ${callCls(m.call)}">${m.call.toUpperCase()} ${m.line}</span>
      </div>
      <div class="mkt">${esc(m.label)} · ours ${n1(m.mean)} · gap ${sign(m.gap)} · ${odds(m.call === 'Over' ? m.overOdds : m.underOdds)} · EV ${evPct(m.ev)}</div>
    </article>`;
  }

  function renderBoard() {
    const b = S.board;
    if (!b) return;
    const live = b.live || [];
    $('liveCount').textContent = live.length;
    $('upCount').textContent = (b.upcoming || []).length;
    $('pickCount').textContent = (b.picks || []).length;
    $('picks').innerHTML = (b.picks || []).length
      ? b.picks.map(pickCard).join('')
      : `<div class="panel pick-empty">No game clears your ${S.settings.edge}-pt gap + value filter right now. Volume works for you — wait for the next one.</div>`;
    $('liveList').innerHTML = live.length ? live.map(gameCard).join('') : '<div class="panel pick-empty">No eBasketball games on FanDuel’s in-play board right now.</div>';
    $('upList').innerHTML = (b.upcoming || []).length ? b.upcoming.slice(0, 12).map(upcomingCard).join('') : '<div class="panel pick-empty">Schedule loading or no games in the next 75 minutes.</div>';
    const m = b.model || {};
    $('modelNote').textContent = `Model: ${m.players || 0} gamers rated from ${m.games || 0} official H2H finals (${m.quarterGames || 0} with quarter splits) · built ${m.builtAt ? new Date(m.builtAt).toLocaleString() : '—'}.`;
    document.querySelectorAll('[data-event]').forEach((el) => { el.onclick = () => selectGame(el.dataset.event); });
    document.querySelectorAll('[data-lab]').forEach((el) => {
      el.onclick = () => {
        const [a, bb] = el.dataset.lab.split('|');
        $('labA').value = a;
        $('labB').value = bb;
        setView('lab');
        runLab();
      };
    });
  }

  async function loadBoard(manual = false) {
    if (S.loadingBoard) return;
    S.loadingBoard = true;
    if (manual) $('refreshBtn').classList.add('spin');
    try {
      S.board = await api(`/api/eb/board?${qparams()}`);
      const n = (S.board.live || []).length;
      $('feedBadge').textContent = `● ${n} LIVE`;
      $('feedBadge').className = 'badge badge-live';
      renderBoard();
    } catch (err) {
      $('feedBadge').textContent = 'FEED ERROR';
      $('feedBadge').className = 'badge badge-bad';
      if (manual || !S.board) toast(`Board: ${err.message}`);
    } finally {
      S.loadingBoard = false;
      setTimeout(() => $('refreshBtn').classList.remove('spin'), 400);
    }
  }

  // ---------- game detail ----------
  function selectGame(eventId) {
    S.selected = eventId;
    store.set('cs.selected', eventId);
    S.detail = null;
    setView('game');
  }

  function trackQuarter(d) {
    const id = d.game.eventId;
    const hint = d.game.lines?.quarterHint || null;
    const now = Date.now();
    const t = S.qTrack[id] || { lastHint: undefined, lastT: 0, starts: {} };
    if (hint && hint !== t.lastHint && t.lastT && now - t.lastT < 30000 && t.starts[hint] == null) {
      t.starts[hint] = d.game.total;
    }
    t.lastHint = hint;
    t.lastT = now;
    S.qTrack[id] = t;
  }

  function qsParam(id) {
    const t = S.qTrack[id];
    if (!t) return '';
    const qs = Object.keys(t.starts).map(Number).sort((a, b) => b - a)[0];
    return qs ? `&qs=${qs}:${t.starts[qs]}` : '';
  }

  function marketCard(m) {
    const call = m.call && m.call !== 'Pass' ? m.call : null;
    const nums = m.mean == null && m.full != null
      ? `<div class="kv"><div class="k">FD line</div><div class="v">${m.line ?? '—'}</div></div>
         <div class="kv"><div class="k">Full Q exp</div><div class="v">${n1(m.full)}</div></div>`
      : `<div class="kv"><div class="k">FD line</div><div class="v">${m.line ?? '—'}</div></div>
         <div class="kv"><div class="k">Ours</div><div class="v">${n1(m.mean)}</div></div>
         <div class="kv"><div class="k">Gap</div><div class="v ${m.gap > 0 ? 'pos' : m.gap < 0 ? 'neg' : ''}">${sign(m.gap)}</div></div>
         <div class="kv"><div class="k">P(over)</div><div class="v">${pct(m.pOver)}</div></div>`;
    const priceLine = m.line != null
      ? `O ${odds(m.overOdds)} / U ${odds(m.underOdds)} · blended fair ${n1(m.fair)} · FanDuel no-vig over ${pct(m.fdOver)} · EV over ${evPct(m.evOver)} / under ${evPct(m.evUnder)}`
      : 'No FanDuel line posted for this market yet.';
    const extra = [];
    if (m.last10) extra.push(`Last-10 1H method: ${m.last10.away} + ${m.last10.home} → <strong>${m.last10.avg}</strong>${m.line != null ? ` (gap ${sign(m.last10.avg - m.line)})` : ''}`);
    if (m.note) extra.push(esc(m.note));
    if (m.soFar != null && m.id.startsWith('q')) extra.push(`Quarter points so far: ${m.soFar}`);
    return `<article class="panel market ${call ? `call-${callCls(call)}` : ''}">
      <div class="market-head"><h3>${esc(m.label)}</h3><span class="verdict ${callCls(call)}">${call ? `${call.toUpperCase()} ${m.line}` : 'PASS'}</span></div>
      <div class="gc-nums">${nums}</div>
      <p class="why">${priceLine}${m.reason && !call ? ` · <span class="muted">${esc(m.reason)}</span>` : ''}</p>
      ${extra.length ? `<p class="why">${extra.join('<br>')}</p>` : ''}
    </article>`;
  }

  function gamerCard(card, side) {
    const r = card.rating;
    const p = card.profile;
    const max = p ? Math.max(...p.qFor, 1) : 1;
    const bars = p
      ? `<div class="qbars">${p.qFor.map((v, i) => `<div class="${p.bestQuarter === i + 1 ? 'best' : ''}" style="height:${Math.max(8, (v / max) * 100)}%"><span>${v}</span></div>`).join('')}</div><div class="qlabels"><span>Q1</span><span>Q2</span><span>Q3</span><span>Q4</span></div>`
      : '<p class="muted small">Quarter profile builds as more play-by-play is collected.</p>';
    const recent = (card.recent || []).slice(0, 6).map((g) => `<tr><td>${esc(g.opp)}</td><td>${g.for}-${g.against}</td><td>${g.total}</td></tr>`).join('');
    return `<article class="panel pad">
      <div class="section-head compact"><div><p class="eyebrow">${side}</p><h2>${esc(card.player)}</h2></div>
        <span class="chip accent">${r ? `${r.n} games` : 'new'}</span></div>
      <div class="gc-nums">
        <div class="kv"><div class="k">Scores</div><div class="v">${r ? n1(r.avgFor) : '—'}</div></div>
        <div class="kv"><div class="k">Allows</div><div class="v">${r ? n1(r.avgAgainst) : '—'}</div></div>
        <div class="kv"><div class="k">Last-10 1H</div><div class="v">${p ? n1(p.last10Half.avg) : '—'}</div></div>
      </div>
      <p class="why">Points scored by quarter (avg) — ${p ? `strongest Q${p.bestQuarter}` : ''}</p>
      ${bars}
      ${recent ? `<table class="mini-table"><thead><tr><th>Last vs</th><th>Score</th><th>Total</th></tr></thead><tbody>${recent}</tbody></table>` : ''}
    </article>`;
  }

  function renderDetail() {
    const d = S.detail;
    if (!d) return;
    $('gameEmpty').classList.add('hidden');
    $('gameDetail').classList.remove('hidden');
    const g = d.game;
    const ev = d.eval;
    const gm = ev.markets.find((m) => m.id === 'game') || {};
    $('strip').innerHTML = `
      <span class="chip ${g.status === 'live' ? 'live' : 'pre'}">${g.status === 'live' ? 'LIVE' : 'PRE'}</span>
      <div class="strip-score">
        <span class="strip-player">${esc(g.away.player)}</span><span class="strip-num">${g.away.score}</span>
        <span class="strip-colon">:</span>
        <span class="strip-num">${g.home.score}</span><span class="strip-player">${esc(g.home.player)}</span>
      </div>
      <div class="strip-q">${quarterLabel(ev, g.status)}</div>
      <div class="strip-proj"><span>PROJ / FD</span><strong>${n1(gm.mean)} / ${gm.line ?? '—'}</strong></div>`;
    // Team totals only matter when FanDuel actually posts them.
    $('marketCards').innerHTML = ev.markets.filter((m) => !/Total$/.test(m.id) || m.line != null).map(marketCard).join('');
    const pre = ev.pregame;
    const notes = (ev.confidence.notes || []).map((x) => `<li>${esc(x)}</li>`).join('');
    $('whyCard').innerHTML = `
      <div class="section-head compact"><div><p class="eyebrow">MODEL INPUTS</p><h2>Why the number</h2></div><span class="chip">${ev.confidence.level} · ${ev.confidence.score}</span></div>
      <div class="input-row"><span>Pregame number</span><strong>${n1(pre.expected)} (${esc(pre.blendNote)})</strong></div>
      <div class="input-row"><span>Ratings split</span><strong>${n1(pre.away)} + ${n1(pre.home)}</strong></div>
      <div class="input-row"><span>FanDuel opener</span><strong>${g.opening ?? '—'}</strong></div>
      <div class="input-row"><span>Live scoring pace /20 min</span><strong>${n1(ev.rate.pacePer20)}</strong></div>
      <div class="input-row"><span>Blended rate /20 min</span><strong>${n1(ev.rate.total)}</strong></div>
      <div class="input-row"><span>Game progress</span><strong>${Math.round(ev.progress.f * 100)}% · ${ev.progress.minutes} min since tip</strong></div>
      <div class="input-row"><span>Clock source</span><strong>${esc(ev.progress.source)}</strong></div>
      <div class="input-row"><span>Trust in our number vs FanDuel</span><strong>${Math.round((ev.modelWeight ?? 0.35) * 100)}% / ${100 - Math.round((ev.modelWeight ?? 0.35) * 100)}%</strong></div>
      <p class="why">In this league the pregame number carries as much weight as ~1.5 full games of live scoring — hot or cold starts move the projection less than you’d think.</p>
      ${notes ? `<ul class="notes">${notes}</ul>` : ''}`;
    const h = d.h2h;
    const rows = (h.games || []).map((x) => `<tr><td>${new Date(x.t).toLocaleDateString([], { month: 'short', day: 'numeric' })}</td><td>${x.a}-${x.b}</td><td>${x.total}</td></tr>`).join('');
    $('h2hCard').innerHTML = `
      <div class="section-head compact"><div><p class="eyebrow">HEAD TO HEAD</p><h2>${esc(g.away.player)} vs ${esc(g.home.player)}</h2></div><span class="chip accent">${h.meetings} meetings</span></div>
      ${h.meetings ? `<div class="gc-nums"><div class="kv"><div class="k">Avg total</div><div class="v">${n1(h.avgTotal)}</div></div><div class="kv"><div class="k">Model adj</div><div class="v">${pre.pair ? sign(pre.pair.adj) : '—'}</div></div><div class="kv"><div class="k">Used?</div><div class="v">${h.meetings >= 3 ? 'yes' : 'no'}</div></div></div>
      <table class="mini-table"><thead><tr><th>Date</th><th>${esc(g.away.player)}-${esc(g.home.player)}</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="why">3+ meetings get a small, shrunk adjustment — raw head-to-head averages overfit in backtests.</p>` : '<p class="muted small">No recent meetings in the last 4 weeks.</p>'}`;
    $('gamerCards').innerHTML = gamerCard(d.gamers.away, 'AWAY') + gamerCard(d.gamers.home, 'HOME');
  }

  async function loadDetail() {
    if (!S.selected) {
      $('gameEmpty').classList.remove('hidden');
      $('gameDetail').classList.add('hidden');
      return;
    }
    try {
      const d = await api(`/api/eb/game/${encodeURIComponent(S.selected)}?${qparams()}${qsParam(S.selected)}`);
      trackQuarter(d);
      S.detail = d;
      renderDetail();
    } catch (err) {
      if (err.status === 404) {
        toast('That game just finished — it will show up in Results once graded.');
        S.selected = null;
        store.set('cs.selected', null);
        $('gameEmpty').classList.remove('hidden');
        $('gameDetail').classList.add('hidden');
      } else toast(`Game: ${err.message}`);
    }
  }

  // ---------- lab ----------
  async function loadPlayers() {
    if (S.players) { renderPlayers(); return; }
    try {
      S.players = await api('/api/eb/players');
      $('playerList').innerHTML = S.players.players.map((p) => `<option value="${esc(p.name)}">`).join('');
      renderPlayers();
    } catch (err) {
      $('playerTable').innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    }
  }

  function renderPlayers() {
    if (!S.players) return;
    const q = ($('playerSearch').value || '').trim().toUpperCase();
    let list = S.players.players.filter((p) => !q || p.name.includes(q));
    const key = S.playerSort;
    if (key === 'low') list = list.slice().sort((a, b) => a.vsAvgTotal - b.vsAvgTotal);
    else if (key === 'n') list = list.slice().sort((a, b) => b.n - a.n);
    else list = list.slice().sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1));
    $('playerTable').innerHTML = `<table class="mini-table"><thead><tr><th>Gamer</th><th>G</th><th>For</th><th>Agst</th><th>Total vs avg opp</th><th>L10 1H</th><th>Best Q</th></tr></thead><tbody>
      ${list.map((p) => `<tr data-player="${esc(p.name)}"><td>${esc(p.name)}</td><td>${p.n}</td><td>${n1(p.avgFor)}</td><td>${n1(p.avgAgainst)}</td><td>${n1(p.vsAvgTotal)}</td><td>${p.last10Half != null ? n1(p.last10Half) : '—'}</td><td>${p.bestQuarter ? `Q${p.bestQuarter}` : '—'}</td></tr>`).join('')}
    </tbody></table>`;
    document.querySelectorAll('[data-player]').forEach((tr) => {
      tr.onclick = () => {
        const target = !$('labA').value ? 'labA' : 'labB';
        $(target).value = tr.dataset.player;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if ($('labA').value && $('labB').value) runLab();
      };
    });
  }

  async function runLab() {
    const a = $('labA').value.trim();
    const b = $('labB').value.trim();
    if (!a || !b) return;
    const qs = new URLSearchParams({ a, b, line: $('labLine').value, half1: $('labHalf').value, edge: S.settings.edge });
    $('labOut').innerHTML = '<div class="skeleton"></div>';
    try {
      const r = await api(`/api/eb/matchup?${qs}`);
      const pg = r.priceGame;
      const ph = r.priceHalf;
      const verdicts = [];
      for (const [label, p, ours] of [['Game total', pg, r.pregame.expected], ['1st half', ph, r.half1]]) {
        if (!p) continue;
        const call = p.call !== 'Pass' ? `<strong class="${p.gap > 0 ? 'pos' : 'neg'}">${p.call.toUpperCase()} ${p.line}</strong>` : '<strong>PASS</strong>';
        verdicts.push(`${label}: ours ${n1(ours)} vs ${p.line} → gap ${sign(p.gap)} · P(over) ${pct(p.pOver)} → ${call}${p.reason && p.call === 'Pass' ? ` <span class="muted">(${esc(p.reason)})</span>` : ''}`);
      }
      if (ph && r.last10Half != null) {
        const g10 = r.last10Half - ph.line;
        const agree = Math.sign(g10) === Math.sign(ph.gap) && Math.abs(g10) >= 2;
        verdicts.push(`Last-10 1H method: ${n1(r.last10Half)} (gap ${sign(g10)}) — ${agree ? '<strong class="pos">agrees with the model</strong>' : 'does not confirm'}`);
      }
      $('labOut').innerHTML = `<div class="lab-result">
        <div class="kv"><div class="k">Our game total</div><div class="v">${n1(r.pregame.expected)}</div></div>
        <div class="kv"><div class="k">Our 1st half</div><div class="v">${n1(r.half1)}</div></div>
        <div class="kv"><div class="k">Last-10 1H</div><div class="v">${n1(r.last10Half)}</div></div>
        <div class="kv"><div class="k">Split</div><div class="v">${n1(r.pregame.away)}-${n1(r.pregame.home)}</div></div>
        <div class="kv"><div class="k">Quarters</div><div class="v">${r.quarters.map(n1).join(' · ')}</div></div>
        <div class="kv"><div class="k">H2H</div><div class="v">${r.h2h.meetings}× ${r.h2h.avgTotal != null ? `avg ${n1(r.h2h.avgTotal)}` : ''}</div></div>
        <div class="lab-verdict">${verdicts.length ? verdicts.join('<br>') : 'Add a FanDuel line above to see your gap and the call.'}</div>
      </div>`;
    } catch (err) {
      $('labOut').innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    }
  }

  // ---------- results ----------
  async function loadPerformance() {
    $('perfOut').innerHTML = '<div class="skeleton tall"></div>';
    try {
      const p = await api(`/api/eb/performance?days=${S.perfDays}`);
      const all = p.markets.reduce((a, m) => ({ n: a.n + m.n, w: a.w + m.w, l: a.l + m.l, units: a.units + m.units }), { n: 0, w: 0, l: 0, units: 0 });
      const win = all.w + all.l ? `${Math.round((all.w / (all.w + all.l)) * 1000) / 10}%` : '—';
      const mt = (rows, keyLabel, key) => (rows.length ? `<table class="mini-table"><thead><tr><th>${keyLabel}</th><th>Bets</th><th>W-L-P</th><th>Win%</th><th>Units</th><th>ROI</th></tr></thead><tbody>${rows.map((m) => `<tr><td>${esc(m[key])}</td><td>${m.n}</td><td>${m.w}-${m.l}-${m.p}</td><td>${m.winPct ?? '—'}%</td><td class="${m.units >= 0 ? 'pos' : 'neg'}">${m.units >= 0 ? '+' : ''}${m.units}</td><td>${m.roi ?? '—'}%</td></tr>`).join('')}</tbody></table>` : '');
      const acc = p.accuracy.length ? `<table class="mini-table"><thead><tr><th>Market @ point</th><th>Games</th><th>Our miss</th><th>FD line miss</th></tr></thead><tbody>${p.accuracy.map((a) => `<tr><td>${a.market === 'game' ? 'Game' : '1H'} @ ${a.checkpoint === 0 ? 'pregame' : `${a.checkpoint}%`}</td><td>${a.n}</td><td>${a.modelMae}</td><td>${a.lineMae}</td></tr>`).join('')}</tbody></table>` : '';
      const recent = p.recent.length ? `<table class="mini-table"><thead><tr><th>Game</th><th>Call</th><th>Final</th><th>Res</th></tr></thead><tbody>${p.recent.slice(0, 20).map((s) => `<tr><td>${esc((s.name || '').replace(/\s*\([^)]*\)/g, (m) => m.replace(/[()]/g, '')).slice(0, 34))}<br><span class="muted small">${esc(s.label)} · ${esc(s.note || '')}</span></td><td>${s.side} ${s.line} (${odds(s.odds)})</td><td>${s.actual ?? '—'}</td><td class="res-${s.result}">${s.result}</td></tr>`).join('')}</tbody></table>` : '';
      const tr = p.tracking;
      $('perfOut').innerHTML = `
        <div class="stat-row">
          <div class="kv"><div class="k">Games graded</div><div class="v">${p.games}</div></div>
          <div class="kv"><div class="k">Calls</div><div class="v">${all.n}</div></div>
          <div class="kv"><div class="k">Win rate</div><div class="v">${win}</div></div>
          <div class="kv"><div class="k">Units (1u flat)</div><div class="v ${all.units >= 0 ? 'pos' : 'neg'}">${all.units >= 0 ? '+' : ''}${Math.round(all.units * 100) / 100}</div></div>
        </div>
        ${p.games ? '' : '<p class="muted">The tracker grades every FanDuel eBasketball game automatically (runs every 2 minutes on Netlify). First results land about 30 minutes after the first games finish.</p>'}
        ${mt(p.markets.map((m) => ({ ...m, label: { game: 'Game total', half1: '1st half', awayTotal: 'Away team', homeTotal: 'Home team' }[m.market] || m.market })), 'Market', 'label')}
        ${p.gapBuckets.length ? '<p class="why">By size of gap — raise your minimum gap in Settings if the small bucket loses.</p>' : ''}
        ${mt(p.gapBuckets, 'Gap', 'bucket')}
        ${acc ? '<p class="why">Average miss vs the official final (lower is better).</p>' + acc : ''}
        ${recent ? '<p class="why">Latest graded calls</p>' + recent : ''}
        <p class="footnote">${tr ? `Tracking ${tr.active} live · ${tr.awaitingGrade} awaiting official finals · last run ${tr.lastRun ? new Date(tr.lastRun.at).toLocaleTimeString() : '—'}` : 'Tracker has not run yet.'}</p>`;
    } catch (err) {
      $('perfOut').innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    }
  }

  // ---------- leagues (real basketball) ----------
  const LG_FILTERS = [['live', 'Live'], ['all', 'All'], ['nba', 'NBA'], ['wnba', 'WNBA'], ['nbl', 'NBL'], ['euroleague', 'Euro'], ['bbl', 'BBL'], ['lkl', 'LKL'], ['ncaam', 'NCAAM']];
  const lgLive = (g) => g.status === 'in_progress' || g.status === 'halftime';

  function renderLeagueList() {
    $('leagueFilters').innerHTML = LG_FILTERS.map(([id, l]) => `<button type="button" data-lf="${id}" class="${S.lg.filter === id ? 'active' : ''}">${l}</button>`).join('');
    document.querySelectorAll('[data-lf]').forEach((b) => { b.onclick = () => { S.lg.filter = b.dataset.lf; renderLeagueList(); }; });
    const list = S.lg.games.filter((g) => (S.lg.filter === 'all' ? true : S.lg.filter === 'live' ? lgLive(g) : g.leagueId === S.lg.filter));
    $('leagueList').innerHTML = list.length ? list.map((g) => `<div class="league-row ${S.lg.selected === g.id ? 'selected' : ''}" data-lg="${esc(g.id)}">
      <div><div class="t">${esc(g.away.abbrev || g.away.shortName || g.away.name)} @ ${esc(g.home.abbrev || g.home.shortName || g.home.name)}</div>
      <div class="s">${esc(g.leagueAbbrev || '')} · ${lgLive(g) ? `${esc(g.periodText || '')} ${esc(g.clock || '')}` : g.status === 'final' ? 'Final' : hhmm(g.date)}${g.fdTotal ? ` · FD ${g.fdTotal.line}` : ''}</div></div>
      <div class="gc-score">${g.status === 'scheduled' ? '' : `${g.away.score}-${g.home.score}`}</div></div>`).join('') : '<p class="muted small">No games for this filter.</p>';
    document.querySelectorAll('[data-lg]').forEach((r) => { r.onclick = () => selectLeagueGame(r.dataset.lg); });
  }

  async function loadLeagues() {
    try {
      const d = await api('/api/games');
      S.lg.games = d.games || [];
      if (S.lg.filter === 'live' && !S.lg.games.some(lgLive)) S.lg.filter = 'all';
      renderLeagueList();
      if (S.lg.selected) selectLeagueGame(S.lg.selected, true);
    } catch (err) {
      $('leagueList').innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    }
  }

  async function selectLeagueGame(id, quiet = false) {
    S.lg.selected = id;
    if (!quiet) renderLeagueList();
    const saved = store.get(`fd-lines:${id}`, {});
    const listRow = S.lg.games.find((g) => g.id === id);
    try {
      const d = await api(`/api/games/${encodeURIComponent(id)}`);
      const g = d.game;
      const s = d.snapshot;
      const autoLine = saved.gameTotal || listRow?.fdTotal?.line || '';
      $('leagueDetail').innerHTML = `
        <div class="section-head compact"><div><p class="eyebrow">${esc(d.league.name)}</p><h2>${esc(g.away.name)} ${g.away.score} @ ${esc(g.home.name)} ${g.home.score}</h2></div><span class="chip">${esc(g.periodText || '')} ${esc(g.clock || '')}</span></div>
        <div class="gc-nums">
          <div class="kv"><div class="k">Pace /${s.regulationMinutes}</div><div class="v">${s.pace}</div></div>
          <div class="kv"><div class="k">PPP</div><div class="v">${s.ppp}</div></div>
          <div class="kv"><div class="k">Fair total</div><div class="v">${s.fairGameTotal}</div></div>
        </div>
        <form id="lgForm" class="league-lines">
          <label>Game total ${listRow?.fdTotal ? '(FanDuel live)' : ''}<input id="lgGame" inputmode="decimal" value="${esc(autoLine)}" placeholder="line" /></label>
          <label>Quarter / period<input id="lgQ" inputmode="decimal" value="${esc(saved.quarterTotal || '')}" /></label>
          <label>1st half<input id="lgH" inputmode="decimal" value="${esc(saved.halfTotal || '')}" /></label>
          <label>${esc(g.away.abbrev || 'Away')} team<input id="lgA" inputmode="decimal" value="${esc(saved.awayTotal || '')}" /></label>
          <label>${esc(g.home.abbrev || 'Home')} team<input id="lgHm" inputmode="decimal" value="${esc(saved.homeTotal || '')}" /></label>
          <button class="primary-button" type="submit">Evaluate</button>
        </form>
        <div id="lgOut"><p class="why">Source: ${esc(s.source)} · ${s.elapsed} min played · ${s.remaining} left.</p></div>`;
      $('lgForm').onsubmit = async (e) => {
        e.preventDefault();
        const lines = { gameTotal: $('lgGame').value, quarterTotal: $('lgQ').value, halfTotal: $('lgH').value, awayTotal: $('lgA').value, homeTotal: $('lgHm').value };
        store.set(`fd-lines:${id}`, lines);
        try {
          const r = await api('/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId: id, lines }) });
          $('lgOut').innerHTML = `<div class="market-grid">${r.advice.markets.map((m) => `<article class="panel market ${m.call === 'Over' || m.call === 'Under' ? `call-${callCls(m.call)}` : ''}"><div class="market-head"><h3>${esc(m.label)}</h3><span class="verdict ${callCls(m.call)}">${(m.call || 'PASS').toUpperCase()}</span></div>
            <div class="gc-nums"><div class="kv"><div class="k">Line</div><div class="v">${m.line ?? '—'}</div></div><div class="kv"><div class="k">Fair</div><div class="v">${m.fair ?? '—'}</div></div><div class="kv"><div class="k">Edge</div><div class="v">${sign(m.edge)}</div></div></div>
            <p class="why">${esc(m.reason || `Confidence ${m.confidence}`)}</p></article>`).join('')}</div>
            <p class="why">${esc(r.advice.why)}</p><p class="why">${esc((r.advice.risks || []).join(' · '))}</p>`;
        } catch (err) {
          $('lgOut').innerHTML = `<p class="muted">${esc(err.message)}</p>`;
        }
      };
      if (autoLine) $('lgForm').requestSubmit();
    } catch (err) {
      $('leagueDetail').innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    }
  }

  // ---------- settings / polling / PWA ----------
  function openSettings() {
    $('setEdge').value = S.settings.edge;
    $('setEv').value = S.settings.ev;
    $('setPoll').value = S.settings.poll;
    $('settings').showModal();
  }

  function saveSettings() {
    const edge = Number($('setEdge').value);
    const ev = Number($('setEv').value);
    const poll = Number($('setPoll').value);
    S.settings = {
      edge: Number.isFinite(edge) && edge > 0 ? edge : 4,
      ev: Number.isFinite(ev) && ev >= 0 ? ev : 3,
      poll: Number.isFinite(poll) && poll >= 4 ? poll : 8,
    };
    store.set('cs.settings', S.settings);
    startPolling();
    loadBoard(true);
    if (S.view === 'game') loadDetail();
  }

  function startPolling() {
    S.timers.forEach(clearInterval);
    S.timers = [];
    const ms = Math.max(4, S.settings.poll) * 1000;
    S.timers.push(setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadBoard(false);
      if (S.view === 'game' && S.selected) loadDetail();
    }, ms));
    S.timers.push(setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (S.view === 'leagues') loadLeagues();
      if (S.view === 'results') loadPerformance();
    }, 30000));
  }

  let deferredPrompt = null;
  function setupPwa() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      $('installBtn').classList.remove('hidden');
    });
    $('installBtn').onclick = async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => null);
      deferredPrompt = null;
      $('installBtn').classList.add('hidden');
    };
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;
    if (ios && !store.get('cs.iosHint', false)) {
      $('iosHint').classList.remove('hidden');
      setTimeout(() => $('iosHint').classList.add('hidden'), 9000);
      store.set('cs.iosHint', true);
    }
  }

  function bind() {
    document.querySelectorAll('.tabs [data-view], .bottom-nav [data-view]').forEach((b) => { b.onclick = () => setView(b.dataset.view); });
    $('refreshBtn').onclick = () => { loadBoard(true); if (S.view === 'game') loadDetail(); if (S.view === 'results') loadPerformance(); if (S.view === 'leagues') loadLeagues(); };
    $('settingsBtn').onclick = openSettings;
    $('saveSettings').onclick = () => saveSettings();
    $('labForm').onsubmit = (e) => { e.preventDefault(); runLab(); };
    $('playerSearch').oninput = renderPlayers;
    document.querySelectorAll('#playerSort button').forEach((b) => {
      b.onclick = () => {
        S.playerSort = b.dataset.sort;
        document.querySelectorAll('#playerSort button').forEach((x) => x.classList.toggle('active', x === b));
        renderPlayers();
      };
    });
    document.querySelectorAll('#daysSeg button').forEach((b) => {
      b.onclick = () => {
        S.perfDays = Number(b.dataset.days);
        document.querySelectorAll('#daysSeg button').forEach((x) => x.classList.toggle('active', x === b));
        loadPerformance();
      };
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadBoard(false); });
  }

  bind();
  setupPwa();
  setView(S.view);
  loadBoard(false);
  startPolling();
})();
