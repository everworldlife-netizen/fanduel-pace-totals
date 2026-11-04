/* CourtSide Pace — FanDuel eBasketball live totals (H2H GG League 4x5) */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  const S = {
    view: store.get('cs.view', 'board'),
    board: null,
    boardAt: 0,
    boardFilter: 'all',
    selected: store.get('cs.selected', null),
    detail: null,
    market: 'game',
    settings: { edge: 4, ev: 3, poll: 8, ...store.get('cs.settings', {}) },
    qTrack: {},
    players: null,
    playerSort: 'n',
    perfDays: 7,
    lg: { games: [], filter: 'live', selected: null },
    timers: [],
    loadingBoard: false,
  };

  // ---------- memo for animations ----------
  const memo = new Map();
  const seen = new Set();

  // ---------- formatting ----------
  const isNum = (v) => v != null && Number.isFinite(Number(v));
  const n1 = (v) => (isNum(v) ? (Math.round(Number(v) * 10) / 10).toFixed(1) : '—');
  const sign = (v) => (isNum(v) ? `${v > 0 ? '+' : ''}${n1(v)}` : '—');
  const odds = (o) => (o == null ? '' : o > 0 ? `+${o}` : `${o}`);
  const pct = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`);
  const evPct = (e) => (e == null ? '—' : `${e > 0 ? '+' : ''}${Math.round(e * 1000) / 10}%`);
  const hhmm = (ms) => { try { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
  const cls = (c) => (c === 'Over' ? 'over' : c === 'Under' ? 'under' : '');
  const isCall = (m) => m && (m.call === 'Over' || m.call === 'Under');
  const haptic = () => { try { navigator.vibrate && navigator.vibrate(8); } catch { /* ignore */ } };

  function hue(name) {
    let h = 0;
    for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }
  function avatar(name, size = '') {
    const txt = String(name || '?').replace(/[^A-Z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';
    return `<span class="avatar ${size}" style="--h:${hue(name)}">${esc(txt)}</span>`;
  }

  function toast(msg, ms = 3600) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
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
  const qparams = () => `edge=${encodeURIComponent(S.settings.edge)}&ev=${encodeURIComponent(S.settings.ev / 100)}`;

  // ---------- reusable HUD pieces ----------
  const RING_C = 2 * Math.PI * 19;
  function ring(key, f, label, pre = false) {
    const target = RING_C * (1 - Math.max(0, Math.min(1, f || 0)));
    const prev = memo.has(key) ? memo.get(key) : RING_C;
    const ticks = [0.25, 0.5, 0.75].map((t) => {
      const a = t * 2 * Math.PI;
      return `<line class="tick" x1="${24 + 15 * Math.cos(a)}" y1="${24 + 15 * Math.sin(a)}" x2="${24 + 23 * Math.cos(a)}" y2="${24 + 23 * Math.sin(a)}"/>`;
    }).join('');
    return `<div class="ring ${pre ? 'pre' : ''}"><svg viewBox="0 0 48 48"><circle class="trk" cx="24" cy="24" r="19"/><circle class="bar" cx="24" cy="24" r="19" stroke-dasharray="${RING_C}" style="stroke-dashoffset:${prev}" data-anim="${key}" data-prop="dash" data-to="${target}"/>${ticks}</svg><b>${esc(label)}</b></div>`;
  }

  function strength(m) {
    if (!isCall(m)) return 0;
    const g = Math.abs(m.gap || 0) / Math.max(1, S.settings.edge);
    const e = Math.max(0, m.ev || 0);
    return Math.max(1, Math.min(5, Math.round(g * 2 + e * 8)));
  }
  function meter(m) {
    const s = strength(m);
    return `<span class="meter ${cls(m?.call)}" title="Signal strength ${s}/5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= s ? 'on' : ''}"></i>`).join('')}</span>`;
  }

  function gapbar(key, gap) {
    if (!isNum(gap)) return '<div class="gapbar"><span class="mid"></span></div>';
    const span = 16;
    const g = Math.max(-span, Math.min(span, gap));
    const w = (Math.abs(g) / span) * 50;
    const left = g >= 0 ? 50 : 50 - w;
    const th = (S.settings.edge / span) * 50;
    const prev = memo.get(key) || { left: 50, width: 0 };
    return `<div class="gapbar"><span class="th" style="left:${50 + th}%"></span><span class="th" style="left:${50 - th}%"></span><span class="fill ${g >= 0 ? 'over' : 'under'}" style="left:${prev.left}%;width:${prev.width}%" data-anim="${key}" data-prop="bar" data-left="${left}" data-width="${w}"></span><span class="mid"></span></div>`;
  }

  function tween(key, value, dec = 1) {
    if (!isNum(value)) return '—';
    const prev = memo.get(key);
    const start = isNum(prev) ? prev : value;
    return `<span class="tw" data-tw="${key}" data-v="${value}" data-d="${dec}">${Number(start).toFixed(dec)}</span>`;
  }

  function scoreSpan(key, v) {
    const prev = memo.get(key);
    const bump = isNum(prev) && prev !== v ? ' bump' : '';
    memo.set(key, v);
    return `<span class="score${bump}">${v}</span>`;
  }

  function animate(root) {
    requestAnimationFrame(() => {
      root.querySelectorAll('[data-anim]').forEach((el) => {
        const key = el.dataset.anim;
        if (el.dataset.prop === 'dash') {
          const to = Number(el.dataset.to);
          el.style.strokeDashoffset = to;
          memo.set(key, to);
        } else if (el.dataset.prop === 'bar') {
          el.style.left = `${el.dataset.left}%`;
          el.style.width = `${el.dataset.width}%`;
          memo.set(key, { left: Number(el.dataset.left), width: Number(el.dataset.width) });
        } else if (el.dataset.prop === 'left') {
          el.style.left = `${el.dataset.to}%`;
          memo.set(key, Number(el.dataset.to));
        }
      });
      root.querySelectorAll('[data-tw]').forEach((el) => {
        const key = el.dataset.tw;
        const to = Number(el.dataset.v);
        const dec = Number(el.dataset.d);
        const from = Number(el.textContent);
        memo.set(key, to);
        if (reduceMotion || !Number.isFinite(from) || from === to) {
          el.textContent = to.toFixed(dec);
          return;
        }
        const t0 = performance.now();
        const dur = 700;
        const step = (t) => {
          const k = Math.min(1, (t - t0) / dur);
          const e = 1 - Math.pow(1 - k, 3);
          el.textContent = (from + (to - from) * e).toFixed(dec);
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    });
  }

  function enterCls(key) {
    if (seen.has(key)) return '';
    seen.add(key);
    return ' enter';
  }

  function friendly(m, f = 0) {
    if (!m) return '';
    if (isCall(m)) {
      const dir = m.call === 'Over' ? 'above' : 'below';
      return `We see <b>${n1(m.mean)}</b> — ${Math.abs(m.gap).toFixed(1)} pts ${dir} FanDuel. Blended chance it goes ${m.call.toLowerCase()}: <b>${pct(m.call === 'Over' ? m.pOver : 1 - m.pOver)}</b>.`;
    }
    const r = m.reason || '';
    if (m.line == null) return 'FanDuel hasn’t posted this line yet.';
    if (/suspended/i.test(r)) return 'FanDuel has this market paused right now — check back in a moment.';
    if (/Gap under/i.test(r)) return `Too close to call: our ${n1(m.mean)} vs ${m.line} is only ${sign(m.gap)}.`;
    if (/Price/i.test(r)) return `There’s a ${sign(m.gap)} gap, but the price takes away the value.`;
    if (/Low confidence/i.test(r)) return 'Gap is there, but confidence is too low to trust it.';
    if (/early|late/i.test(r)) return f > 0.8 ? 'Too late in the game for a reliable call.' : 'Too early for this market.';
    if (/quarter start/i.test(r)) return 'Keep this game open through the next quarter break and we’ll track the quarter live.';
    return esc(r || 'No edge right now.');
  }

  function quarterLabel(ev, status) {
    if (status === 'pre' || status === 'scheduled') return 'PRE';
    if (ev?.progress?.overtime) return 'OT';
    const f = ev?.progress?.f || 0;
    if (f >= 0.999) return 'END';
    return `Q${Math.min(4, Math.floor(f * 4) + 1)}`;
  }

  // ---------- views + nav ink ----------
  function moveInk() {
    const place = (container, ink) => {
      const btn = container && container.querySelector('button.active');
      if (!btn || !ink) return;
      ink.style.left = `${btn.offsetLeft}px`;
      ink.style.width = `${btn.offsetWidth}px`;
    };
    place($('bottomNav'), $('navInk'));
    place($('tabs'), $('tabInk'));
  }

  function setView(v) {
    S.view = v;
    store.set('cs.view', v);
    document.querySelectorAll('.view').forEach((el) => {
      const on = el.dataset.view === v;
      el.classList.toggle('hidden', !on);
      if (on) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
    });
    document.querySelectorAll('.tabs [data-view], .bottom-nav [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    moveInk();
    window.scrollTo({ top: 0 });
    if (v === 'board') renderBoard();
    if (v === 'game') loadDetail();
    if (v === 'lab') loadPlayers();
    if (v === 'results') loadPerformance();
    if (v === 'leagues') loadLeagues();
  }

  // ---------- board ----------
  function pickCard(p) {
    const m = p.market;
    return `<article class="pick ${cls(m.call)}${enterCls(`pick:${p.eventId}:${m.id}`)}" data-event="${esc(p.eventId)}">
      <div class="pick-top">${avatar(p.away.player, 'sm')}<div class="pick-vs"><b>${esc(p.away.player)} vs ${esc(p.home.player)}</b><span>${p.status === 'live' ? 'Live now' : 'Pre-game'} · ${esc(m.label)}</span></div>${meter(m)}</div>
      <div class="pick-call"><div><div class="mk">The call</div><div class="big">${m.call.toUpperCase()} ${m.line}</div></div>
        <div style="text-align:right"><div class="mk">Gap</div><div class="big" style="font-size:22px">${sign(m.gap)}</div></div></div>
      <p class="pick-say">${friendly(m)} ${odds(m.call === 'Over' ? m.overOdds : m.underOdds)}</p>
    </article>`;
  }

  function matchCard(g) {
    const ev = g.eval;
    const gm = ev.markets.find((m) => m.id === 'game') || {};
    const best = ev.best;
    const show = best || gm;
    const live = g.status === 'live';
    const call = isCall(show) ? show.call : null;
    const key = `m:${g.eventId}`;
    const sel = S.selected === g.eventId ? ' selected' : '';
    return `<article class="card match ${call ? `call-${cls(call)}` : ''}${sel}${enterCls(key)}" data-event="${esc(g.eventId)}">
      <div class="vs-row">
        <div class="side">${avatar(g.away.player)}<div class="nm"><b>${esc(g.away.player)}</b><span>${esc(g.away.team)}</span></div></div>
        <div class="center-hud">
          ${live ? `<div class="scoreline">${scoreSpan(`${key}:a`, g.away.score)}<span class="c">:</span>${scoreSpan(`${key}:h`, g.home.score)}</div>` : `<div class="scoreline" style="font-size:16px;color:var(--yellow)">${hhmm(g.tipMs || g.scheduledMs)}</div>`}
          <span class="status-tag ${live ? 'live' : ''}">${live ? `● LIVE · ${quarterLabel(ev, g.status)} ${Math.round(ev.progress.f * 100)}%` : 'TIP-OFF'}</span>
        </div>
        <div class="side right">${avatar(g.home.player)}<div class="nm"><b>${esc(g.home.player)}</b><span>${esc(g.home.team)}</span></div></div>
      </div>
      <div class="stat3">
        <div class="tile"><div class="k">FanDuel</div><div class="v">${gm.line ?? '—'}<small>${gm.line != null ? odds(gm.overOdds) : ''}</small></div></div>
        <div class="tile hl"><div class="k">Our proj</div><div class="v">${tween(`${key}:p`, gm.mean)}</div></div>
        <div class="tile"><div class="k">Gap</div><div class="v ${gm.gap > 0 ? 'pos' : gm.gap < 0 ? 'neg' : ''}">${sign(gm.gap)}</div></div>
      </div>
      ${gapbar(`${key}:gb`, gm.gap)}
      <div class="match-foot">
        <span class="verdict ${cls(call)}">${call ? `${call} ${show.line}` : 'Pass'}</span>
        <span class="say">${call && show.id !== 'game' ? `${esc(show.label)} · ` : ''}${call ? `EV ${evPct(show.ev)}` : friendly(gm, ev.progress.f).replace(/<[^>]+>/g, '')}</span>
        ${live ? ring(`${key}:r`, ev.progress.f, quarterLabel(ev, g.status)) : ''}
      </div>
    </article>`;
  }

  function upRow(u) {
    const ev = u.eval;
    const h1 = ev.markets.find((m) => m.id === 'half1');
    const l10 = h1?.last10;
    const mins = Math.max(0, Math.round((u.scheduledMs - Date.now()) / 60000));
    const pair = ev.pregame.pair;
    return `<div class="up${enterCls(`u:${u.id}`)}" data-lab="${esc(u.away.player)}|${esc(u.home.player)}">
      <div class="when"><b>${mins ? `${mins}m` : 'NOW'}</b><span>${hhmm(u.scheduledMs)}</span></div>
      <div class="who"><b>${esc(u.away.player)} <span class="muted">vs</span> ${esc(u.home.player)}</b><span>${pair && pair.n >= 3 ? `H2H ${pair.n}× · avg ${n1(pair.avgTotal)}` : esc(u.stream || '')}</span></div>
      <div class="nums">
        <div><b>${n1(ev.pregame.expected)}</b><span>TOTAL</span></div>
        <div><b>${n1(h1?.mean)}</b><span>1H</span></div>
        <div><b class="muted">${l10 ? n1(l10.avg) : '—'}</b><span>L10 1H</span></div>
      </div>
    </div>`;
  }

  function renderBoard() {
    const b = S.board;
    if (!b) return;
    let live = b.live || [];
    $('liveCount').textContent = live.length;
    $('upCount').textContent = (b.upcoming || []).length;
    if (S.boardFilter === 'calls') live = live.filter((g) => g.eval.best);
    if (S.boardFilter === 'live') live = live.filter((g) => g.status === 'live');
    const rail = $('picks');
    const scroll = rail.scrollLeft;
    rail.innerHTML = (b.picks || []).length
      ? b.picks.map(pickCard).join('')
      : `<div class="pick-empty">No game clears your <b>${S.settings.edge}-pt gap</b> + value filter right now.<br>Volume works for you — the next game tips in a few minutes.</div>`;
    rail.scrollLeft = scroll;
    $('liveList').innerHTML = live.length
      ? live.map(matchCard).join('')
      : `<div class="empty-line">${S.boardFilter === 'calls' ? 'No calls on the live board right now.' : 'No eBasketball games on FanDuel’s in-play board right now.'}</div>`;
    $('upList').innerHTML = (b.upcoming || []).length ? b.upcoming.slice(0, 12).map(upRow).join('') : '<div class="empty-line">Schedule loading or nothing in the next 75 minutes.</div>';
    const m = b.model || {};
    $('modelNote').textContent = `Model: ${m.players || 0} gamers rated from ${m.games || 0} official H2H finals (${m.quarterGames || 0} with quarter splits) · trust ${Math.round((m.modelWeight ?? 0.35) * 100)}% ours / ${100 - Math.round((m.modelWeight ?? 0.35) * 100)}% FanDuel · built ${m.builtAt ? new Date(m.builtAt).toLocaleString() : '—'}.`;
    document.querySelectorAll('#view-board [data-event]').forEach((el) => { el.onclick = () => { haptic(); selectGame(el.dataset.event); }; });
    document.querySelectorAll('#view-board [data-lab]').forEach((el) => {
      el.onclick = () => {
        haptic();
        const [a, bb] = el.dataset.lab.split('|');
        $('labA').value = a;
        $('labB').value = bb;
        setView('lab');
        runLab();
      };
    });
    animate($('view-board'));
  }

  async function loadBoard(manual = false) {
    if (S.loadingBoard) return;
    S.loadingBoard = true;
    if (manual) $('refreshBtn').classList.add('spin');
    try {
      S.board = await api(`/api/eb/board?${qparams()}`);
      S.boardAt = Date.now();
      const n = (S.board.live || []).length;
      $('feedBadge').className = 'live-pill';
      $('feedBadge').querySelector('b').textContent = `${n} LIVE`;
      if (S.view === 'board') renderBoard();
    } catch (err) {
      $('feedBadge').className = 'live-pill bad';
      $('feedBadge').querySelector('b').textContent = 'OFFLINE';
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
    S.market = 'game';
    setView('game');
  }

  function trackQuarter(d) {
    const id = d.game.eventId;
    const hint = d.game.lines?.quarterHint || null;
    const now = Date.now();
    const t = S.qTrack[id] || { lastHint: undefined, lastT: 0, starts: {} };
    if (hint && hint !== t.lastHint && t.lastT && now - t.lastT < 30000 && t.starts[hint] == null) t.starts[hint] = d.game.total;
    t.lastHint = hint;
    t.lastT = now;
    S.qTrack[id] = t;
  }
  function qsParam(id) {
    const t = S.qTrack[id];
    if (!t) return '';
    const q = Object.keys(t.starts).map(Number).sort((a, b) => b - a)[0];
    return q ? `&qs=${q}:${t.starts[q]}` : '';
  }

  function gauge(key, mean, line) {
    if (!isNum(mean) || !isNum(line)) return '';
    const span = Math.max(12, Math.abs(mean - line) * 1.6);
    const pos = (v) => Math.max(4, Math.min(96, 50 + ((v - line) / span) * 50));
    const p = pos(mean);
    const labelPos = p < 30 || p > 70 ? p : p > 50 ? 78 : 22;
    const prev = memo.has(`${key}:o`) ? memo.get(`${key}:o`) : 50;
    const prevL = memo.has(`${key}:ol`) ? memo.get(`${key}:ol`) : 50;
    return `<div class="gauge"><div class="gauge-track">
        <span class="gauge-mark line" style="left:50%"></span>
        <span class="gauge-mark ours" style="left:${prev}%" data-anim="${key}:o" data-prop="left" data-to="${p}"></span>
      </div>
      <div class="gauge-labels">
        <span class="l" style="left:50%"><b>${line}</b>FANDUEL</span>
        <span class="o" style="left:${prevL}%" data-anim="${key}:ol" data-prop="left" data-to="${labelPos}"><b>${n1(mean)}</b>OURS</span>
      </div></div>`;
  }

  function marketPanel(m, ev) {
    const call = isCall(m) ? m.call : null;
    const tiles = m.mean == null && m.full != null
      ? `<div class="tile"><div class="k">FanDuel</div><div class="v">${m.line ?? '—'}</div></div><div class="tile hl"><div class="k">Full Q exp</div><div class="v">${n1(m.full)}</div></div><div class="tile"><div class="k">So far</div><div class="v">—</div></div>`
      : `<div class="tile"><div class="k">FanDuel</div><div class="v">${m.line ?? '—'}<small>${m.line != null ? odds(m.overOdds) : ''}</small></div></div>
         <div class="tile hl"><div class="k">Ours</div><div class="v">${tween(`mk:${S.selected}:${m.id}`, m.mean)}</div></div>
         <div class="tile"><div class="k">Gap</div><div class="v ${m.gap > 0 ? 'pos' : m.gap < 0 ? 'neg' : ''}">${sign(m.gap)}</div></div>`;
    const extras = [];
    if (m.last10) {
      const g10 = m.line != null ? m.last10.avg - m.line : null;
      const agree = g10 != null && m.gap != null && Math.sign(g10) === Math.sign(m.gap) && Math.abs(g10) >= 2;
      extras.push(`<div class="tip">📋 <b>Last-10 1H check:</b> ${esc(m.last10.away)} + ${esc(m.last10.home)} → <b>${n1(m.last10.avg)}</b>${g10 != null ? ` (gap ${sign(g10)}) — ${agree ? 'agrees with the model ✅' : 'doesn’t confirm'}` : ''}</div>`);
    }
    if (m.id.startsWith('q') && m.soFar != null) extras.push(`<div class="tip">Quarter points so far: <b>${m.soFar}</b>. ${esc(m.note || '')}</div>`);
    else if (m.id.startsWith('q') && m.note) extras.push(`<div class="tip">${esc(m.note)}</div>`);
    return `<article class="card market ${call ? `call-${cls(call)}` : ''}">
      <div class="market-top"><h3>${esc(m.label)}</h3><span class="verdict ${cls(call)}">${call ? `${call} ${m.line}` : 'Pass'}</span></div>
      <div class="stat3">${tiles}</div>
      ${gapbar(`mk:${S.selected}:${m.id}:gb`, m.gap)}
      <p class="say">${friendly(m, ev.progress.f)}</p>
      ${extras.join('')}
      ${m.line != null ? `<details class="fine"><summary>Price details</summary><div class="fine-grid">
        <span>Over / Under</span><b>${odds(m.overOdds)} / ${odds(m.underOdds)}</b>
        <span>FanDuel no-vig over</span><b>${pct(m.fdOver)}</b>
        <span>Our blended over</span><b>${pct(m.pOver)}</b>
        <span>Blended fair number</span><b>${n1(m.fair)}</b>
        <span>EV over / under</span><b>${evPct(m.evOver)} / ${evPct(m.evUnder)}</b>
        <span>Spread of outcomes</span><b>± ${n1(m.sd)}</b>
      </div></details>` : ''}
    </article>`;
  }

  function gamerCard(card, side) {
    const r = card.rating;
    const p = card.profile;
    const max = p ? Math.max(...p.qFor, 1) : 1;
    const bars = p
      ? `<div class="qbars">${p.qFor.map((v, i) => `<div class="${p.bestQuarter === i + 1 ? 'best' : ''}" style="height:${Math.max(10, (v / max) * 100)}%"><span>${v}</span></div>`).join('')}</div><div class="qlabels"><span>Q1</span><span>Q2</span><span>Q3</span><span>Q4</span></div>`
      : '<p class="muted small">Quarter profile builds as more play-by-play comes in.</p>';
    const recent = (card.recent || []).slice(0, 6).map((g) => `<tr><td>${esc(g.opp)}</td><td>${g.for}-${g.against}</td><td>${g.total}</td></tr>`).join('');
    return `<article class="card pad">
      <div class="gamer-head">${avatar(card.player, 'lg')}<div><p class="eyebrow">${side}</p><h2>${esc(card.player)}</h2></div><span class="chip hot" style="margin-left:auto">${r ? `${r.n} games` : 'new'}</span></div>
      <div class="stat3">
        <div class="tile"><div class="k">Scores</div><div class="v">${r ? n1(r.avgFor) : '—'}</div></div>
        <div class="tile"><div class="k">Allows</div><div class="v">${r ? n1(r.avgAgainst) : '—'}</div></div>
        <div class="tile hl"><div class="k">L10 1H</div><div class="v">${p ? n1(p.last10Half.avg) : '—'}</div></div>
      </div>
      <p class="section-title">Points by quarter ${p ? `· strongest Q${p.bestQuarter}` : ''}</p>
      ${bars}
      ${recent ? `<table class="tbl"><thead><tr><th>Last vs</th><th>Score</th><th>Total</th></tr></thead><tbody>${recent}</tbody></table>` : ''}
    </article>`;
  }

  function renderDetail() {
    const d = S.detail;
    if (!d) return;
    $('gameEmpty').classList.add('hidden');
    $('gameDetail').classList.remove('hidden');
    const g = d.game;
    const ev = d.eval;
    const live = g.status === 'live';
    const key = `d:${g.eventId}`;
    const markets = ev.markets.filter((m) => !/Total$/.test(m.id) || m.line != null);
    if (!markets.some((m) => m.id === S.market)) S.market = 'game';
    const gm = markets.find((m) => m.id === 'game') || {};
    $('scoreHero').innerHTML = `
      <div class="vs-row">
        <div class="side">${avatar(g.away.player, 'lg')}<div class="nm"><b>${esc(g.away.player)}</b><span>${esc(g.away.team)}</span></div></div>
        <div class="center-hud">
          <div class="scoreline">${scoreSpan(`${key}:a`, g.away.score)}<span class="c">:</span>${scoreSpan(`${key}:h`, g.home.score)}</div>
          ${ring(`${key}:r`, ev.progress.f, live ? quarterLabel(ev, g.status) : 'PRE', !live)}
          <span class="status-tag ${live ? 'live' : ''}">${live ? `● LIVE · ${Math.round(ev.progress.f * 100)}% played` : `TIP ${hhmm(g.tipMs || g.scheduledMs)}`}</span>
        </div>
        <div class="side right">${avatar(g.home.player, 'lg')}<div class="nm"><b>${esc(g.home.player)}</b><span>${esc(g.home.team)}</span></div></div>
      </div>
      ${gauge(`${key}:g`, gm.mean, gm.line)}`;
    const best = ev.best;
    $('callHero').innerHTML = best
      ? `<div class="call-hero ${cls(best.call)}"><div><div class="mk">The call · ${esc(best.label)}</div><div class="big">${best.call.toUpperCase()} ${best.line}</div></div>${meter(best)}<p>${friendly(best, ev.progress.f)} Price ${odds(best.call === 'Over' ? best.overOdds : best.underOdds)} · EV ${evPct(best.ev)}.</p></div>`
      : `<div class="call-hero"><div><div class="mk">The call</div><div class="big" style="color:var(--muted)">NO PLAY</div></div>${meter(null)}<p>${friendly(gm, ev.progress.f)} We’ll flag it the moment a market clears your ${S.settings.edge}-pt gap.</p></div>`;
    $('marketTabs').innerHTML = markets.map((m) => `<button type="button" data-mk="${m.id}" class="${m.id === S.market ? 'active' : ''}">${esc(m.label.replace(' total', '').replace('team ', ''))}${isCall(m) ? ' ●' : ''}</button>`).join('');
    document.querySelectorAll('#marketTabs [data-mk]').forEach((b) => {
      b.onclick = () => { haptic(); S.market = b.dataset.mk; renderDetail(); };
    });
    $('marketPanel').innerHTML = marketPanel(markets.find((m) => m.id === S.market) || gm, ev);
    const pre = ev.pregame;
    const notes = (ev.confidence.notes || []).map((x) => `<li>${esc(x)}</li>`).join('');
    const mw = Math.round((ev.modelWeight ?? 0.35) * 100);
    $('whyCard').innerHTML = `
      <div class="hud-head tight"><div><p class="eyebrow">MODEL INPUTS</p><h2>Why this number</h2></div><span class="chip ${ev.confidence.level === 'HIGH' ? 'hot' : ev.confidence.level === 'LOW' ? 'warn' : ''}">${ev.confidence.level} · ${ev.confidence.score}</span></div>
      <div class="row"><span>Pregame number</span><b>${n1(pre.expected)}</b></div>
      <div class="row"><span>Built from</span><b>${esc(pre.blendNote)}</b></div>
      <div class="row"><span>Ratings split</span><b>${n1(pre.away)} + ${n1(pre.home)}</b></div>
      <div class="row"><span>FanDuel opener</span><b>${g.opening ?? '—'}</b></div>
      <div class="row"><span>Live pace (per game)</span><b>${n1(ev.rate.pacePer20)}</b></div>
      <div class="row"><span>Blended pace</span><b>${n1(ev.rate.total)}</b></div>
      <div class="row"><span>Game clock</span><b>${Math.round(ev.progress.f * 100)}% · ${ev.progress.minutes}m since tip</b></div>
      <div class="row"><span>Clock check</span><b>${esc({ 'market-confirmed': 'FanDuel quarter markets ✓', 'market-corrected': 'Corrected by quarter markets', 'quarter-confirmed': 'Quarter ✓', 'quarter-corrected': 'Corrected by quarter', 'clock-estimate': 'Tip time', 'score-estimate': 'Score (tip time not posted)', overtime: 'Overtime', pregame: 'Pregame' }[ev.progress.source] || ev.progress.source)}${ev.progress.window ? ` · ${esc(ev.progress.window)}` : ''}</b></div>
      <div class="row"><span>Trust ours vs FanDuel</span><b>${mw}% / ${100 - mw}%</b></div>
      <div class="tip">In this league the pregame number is worth ~1.5 games of live scoring — hot or cold starts move the projection less than you’d think.</div>
      ${notes ? `<ul class="notes">${notes}</ul>` : ''}`;
    const h = d.h2h;
    const rows = (h.games || []).map((x) => `<tr><td>${new Date(x.t).toLocaleDateString([], { month: 'short', day: 'numeric' })}</td><td>${x.a}-${x.b}</td><td>${x.total}</td></tr>`).join('');
    $('h2hCard').innerHTML = `
      <div class="hud-head tight"><div><p class="eyebrow">HEAD TO HEAD</p><h2>${esc(g.away.player)} vs ${esc(g.home.player)}</h2></div><span class="chip hot">${h.meetings} games</span></div>
      ${h.meetings ? `<div class="stat3"><div class="tile"><div class="k">Avg total</div><div class="v">${n1(h.avgTotal)}</div></div><div class="tile"><div class="k">Model adj</div><div class="v">${pre.pair ? sign(pre.pair.adj) : '—'}</div></div><div class="tile"><div class="k">Used</div><div class="v">${h.meetings >= 3 ? 'YES' : 'NO'}</div></div></div>
      <table class="tbl"><thead><tr><th>Date</th><th>${esc(g.away.player)}-${esc(g.home.player)}</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tip">3+ meetings get a small, shrunk adjustment — raw head-to-head averages overfit in our backtests.</div>` : '<p class="muted small">No meetings in the last 4 weeks.</p>'}`;
    $('gamerCards').innerHTML = gamerCard(d.gamers.away, 'AWAY') + gamerCard(d.gamers.home, 'HOME');
    animate($('view-game'));
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
      if (S.view === 'game') renderDetail();
    } catch (err) {
      if (err.status === 404) {
        toast('That game just finished — it shows up in Results once it’s graded.');
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
    $('playerTable').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
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
    const mu = (S.players.mu || 55) * 2;
    let list = S.players.players.filter((p) => !q || p.name.includes(q));
    const k = S.playerSort;
    if (k === 'low') list = list.slice().sort((a, b) => a.vsAvgTotal - b.vsAvgTotal);
    else if (k === 'n') list = list.slice().sort((a, b) => b.n - a.n);
    else list = list.slice().sort((a, b) => (b[k] ?? -1) - (a[k] ?? -1));
    $('playerTable').innerHTML = list.slice(0, 80).map((p) => {
      const d = p.vsAvgTotal - mu;
      const pace = d > 4 ? ['fast', 'SHOOTOUT'] : d < -4 ? ['slow', 'GRINDER'] : ['mid', 'NEUTRAL'];
      return `<div class="gamer-row" data-player="${esc(p.name)}">${avatar(p.name, 'sm')}
        <div><b>${esc(p.name)}</b><div class="meta">${p.n} games · ${n1(p.avgFor)}–${n1(p.avgAgainst)}${p.bestQuarter ? ` · best Q${p.bestQuarter}` : ''}</div></div>
        <span class="pace-pill ${pace[0]}">${pace[1]}</span>
        <div class="val">${n1(p.vsAvgTotal)}<span>TOTAL</span></div></div>`;
    }).join('') || '<p class="muted small">No gamer matches that search.</p>';
    document.querySelectorAll('[data-player]').forEach((row) => {
      row.onclick = () => {
        haptic();
        const target = !$('labA').value ? 'labA' : (!$('labB').value ? 'labB' : 'labA');
        $(target).value = row.dataset.player;
        window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
        if ($('labA').value && $('labB').value) runLab();
      };
    });
  }

  function verdictCard(label, p, ours) {
    if (!p) return '';
    const c = isCall(p) ? p.call : null;
    return `<div class="verdict-card ${cls(c)}"><div><h4>${label}: ours ${n1(ours)} vs ${p.line}</h4><p>${c ? `${Math.abs(p.gap).toFixed(1)} pts ${c === 'Over' ? 'above' : 'below'} the line · blended chance ${pct(c === 'Over' ? p.pOver : 1 - p.pOver)}` : friendly(p).replace(/<[^>]+>/g, '')}</p></div><span class="verdict ${cls(c)}">${c ? `${c} ${p.line}` : 'Pass'}</span></div>`;
  }

  async function runLab() {
    const a = $('labA').value.trim();
    const b = $('labB').value.trim();
    if (!a || !b) return;
    const qs = new URLSearchParams({ a, b, line: $('labLine').value, half1: $('labHalf').value, edge: S.settings.edge });
    $('labOut').innerHTML = '<div class="skeleton tall"></div>';
    try {
      const r = await api(`/api/eb/matchup?${qs}`);
      const ph = r.priceHalf;
      let l10Html = '';
      if (r.last10Half != null) {
        const g10 = ph ? r.last10Half - ph.line : null;
        const agree = ph && Math.sign(g10) === Math.sign(ph.gap) && Math.abs(g10) >= 2;
        l10Html = `<div class="tip">📋 <b>Last-10 1H method:</b> ${n1(r.gamers.a.profile?.last10Half?.avg)} + ${n1(r.gamers.b.profile?.last10Half?.avg)} → <b>${n1(r.last10Half)}</b>${ph ? ` (gap ${sign(g10)}) — ${agree ? 'agrees with the model ✅' : 'doesn’t confirm'}` : ''}</div>`;
      }
      $('labOut').innerHTML = `<div class="lab-res">
        <div class="vs-row" style="margin-bottom:4px"><div class="side">${avatar(a)}<div class="nm"><b>${esc(a.toUpperCase())}</b><span>${n1(r.pregame.away)} pts</span></div></div><div class="vs-badge">VS</div><div class="side right">${avatar(b)}<div class="nm"><b>${esc(b.toUpperCase())}</b><span>${n1(r.pregame.home)} pts</span></div></div></div>
        <div class="lab-big">
          <div class="tile hl"><div class="k">Our total</div><div class="v">${tween('lab:t', r.pregame.expected)}</div></div>
          <div class="tile hl"><div class="k">Our 1H</div><div class="v">${tween('lab:h', r.half1)}</div></div>
          <div class="tile"><div class="k">L10 1H</div><div class="v">${n1(r.last10Half)}</div></div>
        </div>
        <div class="stat3" style="margin-top:0">${r.quarters.slice(0, 3).map((q, i) => `<div class="tile"><div class="k">Q${i + 1}</div><div class="v">${n1(q)}</div></div>`).join('')}</div>
        ${verdictCard('Game total', r.priceGame, r.pregame.expected)}
        ${verdictCard('1st half', ph, r.half1)}
        ${!r.priceGame && !ph ? '<div class="tip">Add FanDuel’s line above to see your gap and the call.</div>' : ''}
        ${l10Html}
        ${r.h2h.meetings ? `<div class="tip">🤝 Met ${r.h2h.meetings}× recently · avg total ${n1(r.h2h.avgTotal)}${r.pregame.pair ? ` · model adj ${sign(r.pregame.pair.adj)}` : ''}</div>` : ''}
      </div>`;
      animate($('labOut'));
    } catch (err) {
      $('labOut').innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    }
  }

  // ---------- results ----------
  async function loadPerformance() {
    if (!$('perfOut').children.length) $('perfOut').innerHTML = '<div class="skeleton tall"></div>';
    try {
      const p = await api(`/api/eb/performance?days=${S.perfDays}`);
      const all = p.markets.reduce((a, m) => ({ n: a.n + m.n, w: a.w + m.w, l: a.l + m.l, units: a.units + m.units }), { n: 0, w: 0, l: 0, units: 0 });
      const win = all.w + all.l ? (all.w / (all.w + all.l)) * 100 : null;
      const labels = { game: 'Game total', half1: '1st half', awayTotal: 'Away team', homeTotal: 'Home team' };
      const barRows = (rows, labelOf) => rows.map((m) => {
        const w = m.winPct ?? 0;
        return `<div class="bar-row"><span class="lbl">${esc(labelOf(m))}</span><div class="trk"><i class="${m.units < 0 ? 'neg' : ''}" style="width:0" data-anim="perf:${esc(labelOf(m))}" data-prop="bar" data-left="0" data-width="${w}"></i></div><span class="num">${m.w}-${m.l} · ${m.units >= 0 ? '+' : ''}${m.units}u</span></div>`;
      }).join('');
      const acc = p.accuracy.map((a) => `<tr><td>${a.market === 'game' ? 'Game' : '1H'} @ ${a.checkpoint === 0 ? 'pregame' : `${a.checkpoint}%`}</td><td>${a.n}</td><td class="${a.modelMae <= a.lineMae ? 'pos' : ''}">${a.modelMae}</td><td>${a.lineMae}</td></tr>`).join('');
      const recent = p.recent.slice(0, 20).map((s) => `<div class="res"><span class="badge ${s.result}">${s.result}</span>
        <div><b>${esc(String(s.name || '').replace(/^[^(]*\(([^)]+)\)[^(]*\(([^)]+)\).*$/, '$1 vs $2'))}</b><div class="meta">${esc(s.label)} · ${s.side} ${s.line} (${odds(s.odds)}) · ${esc(s.note || '')}</div></div>
        <div class="val">${s.actual ?? '—'}<div class="meta">${s.units > 0 ? '+' : ''}${s.units ?? 0}u</div></div></div>`).join('');
      const tr = p.tracking;
      $('perfOut').innerHTML = `
        <div class="kpis">
          <div class="kpi"><div class="k">Games graded</div><div class="v">${tween('perf:g', p.games, 0)}</div><div class="s">official finals</div></div>
          <div class="kpi"><div class="k">Calls</div><div class="v">${tween('perf:n', all.n, 0)}</div><div class="s">${all.w}W · ${all.l}L</div></div>
          <div class="kpi"><div class="k">Win rate</div><div class="v ${win != null && win >= 52.4 ? 'pos' : ''}">${win != null ? `${win.toFixed(1)}%` : '—'}</div><div class="s">52.4% breaks even at -110</div></div>
          <div class="kpi"><div class="k">Units</div><div class="v ${all.units >= 0 ? 'pos' : 'neg'}">${all.units >= 0 ? '+' : ''}${(Math.round(all.units * 100) / 100).toFixed(2)}</div><div class="s">1 unit flat per call</div></div>
        </div>
        ${p.games ? '' : '<div class="tip" style="margin-top:12px">The tracker grades every FanDuel eBasketball game automatically, every 2 minutes on Netlify. Results show up about 30 minutes after the first tracked games finish.</div>'}
        ${p.markets.length ? `<p class="section-title">By market</p><div class="card pad bars">${barRows(p.markets, (m) => labels[m.market] || m.market)}</div>` : ''}
        ${p.gapBuckets.length ? `<p class="section-title">By size of gap · raise your minimum if the small bucket loses</p><div class="card pad bars">${barRows(p.gapBuckets, (m) => `${m.bucket} pts`)}</div>` : ''}
        ${acc ? `<p class="section-title">Average miss vs the final (lower is better)</p><div class="card pad"><table class="tbl"><thead><tr><th>Market</th><th>Games</th><th>Ours</th><th>FanDuel</th></tr></thead><tbody>${acc}</tbody></table></div>` : ''}
        ${recent ? `<p class="section-title">Latest graded calls</p><div class="res-list">${recent}</div>` : ''}
        <p class="footnote">${tr ? `Tracking ${tr.active} live · ${tr.awaitingGrade} awaiting official finals · last run ${tr.lastRun ? new Date(tr.lastRun.at).toLocaleTimeString() : '—'}` : 'Tracker hasn’t run yet — it starts with the first Netlify scheduled run.'}</p>`;
      animate($('perfOut'));
    } catch (err) {
      $('perfOut').innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    }
  }

  // ---------- leagues ----------
  const LG_FILTERS = [['live', 'Live'], ['all', 'All'], ['nba', 'NBA'], ['wnba', 'WNBA'], ['nbl', 'NBL'], ['euroleague', 'Euro'], ['bbl', 'BBL'], ['lkl', 'LKL'], ['ncaam', 'NCAAM']];
  const lgLive = (g) => g.status === 'in_progress' || g.status === 'halftime';

  function renderLeagueList() {
    $('leagueFilters').innerHTML = LG_FILTERS.map(([id, l]) => `<button type="button" data-lf="${id}" class="${S.lg.filter === id ? 'active' : ''}">${l}</button>`).join('');
    document.querySelectorAll('[data-lf]').forEach((b) => { b.onclick = () => { S.lg.filter = b.dataset.lf; renderLeagueList(); }; });
    const list = S.lg.games.filter((g) => (S.lg.filter === 'all' ? true : S.lg.filter === 'live' ? lgLive(g) : g.leagueId === S.lg.filter));
    $('leagueList').innerHTML = list.length ? list.map((g) => `<div class="league-row ${S.lg.selected === g.id ? 'selected' : ''}${enterCls(`lg:${g.id}`)}" data-lg="${esc(g.id)}">
      <div><div class="t">${esc(g.away.abbrev || g.away.shortName || g.away.name)} @ ${esc(g.home.abbrev || g.home.shortName || g.home.name)}</div>
      <div class="s">${esc(g.leagueAbbrev || '')} · ${lgLive(g) ? `${esc(g.periodText || '')} ${esc(g.clock || '')}` : g.status === 'final' ? 'Final' : hhmm(g.date)}${g.fdTotal ? ` · FD ${g.fdTotal.line}` : ''}</div></div>
      <div class="sc">${g.status === 'scheduled' ? '' : `${g.away.score}-${g.home.score}`}</div></div>`).join('') : '<div class="empty-line">No games for this filter.</div>';
    document.querySelectorAll('[data-lg]').forEach((r) => { r.onclick = () => { haptic(); selectLeagueGame(r.dataset.lg); }; });
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
        <div class="hud-head tight"><div><p class="eyebrow">${esc(d.league.name)}</p><h2>${esc(g.away.name)} ${g.away.score} @ ${esc(g.home.name)} ${g.home.score}</h2></div><span class="chip">${esc(g.periodText || '')} ${esc(g.clock || '')}</span></div>
        <div class="stat3"><div class="tile"><div class="k">Pace /${s.regulationMinutes}</div><div class="v">${s.pace}</div></div><div class="tile"><div class="k">Pts / poss</div><div class="v">${s.ppp}</div></div><div class="tile hl"><div class="k">Fair total</div><div class="v">${s.fairGameTotal}</div></div></div>
        <form id="lgForm" class="league-lines">
          <label>Game total ${listRow?.fdTotal ? '· FD live' : ''}<input id="lgGame" inputmode="decimal" value="${esc(autoLine)}" placeholder="line" /></label>
          <label>Quarter<input id="lgQ" inputmode="decimal" value="${esc(saved.quarterTotal || '')}" /></label>
          <label>1st half<input id="lgH" inputmode="decimal" value="${esc(saved.halfTotal || '')}" /></label>
          <label>${esc(g.away.abbrev || 'Away')} team<input id="lgA" inputmode="decimal" value="${esc(saved.awayTotal || '')}" /></label>
          <label>${esc(g.home.abbrev || 'Home')} team<input id="lgHm" inputmode="decimal" value="${esc(saved.homeTotal || '')}" /></label>
          <button class="cta" type="submit">Evaluate</button>
        </form>
        <div id="lgOut"><p class="say">Source: ${esc(s.source)} · ${s.elapsed} min played · ${s.remaining} left.</p></div>`;
      $('lgForm').onsubmit = async (e) => {
        e.preventDefault();
        const lines = { gameTotal: $('lgGame').value, quarterTotal: $('lgQ').value, halfTotal: $('lgH').value, awayTotal: $('lgA').value, homeTotal: $('lgHm').value };
        store.set(`fd-lines:${id}`, lines);
        try {
          const r = await api('/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId: id, lines }) });
          $('lgOut').innerHTML = `<div class="lg-calls">${r.advice.markets.map((m) => `<article class="card market ${isCall(m) ? `call-${cls(m.call)}` : ''}"><div class="market-top"><h3>${esc(m.label)}</h3><span class="verdict ${cls(m.call)}">${esc(m.call || 'Pass')}</span></div>
            <div class="stat3"><div class="tile"><div class="k">Line</div><div class="v">${m.line ?? '—'}</div></div><div class="tile hl"><div class="k">Fair</div><div class="v">${m.fair ?? '—'}</div></div><div class="tile"><div class="k">Edge</div><div class="v">${sign(m.edge)}</div></div></div>
            <p class="say">${esc(m.reason || `Confidence ${m.confidence}`)}</p></article>`).join('')}</div>
            <div class="tip">${esc(r.advice.why)}</div><p class="say">${esc((r.advice.risks || []).join(' · '))}</p>`;
        } catch (err) {
          $('lgOut').innerHTML = `<p class="muted">${esc(err.message)}</p>`;
        }
      };
      if (autoLine) $('lgForm').requestSubmit();
    } catch (err) {
      $('leagueDetail').innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    }
  }

  // ---------- settings / onboarding / polling / PWA ----------
  function syncRange(id, valId) {
    const el = $(id);
    const p = ((el.value - el.min) / (el.max - el.min)) * 100;
    el.style.setProperty('--p', `${p}%`);
    $(valId).textContent = el.value;
  }
  function openSettings() {
    $('setEdge').value = S.settings.edge;
    $('setEv').value = S.settings.ev;
    $('setPoll').value = S.settings.poll;
    [['setEdge', 'setEdgeVal'], ['setEv', 'setEvVal'], ['setPoll', 'setPollVal']].forEach(([a, b]) => syncRange(a, b));
    $('settings').showModal();
  }
  function saveSettings() {
    S.settings = { edge: Number($('setEdge').value) || 4, ev: Number($('setEv').value) || 0, poll: Math.max(4, Number($('setPoll').value) || 8) };
    store.set('cs.settings', S.settings);
    startPolling();
    loadBoard(true);
    if (S.view === 'game') loadDetail();
    toast(`Calls now need a ${S.settings.edge}-pt gap and ${S.settings.ev}% value.`);
  }

  let obStep = 0;
  function obShow(i) {
    obStep = i;
    document.querySelectorAll('#obSlides .ob').forEach((el, k) => {
      el.classList.toggle('active', k === i);
      el.classList.toggle('gone', k < i);
    });
    document.querySelectorAll('#obDots i').forEach((el, k) => el.classList.toggle('on', k === i));
    $('obNext').textContent = i === 2 ? 'Let’s go' : 'Next';
  }
  function openOnboarding() {
    obShow(0);
    $('onboard').showModal();
  }
  function closeOnboarding() {
    $('onboard').close();
    store.set('cs.onboarded', true);
  }

  function startPolling() {
    S.timers.forEach(clearInterval);
    S.timers = [];
    S.timers.push(setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadBoard(false);
      if (S.view === 'game' && S.selected) loadDetail();
    }, Math.max(4, S.settings.poll) * 1000));
    S.timers.push(setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (S.view === 'leagues') loadLeagues();
      if (S.view === 'results') loadPerformance();
    }, 30000));
    S.timers.push(setInterval(() => {
      if (!S.boardAt) return;
      const s = Math.round((Date.now() - S.boardAt) / 1000);
      $('updatedAgo').textContent = s < 3 ? 'now' : `${s}s ago`;
    }, 1000));
  }

  let deferredPrompt = null;
  function setupPwa() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
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
    if (ios && store.get('cs.onboarded', false) && !store.get('cs.iosHint', false)) {
      setTimeout(() => toast('Install it: tap Share → Add to Home Screen.', 8000), 2500);
      store.set('cs.iosHint', true);
    }
  }

  function bind() {
    document.querySelectorAll('.tabs [data-view], .bottom-nav [data-view]').forEach((b) => { b.onclick = () => { haptic(); setView(b.dataset.view); }; });
    document.querySelectorAll('[data-view-go]').forEach((b) => { b.onclick = () => setView(b.dataset.viewGo); });
    $('refreshBtn').onclick = () => { haptic(); loadBoard(true); };
    $('settingsBtn').onclick = openSettings;
    $('helpBtn').onclick = openOnboarding;
    $('saveSettings').onclick = () => saveSettings();
    [['setEdge', 'setEdgeVal'], ['setEv', 'setEvVal'], ['setPoll', 'setPollVal']].forEach(([a, b]) => { $(a).oninput = () => syncRange(a, b); });
    $('obNext').onclick = () => (obStep >= 2 ? closeOnboarding() : obShow(obStep + 1));
    $('obSkip').onclick = closeOnboarding;
    $('labForm').onsubmit = (e) => { e.preventDefault(); haptic(); runLab(); };
    $('playerSearch').oninput = renderPlayers;
    document.querySelectorAll('#playerSort button').forEach((b) => {
      b.onclick = () => {
        S.playerSort = b.dataset.sort;
        document.querySelectorAll('#playerSort button').forEach((x) => x.classList.toggle('active', x === b));
        renderPlayers();
      };
    });
    document.querySelectorAll('#boardFilter button').forEach((b) => {
      b.onclick = () => {
        S.boardFilter = b.dataset.f;
        document.querySelectorAll('#boardFilter button').forEach((x) => x.classList.toggle('active', x === b));
        renderBoard();
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
    window.addEventListener('resize', moveInk);
  }

  // Netlify's free-plan "Powered by Netlify" badge sits bottom-right; keep the nav above it.
  function avoidHostBadge() {
    const f = document.getElementById('nl-badge-frame');
    const r = f && f.getBoundingClientRect();
    const h = r && r.height > 0 && r.bottom > window.innerHeight - 4 ? Math.ceil(r.height) : 0;
    document.documentElement.style.setProperty('--badge-h', `${h}px`);
  }
  new MutationObserver(avoidHostBadge).observe(document.body, { childList: true });
  setInterval(avoidHostBadge, 3000);
  window.addEventListener('resize', avoidHostBadge);

  bind();
  setupPwa();
  setView(S.view);
  loadBoard(false);
  startPolling();
  setTimeout(moveInk, 300);
  if (!store.get('cs.onboarded', false)) setTimeout(openOnboarding, 700);
})();
