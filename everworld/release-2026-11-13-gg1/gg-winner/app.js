/* GG Winner — FanDuel eBasketball live totals (H2H GG League 4x5) */
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
    settings: { edge: 2, ev: 3, poll: 8, ...store.get('ggw.settings', {}) },
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
  // Plus edges only: a call means our number is ahead of FanDuel's line. Anything below the line is no play.
  const isCall = (m) => m && m.call === 'Over';
  const callTxt = (m) => `PLUS EDGE · line ${m.line}`;
  const edgeTxt = (g) => (isNum(g) && g < 0 ? 'Below line' : sign(g));
  function plusOnly(o, d = 0) {
    if (!o || typeof o !== 'object' || d > 8) return o;
    if (Array.isArray(o)) { o.forEach((x) => plusOnly(x, d + 1)); return o; }
    if (o.call === 'Under') { o.call = 'Pass'; o.reason = 'Below the line: plus edges only'; }
    for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') plusOnly(o[k], d + 1);
    if (o.best && !isCall(o.best)) o.best = null;
    if (Array.isArray(o.picks)) o.picks = o.picks.filter((p) => !p || !p.market || isCall(p.market));
    if (Array.isArray(o.recent)) o.recent = o.recent.filter((s) => !s || s.side !== 'Under');
    return o;
  }
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

  // The league's own results source (/h2h) can turn the app away: 403 when it blocks automated traffic, 429 when it is asked too
  // often, 5xx when it is down. Then the app stops asking on every refresh and tries again after a growing wait (30 seconds, then
  // 1, 2, 4, 8 and at most 10 minutes). The board's lines and scores come from another source and are not affected.
  const LEAGUE = { fails: 0, until: 0, status: 0 };
  const leagueWaitMs = (fails) => Math.min(600000, 30000 * 2 ** Math.max(0, fails - 1));
  // (several league requests are in flight together: a bad moment counts once, not once per request, or one dropped second would start the longest wait)
  const leagueFail = (status) => { if (Date.now() < LEAGUE.until) return; LEAGUE.fails += 1; LEAGUE.status = status; LEAGUE.until = Date.now() + leagueWaitMs(LEAGUE.fails); };
  async function api(path, opts) {
    // live data comes from GG Winner's data server (a Supabase function); the app itself is static
    const DATA = 'https://pjthpontugjihnjsxxry.supabase.co/functions/v1/gg-winner';
    const url = /^\/(api|h2h)\//.test(path) ? DATA + path : path;
    const league = path.startsWith('/h2h/');
    if (league && Date.now() < LEAGUE.until) { const e = new Error(`HTTP ${LEAGUE.status || 503}`); e.status = LEAGUE.status || 503; e.waiting = true; throw e; }
    let res;
    try { res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' }, ...opts }); }
    catch (err) { if (league) leagueFail(0); throw err; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (league && (res.status === 403 || res.status === 429 || res.status >= 500)) leagueFail(res.status);
      const e = new Error(body.error || `HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    if (league) { LEAGUE.fails = 0; LEAGUE.until = 0; LEAGUE.status = 0; }
    // GG League games being played: the late-game correction of our number (gg-live.js), before anything is drawn from it
    if (window.GGLive && /^\/api\/eb\/(board|game\/)/.test(path)) {
      try {
        window.GGLive.fix(body, { edgeMin: Number(S.settings.edge), evMin: Number(S.settings.ev) / 100 });
        // the share of our raw number the server is using in each stretch of a game, read off the board for the report card
        if (/^\/api\/eb\/board/.test(path)) {
          const had = store.get('gg-phase-w', null), now = window.GGLive.learnWeights(body, had);
          if (JSON.stringify(now) !== JSON.stringify(had)) store.set('gg-phase-w', now); // (saved only when one of them changed)
        }
      } catch { /* the server's own numbers are shown */ }
    }
    return plusOnly(body);
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
    const span = 8;
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

  // When a live projection moves, show an arrow, the size of the move and a one-line reason for a few seconds.
  const moves = new Map();
  function moveTag(key, value, reasonUp, reasonDown) {
    if (!isNum(value)) return '';
    const m = moves.get(key);
    const now = Date.now();
    if (!m) { moves.set(key, { v: value, at: 0, d: 0 }); return ''; }
    if (Math.abs(value - m.v) >= 0.5) { m.d = value - m.v; m.v = value; m.at = now; }
    if (now - m.at > 14000 || !m.d) return '';
    const up = m.d > 0;
    return `<span class="mvtag ${up ? 'up' : 'down'}" style="--age:${((now - m.at) / 1000).toFixed(1)}s">${up ? '▲ +' : '▼ −'}${Math.abs(m.d).toFixed(1)} <i>${esc(up ? reasonUp : reasonDown)}</i></span>`;
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
      return `GG expects <b>${n1(m.fair)}</b> points, ${Math.abs(m.gap).toFixed(1)} ahead of FanDuel’s ${m.line}. That’s a plus edge: our number says this scores more than FanDuel thinks. Chance it beats ${m.line}: <b>${pct(m.pOver)}</b>.`;
    }
    const r = m.reason || '';
    if (m.line == null) return 'FanDuel hasn’t posted this line yet.';
    if (/suspended/i.test(r)) return 'FanDuel has this market paused right now — check back in a moment.';
    // plus edges only: our number is never set against a line it is not ahead of (v3.10)
    if (/Below the line/i.test(r) || (isNum(m.gap) && m.gap < 0)) return 'Our number is not ahead of this line, so there is no plus edge here. We only play plus edges.';
    if (/Edge under/i.test(r)) return `Too close to call: GG ${n1(m.fair)} and FanDuel’s ${m.line} are only ${n1(Math.abs(m.gap))} points apart. We wait for a bigger gap before calling it a plus edge.`;
    // (the gap the server passed on is its own: quoted from its number, not from the late-game corrected one)
    if (/ratings may be off/i.test(r)) return `Huge gap with FanDuel (${n1(Math.abs(isNum(m.serverMean) && isNum(m.line) ? m.serverMean - m.line : m.rawGap))} points) usually means the ratings are off for this pair, so no call.`;
    if (/Price/i.test(r)) return `There’s a ${sign(m.gap)} edge, but the price takes away the value.`;
    if (/Low confidence/i.test(r)) return 'Gap is there, but confidence is too low to trust it.';
    if (/early|late/i.test(r)) return f > 0.8 ? 'Final stretch — late calls lose too often, so we sit out.' : 'Too early for this market.';
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

  function setView(v, { fromHistory = false } = {}) {
    // Android back gesture walks back through tabs instead of closing the app.
    if (!fromHistory && v !== S.view) {
      try { history.pushState({ view: v }, '', `#${v}`); } catch { /* ignore */ }
    }
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
    if (v === 'players') { renderProfiles(); loadProfiles(false); }
  }

  // ---------- board ----------
  function pickCard(p) {
    const m = p.market;
    return `<article class="pick ${cls(m.call)}${enterCls(`pick:${p.eventId}:${m.id}`)}" data-event="${esc(p.eventId)}">
      <div class="pick-top">${avatar(p.away.player, 'sm')}<div class="pick-vs"><b>${esc(p.away.player)} vs ${esc(p.home.player)}</b><span>${p.status === 'live' ? 'Live now' : 'Pre-game'} · ${esc(m.label)}</span></div>${meter(m)}</div>
      <div class="pick-call"><div><div class="mk">The call</div><div class="big">${callTxt(m)}</div></div>
        <div style="text-align:right"><div class="mk">Edge</div><div class="big" style="font-size:22px">${sign(m.gap)}</div></div></div>
      <p class="pick-say">${friendly(m)} Price ${odds(m.overOdds)}.</p>
    </article>`;
  }

  // "±5" next to our number: how far it usually lands from the final from this point of a game (average miss, measured: gg-live.js)
  const usual = (ev, live, shown) => (window.GGLive && isNum(shown) && ev && ev.progress && !ev.progress.overtime ? `<small class="usual">±${Math.round(window.GGLive.usualMiss(ev.progress.f, live))}</small>` : '');
  function matchCard(g) {
    const ev = g.eval;
    const gm = ev.markets.find((m) => m.id === 'game') || {};
    const best = ev.best;
    const show = best || gm;
    const live = g.status === 'live';
    const call = isCall(show) ? show.call : null;
    const key = `m:${g.eventId}`;
    const sel = S.selected === g.eventId ? ' selected' : '';
    const fdMu = live && PF.model ? boardMatchups().find((x) => x.id === `fd:${g.eventId}`) : null;
    const hi = fdMu && fdMu.pre.level >= 1 ? ' hi-score' : '';
    return `<article class="card match ${call ? `call-${cls(call)}` : ''}${sel}${hi}${enterCls(key)}" data-event="${esc(g.eventId)}">${hi ? hiRibbon(fdMu) : ''}
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
        <div class="tile hl"><div class="k">GG proj</div><div class="v">${tween(`${key}:p`, gm.fair ?? gm.mean)}${usual(ev, live, gm.fair ?? gm.mean)}</div></div>
        <div class="tile"><div class="k">Edge</div><div class="v ${gm.gap > 0 ? 'pos' : ''}">${edgeTxt(gm.gap)}</div></div>
      </div>
      ${gapbar(`${key}:gb`, gm.gap)}
      ${live ? moveTag(`${key}:mv`, gm.serverFair ?? gm.fair ?? gm.mean, 'scoring picked up', 'scoring slowed') : ''}
      ${fdMu && fdMu.lv && fdMu.lv.fade ? `<p class="fade-note">📉 ${esc(fdMu.lv.fade[0].text)}</p>` : ''}
      ${fdMu ? factorsStrip(fdMu) : ''}
      <div class="match-foot">
        <span class="verdict ${cls(call)}">${call ? `PLUS EDGE ${show.line}` : 'No play'}</span>
        <span class="say">${call && show.id !== 'game' ? `${esc(show.label)} · ` : ''}${call ? `long-run return ${evPct(show.ev)} per $100` : friendly(gm, ev.progress.f).replace(/<[^>]+>/g, '')}</span>
        ${live ? ring(`${key}:r`, ev.progress.f, quarterLabel(ev, g.status)) : ''}
      </div>
    </article>`;
  }

  // A pre-game game counts as high-scoring when the player profiles flag it, or when either total
  // (profiles or the GG model) is at or above the league's high-total line.
  function upHigh(u) {
    if (!PF.model) return null;
    const pf = GP.project(PF.model, u.away.player, u.home.player, u.away.team, u.home.team);
    if (pf.level >= 1) return { level: pf.level, label: pf.label, total: pf.total };
    const gg = u.eval && u.eval.pregame ? Number(u.eval.pregame.expected) : NaN;
    if (Number.isFinite(gg) && gg >= PF.model.league.highLine) return { level: 1, label: 'High total', total: gg };
    return null;
  }
  function upCall(u) {
    if (!PF.model) return '';
    const m = boardMatchups().find((x) => x.id === u.id);
    const r = callsFor(m)[0];
    if (!r) return '';
    const v = verdict(r, lineGet(u.id));
    return `<i class="up-call" data-line="${esc(u.id)}|${esc(u.away.player)}|${esc(u.home.player)}">GG ${n1(r.proj)} · plus edge at ${r.over} or lower${v ? ` · <b class="${v.cls}">${esc(v.txt)}</b>` : ' · ✎ line'}</i>`;
  }
  function upRow(u) {
    const ev = u.eval;
    const h1 = ev.markets.find((m) => m.id === 'half1');
    const l10 = h1?.last10;
    const mins = Math.max(0, Math.round((u.scheduledMs - Date.now()) / 60000));
    const pair = ev.pregame.pair;
    const started = u.status === 'started';
    const hi = upHigh(u);
    const flame = hi ? `<i class="up-flag lvl${hi.level}">${hi.level >= 2 ? '🔥' : '⬆'} ${esc(hi.label)} · GG ${n1(hi.total)}</i>` : '';
    return `<div class="up${started ? ' up-started' : ''}${hi ? ` up-fast hi-score lvl${hi.level}` : ''}${enterCls(`u:${u.id}`)}" data-lab="${esc(u.away.player)}|${esc(u.home.player)}">${hi ? '<span class="hi-tag">HIGH-SCORING</span>' : ''}
      <div class="when"><b>${started ? 'LIVE' : u.late ? 'SOON' : mins ? `${mins}m` : 'NOW'}</b><span>${started ? 'not on FanDuel' : u.late ? `due ${hhmm(u.scheduledMs)}` : hhmm(u.scheduledMs)}</span></div>
      <div class="who"><b>${esc(u.away.player)} <span class="muted">vs</span> ${esc(u.home.player)}</b>${flame}${upCall(u)}<span>${pair && pair.n >= 3 ? `H2H ${pair.n}× · avg ${n1(pair.avgTotal)}` : esc(u.stream || '')}</span></div>
      <div class="nums">
        <div><b class="${hi ? 'hi-num' : ''}">${n1(ev.pregame.expected)}</b><span>TOTAL</span></div>
        <div><b>${n1(h1?.mean)}</b><span>1H</span></div>
        <div><b class="muted">${l10 ? n1(l10.avg) : '—'}</b><span>L10 1H</span></div>
      </div>
    </div>`;
  }

  // A GG League game that is under way but not on FanDuel's list: show it on the live board with
  // the league's own score and quarter, plus our pregame numbers (no odds to compare against).
  function leagueLiveCard(u) {
    const ev = u.eval || { markets: [], pregame: {} };
    const muAll = PF.model ? boardMatchups().find((m) => m.id === u.id) : null;
    const mu = muAll && u.liveScore && !u.liveScore.paused ? muAll : null;
    const h1 = ev.markets.find((m) => m.id === 'half1');
    const sc = u.liveScore;
    const key = `ll:${u.id}`;
    const at = sc && sc.q ? `${sc.q > 4 ? 'OT' : `Q${sc.q}`}${Number.isFinite(sc.clock) ? ` ${Math.floor(sc.clock / 60)}:${String(sc.clock % 60).padStart(2, '0')}` : ''}` : '';
    const tag = at || 'just tipped';
    const paused = Boolean(sc && sc.paused);
    const quietMin = sc && sc.quietMs >= 60000 ? Math.round(sc.quietMs / 60000) : 0;
    const hi = muAll && muAll.pre.level >= 1 ? ' hi-score' : '';
    return `<article class="card match league-live${paused ? ' feed-paused' : ''}${hi}${enterCls(key)}" data-lab="${esc(u.away.player)}|${esc(u.home.player)}">${hi ? hiRibbon(muAll) : ''}
      <div class="vs-row">
        <div class="side">${avatar(u.away.player)}<div class="nm"><b>${esc(u.away.player)}</b><span>${esc(u.away.team)}</span></div></div>
        <div class="center-hud">
          <div class="scoreline">${sc ? `${sc.a}<span class="c">:</span>${sc.b}` : '<span class="c">vs</span>'}</div>
          ${paused
    ? `<span class="status-tag paused">❚❚ FEED PAUSED · ${esc(tag)}</span>`
    : `<span class="status-tag live">● LIVE · ${esc(tag)}</span>`}
        </div>
        <div class="side right">${avatar(u.home.player)}<div class="nm"><b>${esc(u.home.player)}</b><span>${esc(u.home.team)}</span></div></div>
      </div>
      <div class="stat3">
        <div class="tile"><div class="k">Pace now</div><div class="v">${sc && sc.pace && !paused ? n1(sc.pace) : '—'}</div></div>
        <div class="tile hl"><div class="k">GG proj</div><div class="v">${n1(ev.pregame.expected)}</div></div>
        <div class="tile"><div class="k">1H proj</div><div class="v">${n1(h1?.mean)}</div></div>
      </div>
      ${factorsStrip(mu)}
      ${muAll ? callsBox(muAll) : ''}
      <div class="match-foot"><span class="verdict">GG League</span><span class="say">${paused
    ? `The league’s score feed stopped updating at ${esc(tag)}${quietMin ? ` (${quietMin} min ago)` : ''}, so this score is old. Check ${esc(u.stream || 'the stream')} or FanDuel for the real score.`
    : `${esc(u.stream || '')} · FanDuel’s line isn’t reaching the app, so type it in for a call`}</span></div>
    </article>`;
  }
  function nextGameLine(b) {
    const next = (b.upcoming || []).filter((u) => u.status !== 'started').sort((x, y) => x.scheduledMs - y.scheduledMs)[0];
    if (!next) return '';
    return ` Next GG League game: ${esc(next.away.player)} vs ${esc(next.home.player)} at ${hhmm(next.scheduledMs)}.`;
  }

  function renderBoard() {
    const b = S.board;
    if (!b) return;
    let live = b.live || [];
    const leagueLive = (b.upcoming || []).filter((u) => u.status === 'started');
    const pre = (b.upcoming || []).filter((u) => u.status !== 'started');
    $('liveCount').textContent = live.length + leagueLive.length;
    $('upCount').textContent = pre.length;
    const preHi = pre.filter((u) => upHigh(u));
    S.preHiIds = preHi.map((u) => u.id);
    const hc = $('upHiCount');
    if (hc) { hc.textContent = preHi.length ? `${preHi.length} high-scoring` : ''; hc.classList.toggle('hidden', !preHi.length); }
    if (S.boardFilter === 'calls') live = live.filter((g) => g.eval.best);
    if (S.boardFilter === 'live') live = live.filter((g) => g.status === 'live');
    const rail = $('picks');
    const scroll = rail.scrollLeft;
    rail.innerHTML = (b.picks || []).length
      ? b.picks.map(pickCard).join('')
      : `<div class="pick-empty">No plus edges right now: no game has our number <b>${S.settings.edge}+ points ahead</b> of FanDuel’s line at a price that pays.<br>New games tip every few minutes.</div>`;
    rail.scrollLeft = scroll;
    const showLeague = S.boardFilter !== 'calls' ? leagueLive : [];
    $('liveList').innerHTML = live.length || showLeague.length
      ? live.map(matchCard).join('') + showLeague.map(leagueLiveCard).join('')
      : `<div class="empty-line">${S.boardFilter === 'calls' ? 'No calls on the live board right now.' : `No eBasketball game is being played right now.${nextGameLine(b)}`}</div>`;
    renderAlerts();
    const sched = b.schedule;
    $('upList').innerHTML = pre.length
      ? pre.slice(0, 14).map(upRow).join('')
      : `<div class="empty-line">${sched && sched.ok === false ? 'The GG League schedule isn’t reaching the app right now, so games FanDuel doesn’t list can’t show.' : 'Schedule loading or nothing in the next 75 minutes.'}</div>`;
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
    wireCalls();
    paintLines();
    animate($('view-board'));
  }

  // ---------- GG League schedule straight from the league (when the server can't get it) ----------
  // The site proxies /h2h/* to the league's public stats API (see _redirects), so the app can still
  // list GG League games FanDuel leaves off its board, with pregame numbers from /api/eb/matchup.
  const H2H_RUN = 35 * 60000;
  const normP = (x) => String(x || '').trim().toUpperCase();
  const pairMemo = new Map();
  async function pairPregame(a, b) {
    const k = [a, b].sort().join('|');
    const hit = pairMemo.get(k);
    if (hit && Date.now() - hit.at < 10 * 60000) return hit.ev;
    let ev = { markets: [], pregame: {} };
    try {
      const m = await api(`/api/eb/matchup?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
      ev = {
        markets: [{ id: 'half1', mean: m.half1, last10: Number.isFinite(m.last10Half) ? { avg: m.last10Half } : null }],
        pregame: { expected: m.pregame?.expected, pair: m.pregame?.pair || null },
      };
    } catch { /* numbers stay blank */ }
    pairMemo.set(k, { at: Date.now(), ev });
    return ev;
  }
  // Live score, quarter and clock from the league's play-by-play. runningScore team_a is the
  // schedule's (and matchSummary's) team A, whatever invertedTeams says (that flag only flips
  // halfTimeScore; checked against player names on Nov 7). Returns { done:true } once the game ends.
  function leagueScore(tl, now = Date.now(), startMs = now) {
    const inc = Array.isArray(tl?.incidents) ? tl.incidents : [];
    if (!inc.length) return null;
    const last = inc[inc.length - 1];
    const rs = [...inc].reverse().find((i) => i.runningScore && Number.isFinite(Number(i.runningScore.team_a)));
    if (!rs) return null;
    const a = Number(rs.runningScore.team_a);
    const b = Number(rs.runningScore.team_b);
    const lastQ = [...inc].reverse().find((i) => i.period && (i.period.type === 'QUARTER' || i.period.type === 'OVERTIME'));
    const p = lastQ?.period || last.period || {};
    const q = p.type === 'OVERTIME' ? 5 : Number(p.id) || 1;
    const ended = Boolean(tl?.matchSummary?.finalScore)
      || inc.some((i) => i.period?.type === 'MATCH_ENDED' && i.payload?.phase === 'ENDED')
      || (last.messageType === 'NBA_PERIOD_CHANGE' && last.payload?.phase === 'ENDED' && q >= 4 && a !== b);
    const clock = Number.isFinite(Number(last.inPlayClockSeconds)) ? Number(last.inPlayClockSeconds) : null;
    const qLen = q > 4 ? 180 : 300;
    const played = Math.min(4, q - 1) * 300 + Math.max(0, q - 5) * 180 + (clock != null ? qLen - Math.min(qLen, clock) : 0);
    const pace = played >= 120 ? ((a + b) / Math.min(played, 1200)) * 1200 : null;
    const sig = `${inc.length}:${last.timestamp ?? ''}:${a}:${b}`;
    // score when the current quarter began, and the first-half total once Q2 is over (for live quarter/half numbers)
    let qStart = null; let h1 = null; let run = null;
    for (const i of inc) {
      if (i.runningScore && Number.isFinite(Number(i.runningScore.team_a))) run = Number(i.runningScore.team_a) + Number(i.runningScore.team_b);
      const pp = i.period || {};
      if (i.messageType === 'NBA_PERIOD_CHANGE' && i.payload?.phase === 'STARTED' && (pp.type === 'QUARTER' || pp.type === 'OVERTIME') && run != null) {
        const pq = pp.type === 'OVERTIME' ? 5 : Number(pp.id);
        if (pq === q) qStart = run;
      }
      if (i.messageType === 'NBA_PERIOD_CHANGE' && i.payload?.phase === 'ENDED' && pp.type === 'QUARTER' && Number(pp.id) === 2 && run != null) h1 = run;
    }
    if (qStart == null && q === 1) qStart = 0;
    return { a, b, q: Math.min(q, 5), clock, pace, played, sig, done: ended, qStart, h1 };
  }
  const tlMemo = new Map();
  async function leagueTimeline(externalId) {
    const hit = tlMemo.get(externalId);
    if (hit && Date.now() - hit.at < 20000) return hit.v;
    let v = null;
    try { v = await api(`/h2h/v1/timeline/?external_id=${encodeURIComponent(externalId)}`); } catch { /* nothing for this id */ }
    tlMemo.set(externalId, { at: Date.now(), v });
    return v;
  }
  async function leagueLive(externalId) {
    return leagueScore(await leagueTimeline(externalId));
  }
  // The league's play-by-play sometimes stops updating in the middle of a game (seen Nov 7: one game
  // stuck at Q2 2:29, another stuck in overtime long after it ended). Spot that two ways: nothing new
  // for 2.5 minutes while we watch, or the feed is far behind the time since tip-off (a game minute
  // takes about 1.25 real minutes). A paused game is marked as paused, not shown as a live score, and
  // once it's 28 minutes past its start it's treated as over and leaves the board.
  const FEED_QUIET = 150000;
  const REAL_PER_GAME_SEC = 1250;
  const FEED_BEHIND = 7 * 60000;
  const FEED_GONE = 28 * 60000;
  const feedSeen = new Map();
  function feedState(id, sc, startMs, now = Date.now()) {
    if (!sc) return sc;
    const seen = feedSeen.get(id);
    const same = seen && seen.sig === sc.sig;
    if (!same) feedSeen.set(id, { sig: sc.sig, at: now });
    const quiet = same ? now - seen.at : 0;
    const behind = now - startMs - sc.played * REAL_PER_GAME_SEC;
    const paused = !sc.done && (quiet >= FEED_QUIET || behind >= FEED_BEHIND);
    return { ...sc, paused, quietMs: quiet, gone: paused && now - startMs >= FEED_GONE };
  }
  // The league's schedule leaves games out while they're being played (they come back once
  // they've ended), so a game under way shows up only as a missing number in the ids, like
  // NB183..NB187 between NB182 and NB188. Look those numbers up in the play-by-play, which
  // still has them with teams, players, stream and start time.
  const idParts = (id) => {
    const m = /^([A-Z]+)(\d+)(\d{6})$/.exec(String(id || ''));
    return m ? { pre: m[1], seq: Number(m[2]), w: m[2].length, day: m[3] } : null;
  };
  function missingIds(rows, now) {
    const groups = new Map();
    for (const r of rows) {
      const p = idParts(r.externalId);
      const t = Date.parse(r.startDate);
      if (!p || !Number.isFinite(t)) continue;
      const k = `${p.pre}|${p.day}|${p.w}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ ...p, t });
    }
    const out = [];
    const mk = (p, seq) => `${p.pre}${String(seq).padStart(p.w, '0')}${p.day}`;
    for (const list of groups.values()) {
      list.sort((x, y) => x.seq - y.seq);
      for (let i = 0; i < list.length; i++) {
        const cur = list[i];
        const next = list[i + 1];
        if (next && next.seq - cur.seq > 1 && cur.t <= now && next.t >= now - H2H_RUN) {
          for (let s = cur.seq + 1; s < next.seq && s - cur.seq <= 8; s++) out.push(mk(cur, s));
        }
        if (!next && cur.t <= now) for (let s = cur.seq + 1; s <= cur.seq + 6; s++) out.push(mk(cur, s));
      }
    }
    return out.slice(0, 16);
  }
  async function hiddenLiveRows(rows, now) {
    const ids = missingIds(rows, now);
    const found = await Promise.all(ids.map(async (id) => {
      const tl = await leagueTimeline(id);
      const ms = tl?.matchSummary;
      if (!ms?.teamA || !ms?.teamB || !Array.isArray(tl.incidents) || !tl.incidents.length) return null;
      return {
        externalId: ms.externalId || id,
        startDate: ms.startDate,
        isCancelled: false,
        teamAName: ms.teamA.teamName,
        teamBName: ms.teamB.teamName,
        participantAName: ms.teamA.participantName,
        participantBName: ms.teamB.participantName,
        streamName: ms.streamName,
        matchStatus: ms.finalScore ? 'MATCH_ENDED' : null,
        hidden: true,
      };
    }));
    return found.filter(Boolean);
  }
  async function scheduleFromLeague(board, now = Date.now()) {
    const day = (ms) => new Date(ms).toISOString().slice(0, 10);
    const days = [day(now)];
    if (new Date(now).getUTCHours() >= 23) days.push(day(now + 86400000));
    if (new Date(now).getUTCHours() < 1) days.push(day(now - 86400000));
    let rows = [];
    for (const d of days) rows = rows.concat(await scheduleDay(d, 6000));
    rows = rows.concat(await hiddenLiveRows(rows, now));
    const onBoard = new Set((board.live || []).map((g) => [normP(g.away?.player), normP(g.home?.player)].sort().join('|')));
    const picked = rows.filter((m) => {
      const t = Date.parse(m.startDate);
      if (!Number.isFinite(t) || m.isCancelled || m.matchStatus === 'MATCH_ENDED') return false;
      if (t < now - H2H_RUN || t > now + 75 * 60000) return false;
      return !onBoard.has([normP(m.participantAName), normP(m.participantBName)].sort().join('|'));
    }).sort((x, y) => {
      const tx = Date.parse(x.startDate); const ty = Date.parse(y.startDate);
      const sx = tx <= now; const sy = ty <= now;
      return sx === sy ? tx - ty : sx ? -1 : 1;
    }).slice(0, 18);
    const out = await Promise.all(picked.map(async (m) => {
      const t = Date.parse(m.startDate);
      const a = normP(m.participantAName);
      const b = normP(m.participantBName);
      // The schedule's time is when a game is due, not when it tips: a listed game can sit past its
      // time with no play-by-play yet. Only call it live once the league's feed has started (or the
      // schedule has hidden it, which it does while a game is being played).
      const due = t <= now;
      const raw = due ? await leagueLive(m.externalId) : null;
      const started = due && (Boolean(raw) || Boolean(m.hidden));
      const liveScore = started ? feedState(m.externalId, raw, t, now) : null;
      return {
        id: `h2h:${m.externalId}`,
        status: started ? 'started' : 'scheduled',
        late: due && !started,
        scheduledMs: t,
        liveScore,
        away: { team: m.teamAName, player: a, score: 0 },
        home: { team: m.teamBName, player: b, score: 0 },
        stream: m.streamName,
        lines: {},
        eval: await pairPregame(a, b),
      };
    }));
    return out.filter((u) => !(u.liveScore && (u.liveScore.done || u.liveScore.gone))).sort((x, y) => (x.status === y.status ? x.scheduledMs - y.scheduledMs : x.status === 'started' ? -1 : 1));
  }
  async function fillSchedule(board) {
    if (board.schedule && board.schedule.ok) return board;
    try {
      const games = await scheduleFromLeague(board);
      return { ...board, upcoming: games, schedule: { ok: true, count: games.length, via: 'browser' } };
    } catch (err) {
      return { ...board, schedule: { ok: false, count: 0, error: err.message } };
    }
  }

  async function loadBoard(manual = false) {
    if (S.loadingBoard) return;
    S.loadingBoard = true;
    if (manual) $('refreshBtn').classList.add('spin');
    try {
      S.board = await fillSchedule(await api(`/api/eb/board?${qparams()}`));
      S.boardAt = Date.now();
      const n = (S.board.live || []).length + (S.board.upcoming || []).filter((u) => u.status === 'started').length;
      $('feedBadge').className = 'live-pill';
      $('feedBadge').querySelector('b').textContent = `${n}`;
      $('feedBadge').title = `${n} live games`;
      if (S.view === 'board') renderBoard();
      loadProfiles(false).then(() => fillQuarters());
    } catch (err) {
      $('feedBadge').className = 'live-pill bad';
      $('feedBadge').querySelector('b').textContent = 'OFFLINE';
      if (manual || !S.board) toast(`Board: ${err.message}`);
    } finally {
      S.loadingBoard = false;
      setTimeout(() => $('refreshBtn').classList.remove('spin'), 400);
    }
  }

  // ---------- gamer profiles + fast-scorer alerts ----------
  // Built in the browser from the league's own results (last few days of finals from /h2h, quarter
  // splits from the play-by-play), so they stay fresh while the server part is paused.
  const GP = window.GGProfiles;
  const PF = {
    model: null, builtAt: 0, loading: false, err: null, sort: 'fast',
    q: store.get('ggp.q', {}), tried: new Set(),
    notify: store.get('ggp.notify', false), alerted: store.get('ggp.alerted', {}),
  };
  const PROFILE_DAYS = 21; // v3.9: three weeks of league results feed the gamer ratings (five days before); older days stay saved on the phone
  const PROFILE_FIRST = 5; // days loaded before the first numbers show; the rest fill in right behind
  const dayTime = (ms) => { try { return new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
  const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
  const schedMemo = new Map();
  async function scheduleDay(d, ttl = 15000) {
    const hit = schedMemo.get(d);
    if (hit && Date.now() - hit.at < ttl) return hit.rows;
    const r = await api(`/h2h/v1/schedule/nba?date=${encodeURIComponent(`${d}T00:00:00+00:00`)}`);
    if (!Array.isArray(r)) throw new Error('schedule shape');
    schedMemo.set(d, { at: Date.now(), rows: r });
    return r;
  }
  // finished days are kept on the phone, so only today (and a just-finished yesterday) is fetched again
  async function finalsForDay(d, now) {
    const done = Date.parse(`${d}T00:00:00Z`) + 86400000 + 60 * 60000 < now;
    if (done) {
      const kept = store.get(`ggp3.day.${d}`, null);
      if (Array.isArray(kept)) return kept.map(([id, t, a, b, sa, sb, ta, tb]) => ({ id, t, a, b, sa, sb, ta: ta || '', tb: tb || '' }));
    }
    const games = GP.fromSchedule(await scheduleDay(d, done ? 3600000 : 120000));
    if (done && games.length) store.set(`ggp3.day.${d}`, games.map((g) => [g.id, g.t, g.a, g.b, g.sa, g.sb, g.ta || '', g.tb || '']));
    return games;
  }
  function pruneStore(keepDays) {
    try {
      const keep = new Set(keepDays.map((d) => `ggp3.day.${d}`));
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('ggp.day.') || (k.startsWith('ggp3.day.') && !keep.has(k)))) localStorage.removeItem(k); // also clears the pre-v3.9 saves (no team names)
      }
    } catch { /* private mode */ }
  }
  const lastGoodDay = new Map();
  async function loadProfiles(force = false) {
    if (!GP || PF.loading) return;
    if (!force && PF.model && Date.now() - PF.builtAt < 120000) return;
    PF.loading = true;
    try {
      const now = Date.now();
      const days = [];
      for (let i = 0; i < PROFILE_DAYS; i += 1) days.push(dayStr(now - i * 86400000));
      let games = [];
      let missed = null; // the newest days could not be read (the league's source is turning the app away): the saved days still count
      for (let i = 0; i < days.length; i += 1) {
        const d = days[i];
        // (a day that cannot be read now keeps its last good read from this visit: today is only saved on the phone once it is over)
        try { const got = await finalsForDay(d, now); lastGoodDay.set(d, got); games = games.concat(got); } catch (err) { if (i < 2) missed = missed || err; games = games.concat(lastGoodDay.get(d) || []); }
        // first visit: show numbers from the newest days right away, then keep loading the older ones
        if (i === PROFILE_FIRST - 1 && !PF.model && games.length) {
          PF.model = GP.build(games, PF.q, { now }); PF.builtAt = now; PF.err = null; PF.partial = true;
          if (S.view === 'board') renderBoard();
          if (S.view === 'players') renderProfiles();
        }
      }
      PF.partial = false;
      if (missed && !games.length) throw missed;
      PF.stale = Boolean(missed);
      pruneStore(days);
      const ids = new Set(games.map((g) => g.id));
      for (const id of Object.keys(PF.q)) if (!ids.has(id)) delete PF.q[id];
      PF.model = GP.build(games, PF.q, { now });
      PF.builtAt = now;
      PF.err = null;
      fillQuarters();
    } catch (err) {
      PF.err = err.message;
    } finally {
      PF.loading = false;
    }
    if (S.view === 'board') renderBoard();
    if (S.view === 'players') renderProfiles();
  }
  // quarter splits for the gamers on the board right now: a few recent games each, a little at a time
  let qBusy = false;
  async function fillQuarters() {
    if (qBusy || !PF.model) return;
    const names = new Set();
    const b = S.board || {};
    for (const g of b.live || []) { names.add(normP(g.away?.player)); names.add(normP(g.home?.player)); }
    for (const u of b.upcoming || []) { names.add(normP(u.away?.player)); names.add(normP(u.home?.player)); }
    const want = [];
    for (const n of names) {
      const p = PF.model.players[n];
      if (!p) continue;
      const missing = (p.recentIds || []).filter((id) => !PF.q[id] && !PF.tried.has(id)).slice(0, 4);
      for (const id of missing) if (!want.includes(id)) want.push(id);
    }
    if (!want.length) return;
    qBusy = true;
    const todo = want.slice(0, 24);
    try {
      let i = 0;
      const worker = async () => {
        while (i < todo.length) {
          const id = todo[i++];
          PF.tried.add(id);
          try {
            const q = GP.quartersFromTimeline(await api(`/h2h/v1/timeline/?external_id=${encodeURIComponent(id)}`));
            if (q) PF.q[id] = q;
          } catch { /* skip this one */ }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      store.set('ggp.q', PF.q);
    } finally {
      qBusy = false;
    }
    PF.builtAt = 0; // rebuild with the new splits on the next round
    loadProfiles(true);
  }

  const tierChip = (p) => (!p ? '' : p.tier === 'blazing' ? '<span class="chip fire">🔥 Blazing</span>' : p.tier === 'fast' ? '<span class="chip hot">⚡ Fast</span>' : p.tier === 'slow' ? '<span class="chip">Slow</span>' : '');
  const formTxt = (p) => (!p || !p.last10 || !p.last10.n ? '' : p.hot ? `<span class="up-txt">▲ hot ${p.last10.ppg}</span>` : p.cold ? `<span class="down-txt">▼ cold ${p.last10.ppg}</span>` : `L10 ${p.last10.ppg}`);
  const clockTxt = (sc) => (sc && sc.q ? `${sc.q > 4 ? 'OT' : `Q${sc.q}`}${Number.isFinite(sc.clock) ? ` ${Math.floor(sc.clock / 60)}:${String(sc.clock % 60).padStart(2, '0')}` : ''}` : '');

  // Every game on the board (FanDuel's live list and the league's own schedule) with our profile numbers.
  function boardMatchups() {
    if (!PF.model) return [];
    const b = S.board || {};
    const out = [];
    for (const g of b.live || []) {
      const pre = GP.project(PF.model, g.away?.player, g.home?.player, g.away?.team, g.home?.team);
      const f = g.eval?.progress?.f || 0;
      const sc = g.status === 'live' ? { a: Number(g.away?.score) || 0, b: Number(g.home?.score) || 0, played: f * 1200, q: Math.min(4, Math.floor(f * 4) + 1) } : null;
      out.push({ id: `fd:${g.eventId}`, eventId: g.eventId, live: Boolean(sc), startMs: g.tipMs || g.scheduledMs, stream: 'on FanDuel', pre, sc, lv: sc ? GP.live(pre, sc) : null, onFanDuel: true });
    }
    for (const u of b.upcoming || []) {
      const pre = GP.project(PF.model, u.away?.player, u.home?.player, u.away?.team, u.home?.team);
      const sc = u.status === 'started' && u.liveScore && !u.liveScore.paused ? u.liveScore : null;
      out.push({ id: u.id, live: u.status === 'started', paused: Boolean(u.liveScore?.paused), startMs: u.scheduledMs, stream: u.stream, pre, sc, lv: sc ? GP.live(pre, sc) : null });
    }
    return out;
  }
  // Every GG League game gets plus-edge calls for the game, 1st half and quarter, and you can
  // type FanDuel's line to get an instant plus edge / no-play answer (FanDuel's own live list isn't
  // reaching the app, so its lines can't be matched automatically).
  const LN = (() => {
    const all = store.get('gg.fdLines', {}) || {};
    const cut = Date.now() - 6 * 3600000;
    for (const k of Object.keys(all)) if (!all[k] || !(all[k].at > cut)) delete all[k];
    return all;
  })();
  function lineGet(id) { return LN[id] || {}; }
  function lineSet(id, k, v, qName) {
    const L = { ...(LN[id] || {}) };
    if (isNum(v)) { L[k] = v; if (k === 'q') L.qName = qName; } else delete L[k];
    L.at = Date.now();
    if (Object.keys(L).some((x) => x === 'game' || x === 'h1' || x === 'q')) LN[id] = L; else delete LN[id];
    store.set('gg.fdLines', LN);
  }
  function callsFor(m) {
    if (!m || !m.pre) return [];
    const p = m.pre;
    const lv = m.lv;
    const rows = lv
      ? [
        { k: 'game', name: 'Game', proj: lv.total, over: lv.betBelow.game, under: lv.betAbove.game },
        { k: 'h1', name: '1H', proj: lv.h1, over: lv.betBelow.h1, under: lv.betAbove.h1 },
        { k: 'q', name: lv.quarterNo ? `Q${lv.quarterNo}` : 'Qtr', proj: lv.quarter, over: lv.betBelow.quarter, under: lv.betAbove.quarter },
      ]
      : [
        { k: 'game', name: 'Game', proj: p.total, over: p.betBelow.game, under: p.betAbove.game },
        { k: 'h1', name: '1H', proj: p.h1, over: p.betBelow.h1, under: p.betAbove.h1 },
        { k: 'q', name: 'Q1', proj: p.q[0], over: p.betBelow.q[0], under: p.betAbove.q[0] },
      ];
    return rows.filter((r) => isNum(r.proj) && isNum(r.over) && isNum(r.under));
  }
  function verdict(r, L) {
    const line = L ? L[r.k] : null;
    if (!isNum(line) || (r.k === 'q' && L.qName && L.qName !== r.name)) return null;
    if (line <= r.over) return { cls: 'over', txt: `PLUS EDGE ${line}`, why: `GG expects ${n1(r.proj)}, ${n1(r.proj - line)} ahead of FanDuel’s ${line}. More points than FanDuel expects, so this is the one to play.` };
    if (r.proj < line) return { cls: 'pass', txt: 'No plus edge', why: 'Our number is not ahead of this line. We only play lines our number is ahead of.' };
    return { cls: 'pass', txt: 'No play', why: `GG expects ${n1(r.proj)}, ahead of FanDuel’s ${line} but not by enough to trust. A line of ${r.over} or lower would be a plus edge.` };
  }
  function callsBox(m) {
    const rows = callsFor(m);
    if (!rows.length) return '';
    const L = lineGet(m.id);
    const has = rows.some((r) => verdict(r, L));
    const body = rows.map((r) => {
      const v = verdict(r, L);
      return `<div class="cl-row"><b>${esc(r.name)}</b><span class="cl-proj">GG ${n1(r.proj)}</span><span class="cl-o">Plus edge at ${r.over} or lower</span>${v ? `<span class="cl-v ${v.cls}">${esc(v.txt)}</span>` : ''}</div>`;
    }).join('');
    return `<div class="calls${has ? ' has-line' : ''}"><div class="cl-head"><span>GG calls · ${m.lv ? 'live' : m.live ? 'pregame numbers (feed paused)' : 'pregame'}</span><button class="cl-btn" type="button" data-line="${esc(m.id)}|${esc(m.pre.a)}|${esc(m.pre.b)}">${has ? 'Edit FanDuel line' : 'Type FanDuel line'}</button></div>${body}</div>`;
  }
  function openLines(id, a, b) {
    const m = matchupFor(id, a, b);
    if (!m) return;
    const rows = callsFor(m);
    const L = lineGet(id);
    openSheet(`<div class="mu-top"><span class="al-badge">FanDuel line</span><h3>${esc(m.pre.a)} vs ${esc(m.pre.b)}</h3><p class="muted small">Type the total FanDuel shows for each one you want. The call updates live as the game goes.</p></div>
      <div class="ln-form" data-ln="${esc(id)}|${esc(a)}|${esc(b)}">${rows.map((r) => `<div class="ln-row"><label for="ln-${r.k}"><b>${esc(r.name)}</b><span class="muted small" data-proj="${r.k}">GG ${n1(r.proj)}</span></label><input id="ln-${r.k}" type="number" inputmode="decimal" step="0.5" data-k="${r.k}" data-q="${esc(r.name)}" value="${isNum(L[r.k]) && !(r.k === 'q' && L.qName && L.qName !== r.name) ? L[r.k] : ''}" placeholder="e.g. ${r.over}"><span class="ln-out" data-out="${r.k}"></span></div>`).join('')}</div>
      <p class="muted small">PLUS EDGE when FanDuel’s line is at or below our plus-edge number (our projection minus a safety cushion). Any higher line is no play.</p>
      <button class="ghost-btn ln-clear" type="button">Clear these lines</button>`);
    const form = document.querySelector('#pfBody .ln-form');
    form.querySelectorAll('input[data-k]').forEach((inp) => {
      inp.oninput = () => {
        const v = inp.value.trim() === '' ? null : Number(inp.value);
        lineSet(id, inp.dataset.k, Number.isFinite(v) ? v : null, inp.dataset.q);
        paintLines();
        refreshCalls();
      };
    });
    const clr = document.querySelector('#pfBody .ln-clear');
    if (clr) clr.onclick = () => { delete LN[id]; store.set('gg.fdLines', LN); form.querySelectorAll('input').forEach((i) => { i.value = ''; }); paintLines(); refreshCalls(); };
    paintLines();
  }
  // Update only the result cells of an open line sheet, so typing is never interrupted by a refresh.
  function paintLines() {
    const form = document.querySelector('#pfBody .ln-form');
    if (!form) return;
    const [id, a, b] = form.dataset.ln.split('|');
    const m = matchupFor(id, a, b);
    const rows = callsFor(m);
    const L = lineGet(id);
    form.querySelectorAll('input[data-k]').forEach((inp) => {
      const r = rows.find((x) => x.k === inp.dataset.k);
      const out = form.querySelector(`[data-out="${inp.dataset.k}"]`);
      const pj = form.querySelector(`[data-proj="${inp.dataset.k}"]`);
      if (!r) { out.className = 'ln-out'; out.textContent = 'No GG number for this one right now.'; return; }
      if (pj) pj.textContent = `GG ${n1(r.proj)} · plus edge at ${r.over} or lower`;
      if (inp.dataset.k === 'q' && inp.dataset.q !== r.name) { out.className = 'ln-out'; out.textContent = `Now ${r.name}. Close and reopen to type the new quarter line.`; return; }
      const v = verdict(r, L);
      out.className = `ln-out${v ? ` ${v.cls}` : ''}`;
      out.innerHTML = v ? `<b>${esc(v.txt)}</b> ${esc(v.why)}` : '';
    });
  }
  function refreshCalls() {
    document.querySelectorAll('#view-board .calls .cl-btn').forEach((btn) => {
      const [id, a, b] = btn.dataset.line.split('|');
      const box = btn.closest('.calls');
      const m = matchupFor(id, a, b);
      const html = callsBox(m);
      if (box && html) { box.outerHTML = html; }
    });
    document.querySelectorAll('#view-board .up-call').forEach((chip) => {
      const id = chip.dataset.line.split('|')[0];
      const u = (S.board?.upcoming || []).find((x) => x.id === id);
      const html = u ? upCall(u) : '';
      if (html) chip.outerHTML = html;
    });
    wireCalls();
  }
  function wireCalls() {
    document.querySelectorAll('[data-line]').forEach((el) => {
      el.onclick = (e) => { e.stopPropagation(); haptic(); const [id, a, b] = el.dataset.line.split('|'); openLines(id, a, b); };
    });
  }
  // v3.6.1: high-scoring games are painted green everywhere, and the Board tab carries a green count.
  function hiRibbon(m) {
    const p = m.pre;
    return `<div class="hi-ribbon">${p.level >= 3 ? '🔥🔥' : p.level === 2 ? '🔥' : '⬆'} HIGH-SCORING GAME · GG ${n1(m.lv ? m.lv.total : p.total)}</div>`;
  }
  function setHiBadge(n) {
    document.querySelectorAll('.tabs [data-view="board"], .bottom-nav [data-view="board"]').forEach((b) => {
      let dot = b.querySelector('.hi-dot');
      if (!n) { if (dot) dot.remove(); b.classList.remove('has-hi'); return; }
      if (!dot) { dot = document.createElement('i'); dot.className = 'hi-dot'; b.appendChild(dot); }
      dot.textContent = n > 9 ? '9+' : String(n);
      dot.setAttribute('aria-label', `${n} high-scoring game${n === 1 ? '' : 's'}`);
      b.classList.add('has-hi');
    });
  }
  function alertList() {
    return boardMatchups().filter((m) => m.pre.level >= 1).sort((x, y) => (x.live === y.live ? (y.pre.level - x.pre.level) || (x.startMs - y.startMs) : x.live ? -1 : 1));
  }

  function lineRow(items, under) {
    const cells = items.filter(([, v]) => isNum(v)).map(([k, v]) => `<span><em>${k}</em><b>${v}</b></span>`).join('');
    void under; // plus edges only: no below-the-line numbers
    return cells ? `<div class="bet-below"><span class="lbl">Plus edge if FanDuel’s line is at or below</span><div class="bb-cells">${cells}</div></div>` : '';
  }
  function sideTag(p) {
    if (!p) return '';
    const bits = [p.rank ? `#${p.rank} of ${p.of}` : 'new', p.n ? `${p.ppg} a game` : ''].filter(Boolean).join(' · ');
    return `<span>${esc(bits)}</span>`;
  }
  function alertCard(m) {
    const p = m.pre;
    const lvCls = p.level >= 3 ? 'lvl3' : p.level === 2 ? 'lvl2' : 'lvl1';
    const mins = Math.round((m.startMs - Date.now()) / 60000);
    const when = m.live ? (m.paused ? 'live · feed paused' : `live · ${clockTxt(m.sc) || 'just tipped'}`) : mins > 0 ? `${hhmm(m.startMs)} · in ${mins}m` : `due ${hhmm(m.startMs)}`;
    const lv = m.lv;
    const head = `<div class="al-top"><span class="al-badge ${lvCls}">${p.level >= 3 ? '🔥🔥' : p.level === 2 ? '🔥' : '⬆'} ${esc(p.label)}</span><span class="al-when">${esc(when)}${m.stream ? ` · ${esc(m.stream)}` : ''}</span></div>`;
    const names = `<div class="al-names"><div>${avatar(p.a, 'sm')}<div class="nm"><b>${esc(p.a)}</b>${sideTag(p.A)}</div></div>
      <div class="al-mid">${m.sc ? `<div class="scoreline sm">${m.sc.a}<span class="c">:</span>${m.sc.b}</div>` : '<span class="c">VS</span>'}</div>
      <div class="right"><div class="nm"><b>${esc(p.b)}</b>${sideTag(p.B)}</div>${avatar(p.b, 'sm')}</div></div>`;
    let nums;
    let lines;
    if (lv) {
      const qn = lv.quarterNo;
      nums = `<div class="stat3 al-nums"><div class="tile hl"><div class="k">Game now</div><div class="v">${n1(lv.total)}</div></div><div class="tile"><div class="k">1st half</div><div class="v">${n1(lv.h1 ?? p.h1)}</div></div><div class="tile"><div class="k">${qn ? `Q${qn}` : 'Quarter'}</div><div class="v">${n1(lv.quarter ?? (qn ? p.q[qn - 1] : null))}</div></div></div>`;
      lines = lineRow([['Game', lv.betBelow.game], ['1H', lv.betBelow.h1], [qn ? `Q${qn}` : 'Qtr', lv.betBelow.quarter]]);
    } else {
      nums = `<div class="stat3 al-nums"><div class="tile hl"><div class="k">Game</div><div class="v">${n1(p.total)}</div></div><div class="tile"><div class="k">1st half</div><div class="v">${n1(p.h1)}</div></div><div class="tile"><div class="k">Q1</div><div class="v">${n1(p.q[0])}</div></div></div>`;
      lines = lineRow([['Game', p.betBelow.game], ['1H', p.betBelow.h1], ['Q1', p.betBelow.q[0]]]);
    }
    const fadeW = lv && lv.fade ? lv.fade[0] : null;
    const why = fadeW ? '' : lv ? lv.say.slice(-1)[0] : p.reasons[0] || '';
    if (fadeW) lines = `<p class="fade-note">📉 ${esc(fadeW.text)}</p>${lv ? moveTag(`al:${m.id}:mv`, lv.total, 'scoring picked up', 'scoring slowed') : ''}` + lines;
    else if (lv) lines = moveTag(`al:${m.id}:mv`, lv.total, 'scoring picked up', 'scoring slowed') + lines;
    if (!m.onFanDuel) lines = callsBox(m) || lines;
    return `<article class="card alert-card ${lvCls}${lv ? ` temp-${lv.temp}` : ''}${enterCls(`al:${m.id}`)}" data-mu="${esc(p.a)}|${esc(p.b)}|${esc(m.id)}">${head}${names}${nums}${lines}${why ? `<p class="al-why">${esc(why)}</p>` : ''}</article>`;
  }
  function renderAlerts() {
    const wrap = $('alertWrap');
    if (!wrap) return;
    if (!PF.model) {
      wrap.innerHTML = PF.err ? '' : '<div class="hud-head"><div><p class="eyebrow">🔥 FAST SCORER ALERTS</p><h2>Reading every gamer’s last 5 days…</h2></div></div>';
      return;
    }
    const list = alertList();
    setHiBadge(new Set(list.map((m) => m.id).concat(S.preHiIds || [])).size);
    const bell = typeof Notification === 'undefined' ? '' : `<button class="ghost-btn bell${PF.notify && Notification.permission === 'granted' ? ' on' : ''}" id="alertBell" type="button">${PF.notify && Notification.permission === 'granted' ? '🔔 Alerts on' : '🔕 Alert me'}</button>`;
    wrap.innerHTML = `<div class="hud-head hi-head"><div><p class="eyebrow">🔥 HIGH-SCORING ALERTS</p><h2>Fast scorers meeting <span class="count">${list.length}</span></h2></div>${bell}</div>
      ${list.length ? `<div class="alert-list">${list.slice(0, 8).map(alertCard).join('')}</div>` : `<div class="empty-line">No fast-scorer matchup in the next 75 minutes. We’ll flag it here as soon as one is on the schedule.</div>`}`;
    wrap.querySelectorAll('[data-mu]').forEach((el) => { el.onclick = () => { haptic(); const [a, b, id] = el.dataset.mu.split('|'); openMatchup(a, b, id); }; });
    wireCalls();
    const bellBtn = $('alertBell');
    if (bellBtn) bellBtn.onclick = toggleAlerts;
    notifyNew(list);
  }
  async function toggleAlerts() {
    haptic();
    if (PF.notify && Notification.permission === 'granted') {
      PF.notify = false;
      store.set('ggp.notify', false);
      toast('Phone alerts off. Fast-scorer games still show at the top of the board.');
    } else {
      let perm = Notification.permission;
      try { if (perm === 'default') perm = await Notification.requestPermission(); } catch { /* old browser */ }
      if (perm === 'granted') {
        PF.notify = true;
        store.set('ggp.notify', true);
        toast('Alerts on. You’ll get a buzz when fast scorers are about to meet, while GG Winner is open or in the background.', 5200);
      } else {
        toast('Your phone blocked alerts for this app. Turn notifications on for GG Winner in your phone’s settings, then tap again.', 5200);
      }
    }
    renderAlerts();
  }
  // Buzz once per game: when a fast-scorer game is 15 minutes out (or starts), and once more if it runs hot.
  function notifyNew(list) {
    const now = Date.now();
    let changed = false;
    for (const m of list) {
      if (m.pre.level < 2) continue;
      const soon = !m.live && m.startMs - now <= 15 * 60000 && m.startMs - now > -5 * 60000;
      const hot = m.live && m.lv && m.lv.temp === 'hot';
      const key = hot ? `${m.id}:hot` : m.id;
      if (!(soon || hot || m.live) || PF.alerted[key]) continue;
      PF.alerted[key] = now;
      changed = true;
      const p = m.pre;
      const title = hot ? `🔥 Running hot: ${p.a} vs ${p.b}` : `🔥 ${p.label}: ${p.a} vs ${p.b}`;
      const body = hot && m.lv
        ? `${m.sc.a}:${m.sc.b} ${clockTxt(m.sc)}. Game now ${n1(m.lv.total)}. Plus edge at a FanDuel line of ${m.lv.betBelow.game} or lower.`
        : `${m.live ? 'Live now' : `Starts ${hhmm(m.startMs)}`}${m.stream ? ` on ${m.stream}` : ''}. GG says game ${n1(p.total)}, 1st half ${n1(p.h1)}, Q1 ${n1(p.q[0])}. Plus edge at a FanDuel line of ${p.betBelow.game} or lower.`;
      toast(`${title}. ${body}`, 6000);
      try { navigator.vibrate && navigator.vibrate([60, 40, 60]); } catch { /* ignore */ }
      if (PF.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const opts = { body, tag: key, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: '/#board' } };
        const sw = navigator.serviceWorker;
        (sw ? sw.ready.then((r) => r.showNotification(title, opts)) : Promise.reject(new Error('no sw'))).catch(() => { try { new Notification(title, opts); } catch { /* ignore */ } });
      }
    }
    if (changed) {
      for (const [k, t] of Object.entries(PF.alerted)) if (now - t > 6 * 3600000) delete PF.alerted[k];
      store.set('ggp.alerted', PF.alerted);
    }
  }

  // In-game factors strip for a live card: each gamer's points so far against their usual rate.
  function factorsStrip(m) {
    const lv = m && m.lv;
    if (!lv) return '';
    const p = m.pre;
    const row = (name, s) => `<div class="fx-row"><b>${esc(name)}</b><span>${s.soFar} so far</span><span class="muted">usual ${n1(s.expectedSoFar)}</span><span class="${s.diff >= 2 ? 'up-txt' : s.diff <= -2 ? 'down-txt' : 'muted'}">${s.diff > 0 ? '▲ +' : s.diff < 0 ? '▼ ' : ''}${n1(s.diff)}</span></div>`;
    return `<div class="factors${p.level ? ' hi' : ''}"><div class="fx-head"><span>${p.level ? `${p.level >= 2 ? '🔥' : '⬆'} ${esc(p.label)} · ` : ''}Player factors</span><span class="temp ${lv.temp}">${lv.temp === 'hot' ? 'Running hot' : lv.temp === 'cold' ? 'Running cold' : 'Normal pace'}</span></div>
      ${row(p.a, lv.a)}${row(p.b, lv.b)}
      <div class="fx-proj"><span>GG live</span><b>Game ${n1(lv.total)}</b>${lv.h1 != null ? `<b>1H ${n1(lv.h1)}</b>` : ''}${lv.quarter != null ? `<b>Q${lv.quarterNo} ${n1(lv.quarter)}</b>` : ''}</div></div>`;
  }
  function matchupFor(id, a, b) {
    return boardMatchups().find((m) => m.id === id) || (PF.model ? { id, pre: GP.project(PF.model, a, b) } : null);
  }

  // ---------- Players tab ----------
  function profileRow(p) {
    return `<div class="pf-row${enterCls(`pf:${p.name}`)}" data-pf="${esc(p.name)}">
      <span class="pf-rank">${p.rank ? `#${p.rank}` : '—'}</span>
      ${avatar(p.name, 'sm')}
      <div class="pf-who"><b>${esc(p.name)} ${tierChip(p)}</b><span>${p.n} games · ${formTxt(p)}</span></div>
      <div class="pf-nums"><div><b>${n1(p.ppg)}</b><span>PTS</span></div><div><b>${n1(p.speed)}</b><span>/MIN</span></div><div><b>${n1(p.total)}</b><span>TOTAL</span></div></div>
    </div>`;
  }
  function renderProfiles() {
    const out = $('pfList');
    if (!out) return;
    if (!PF.model) {
      out.innerHTML = PF.err ? '<div class="empty-line">The league’s results aren’t reaching the app right now. Pull down to try again.</div>' : '<div class="skeleton tall"></div>';
      return;
    }
    const q = ($('pfSearch')?.value || '').trim().toUpperCase();
    let list = Object.values(PF.model.players).filter((p) => p.n >= 3 && (!q || p.name.includes(q)));
    const recentCut = Date.now() - 36 * 3600000;
    if (!q) list = list.filter((p) => p.lastAt >= recentCut);
    const by = {
      fast: (x, y) => (x.rank || 999) - (y.rank || 999),
      hot: (x, y) => (y.form || 0) - (x.form || 0),
      total: (x, y) => y.total - x.total,
      n: (x, y) => y.n - x.n,
    }[PF.sort] || (() => 0);
    list.sort(by);
    const L = PF.model.league;
    $('pfNote').textContent = `${PF.stale ? 'The league’s newest results are not reaching the app right now, so these numbers use the results already saved on this phone. ' : ''}Built from ${PF.model.games} official GG League games from the last ${PROFILE_DAYS} days${PF.partial ? ' (older days still loading)' : ''} (${L.qGames} with quarter splits so far). League average: ${L.ppg} points per gamer, ${L.total} per game. "Fast" = top 30% for points per game, "Blazing" = top 12%. Newer games count more.${PF.model.ratings ? ' Projections weigh who each gamer played, which NBA team each one is using, and how the two have done against each other. Tested on 7,800 past games: average miss on the game total 9.3 points (10.2 before this update), right winner 58% of the time (54% before).' : ''}`;
    out.innerHTML = list.length ? list.slice(0, 80).map(profileRow).join('') : '<div class="empty-line">No gamer matches that.</div>';
    out.querySelectorAll('[data-pf]').forEach((el) => { el.onclick = () => { haptic(); openProfile(el.dataset.pf); }; });
  }
  function qTable(q, label = 'Quarter') {
    if (!q) return '<p class="muted small">Quarter splits load in the background for gamers on the board. Check back in a minute.</p>';
    return `<table class="pf-table"><thead><tr><th>${esc(label)}</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>1H</th></tr></thead><tbody>
      <tr><td>Scores</td>${q.for.map((v) => `<td>${n1(v)}</td>`).join('')}<td>${n1(q.h1For)}</td></tr>
      <tr><td>Allows</td>${q.against.map((v) => `<td>${n1(v)}</td>`).join('')}<td>${n1(q.against[0] + q.against[1])}</td></tr>
      <tr class="tot"><td>Total</td>${q.total.map((v) => `<td>${n1(v)}</td>`).join('')}<td>${n1(q.h1)}</td></tr></tbody></table>
      <p class="muted small">From their last ${q.n} games with play-by-play. Best quarter: Q${q.best}.</p>`;
  }
  function openSheet(html) {
    const dlg = $('pfSheet');
    $('pfBody').innerHTML = html;
    if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } }
    $('pfBody').querySelectorAll('[data-pf]').forEach((el) => { el.onclick = () => { haptic(); openProfile(el.dataset.pf); }; });
    $('pfBody').querySelectorAll('[data-mu]').forEach((el) => { el.onclick = () => { haptic(); const [a, b, id] = el.dataset.mu.split('|'); openMatchup(a, b, id); }; });    wireCalls();
  }
  function openProfile(name) {
    if (!PF.model) return;
    const p = PF.model.players[normP(name)];
    if (!p) { toast(`No recent games for ${name}.`); return; }
    const games = p.recent.map((g) => `<div class="pf-game"><span>${dayTime(g.t)}</span><b>vs ${esc(g.opp)}</b><span class="${g.for > g.against ? 'up-txt' : 'down-txt'}">${g.for}:${g.against}</span><span class="muted">${g.for + g.against}</span></div>`).join('');
    const pairs = [];
    for (const [k, list] of PF.model.pairs) {
      if (list.length < 2 || !k.split('|').includes(p.name)) continue;
      const opp = k.split('|').find((x) => x !== p.name) || p.name;
      pairs.push({ opp, n: list.length, avg: list.reduce((s, g) => s + g.total, 0) / list.length });
    }
    pairs.sort((x, y) => y.avg - x.avg);
    const upNext = boardMatchups().filter((m) => m.pre.a === p.name || m.pre.b === p.name);
    openSheet(`<div class="pf-head">${avatar(p.name)}<div><h3>${esc(p.name)} ${tierChip(p)}</h3><p class="muted small">${p.rank ? `#${p.rank} fastest scorer of ${p.of} active gamers` : 'Not ranked yet (few games)'} · ${p.n} games in ${PROFILE_DAYS} days</p></div></div>
      <div class="stat4"><div class="tile hl"><div class="k">Points</div><div class="v">${n1(p.ppg)}</div></div><div class="tile"><div class="k">Allows</div><div class="v">${n1(p.opp)}</div></div><div class="tile"><div class="k">Game total</div><div class="v">${n1(p.total)}</div></div><div class="tile"><div class="k">Per min</div><div class="v">${n1(p.speed)}</div></div></div>
      <p class="pf-say">${p.last10.n ? `Last ${p.last10.n} games: ${p.last10.ppg} points a game, ${p.last10.total} total. ${p.hot ? `That’s ${p.form} above their usual, so they’re hot right now.` : p.cold ? `That’s ${Math.abs(p.form)} below their usual, so they’re cold right now.` : 'About their usual.'}` : ''} ${Math.round(p.highRate * 100)}% of their games went ${Math.round(PF.model.league.total + 8)}+ total.</p>
      ${upNext.length ? `<h4>On the board now</h4>${upNext.map((m) => `<div class="pf-game link" data-mu="${esc(m.pre.a)}|${esc(m.pre.b)}|${esc(m.id)}"><span>${m.live ? 'LIVE' : hhmm(m.startMs)}</span><b>${esc(m.pre.a === p.name ? m.pre.b : m.pre.a)}</b><span>GG ${n1(m.pre.total)}</span><span>${m.pre.level ? '🔥' : ''}</span></div>`).join('')}` : ''}
      <h4>By quarter</h4>${qTable(p.q)}
      <h4>Last 10 games</h4><div class="pf-games">${games}</div>
      ${pairs.length ? `<h4>Highest-scoring opponents</h4><div class="pf-games">${pairs.slice(0, 6).map((x) => `<div class="pf-game link" data-pf="${esc(x.opp)}"><span>${x.n}×</span><b>vs ${esc(x.opp)}</b><span>avg ${n1(x.avg)}</span><span></span></div>`).join('')}</div>` : ''}`);
  }
  function openMatchup(a, b, id) {
    const m = matchupFor(id, a, b);
    if (!m) return;
    const p = m.pre;
    const lv = m.lv;
    const side = (x) => `<div class="mu-side"><div class="pf-link" data-pf="${esc(x.name)}">${avatar(x.name, 'sm')}<b>${esc(x.name)}</b></div>${tierChip(x)}
      <div class="mu-kv"><span>Rank</span><b>${x.rank ? `#${x.rank}/${x.of}` : '—'}</b><span>Points</span><b>${n1(x.ppg)}</b><span>Allows</span><b>${n1(x.opp)}</b><span>Per min</span><b>${n1(x.speed)}</b><span>Last 10</span><b>${x.last10?.n ? n1(x.last10.ppg) : '—'}</b><span>1st half</span><b>${x.q ? n1(x.q.h1For) : '—'}</b></div></div>`;
    const proj = `<table class="pf-table"><thead><tr><th></th><th>Game</th><th>1H</th><th>2H</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th></tr></thead><tbody>
      <tr class="tot"><td>GG</td><td>${n1(p.total)}</td><td>${n1(p.h1)}</td><td>${n1(p.h2)}</td>${p.q.map((v) => `<td>${n1(v)}</td>`).join('')}</tr>
      <tr><td>Plus edge at</td><td>${p.betBelow.game}</td><td>${p.betBelow.h1}</td><td>${p.betBelow.h2}</td>${p.betBelow.q.map((v) => `<td>${v}</td>`).join('')}</tr></tbody></table>
      <p class="muted small">“Plus edge at” = the highest FanDuel line our number is still far enough ahead of to play. It’s our projection minus a safety cushion, so any FanDuel line at or below it is a plus edge. League average game: ${n1(p.leagueTotal)}.</p>`;
    const h2h = p.pair ? `<h4>Head to head (${p.pair.n} games, avg ${n1(p.pair.avg)})</h4><div class="pf-games">${p.pair.last.map((g) => `<div class="pf-game"><span>${dayTime(g.t)}</span><b>${esc(g.a)} ${g.sa}:${g.sb} ${esc(g.b)}</b><span>${g.total}</span><span></span></div>`).join('')}</div>` : '<p class="muted small">They haven’t met in the last few days.</p>';
    const liveBlock = lv ? `<h4>In-game factors · ${esc(clockTxt(m.sc))}</h4>${factorsStrip(m)}${m.onFanDuel ? lineRow([['Game', lv.betBelow.game], ['1H', lv.betBelow.h1], [lv.quarterNo ? `Q${lv.quarterNo}` : 'Qtr', lv.betBelow.quarter]], [['Game', lv.betAbove.game], ['1H', lv.betAbove.h1], [lv.quarterNo ? `Q${lv.quarterNo}` : 'Qtr', lv.betAbove.quarter]]) : ''}<ul class="why-list">${lv.say.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '';
    openSheet(`<div class="mu-top">${p.level ? `<span class="al-badge ${p.level >= 3 ? 'lvl3' : p.level === 2 ? 'lvl2' : 'lvl1'}">${p.level >= 3 ? '🔥🔥' : p.level === 2 ? '🔥' : '⬆'} ${esc(p.label)}</span>` : '<span class="al-badge">Matchup</span>'}<h3>${esc(p.a)} vs ${esc(p.b)}</h3><p class="muted small">${m.live ? 'Live now' : m.startMs ? `Starts ${hhmm(m.startMs)}` : ''}${m.stream ? ` · ${esc(m.stream)}` : ''}</p></div>
      ${liveBlock}
      ${m.sc || m.id ? (m.onFanDuel ? '' : callsBox(m)) : ''}
      <div class="mu-grid">${side(p.A)}${side(p.B)}</div>
      <h4>Pregame numbers</h4>${proj}
      ${p.reasons.length ? `<ul class="why-list">${p.reasons.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      ${h2h}`);
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
        <span class="o" style="left:${prevL}%" data-anim="${key}:ol" data-prop="left" data-to="${labelPos}"><b>${n1(mean)}</b>GG</span>
      </div></div>`;
  }

  function marketPanel(m, ev) {
    const call = isCall(m) ? m.call : null;
    const tiles = m.mean == null && m.full != null
      ? `<div class="tile"><div class="k">FanDuel</div><div class="v">${m.line ?? '—'}</div></div><div class="tile hl"><div class="k">Full Q exp</div><div class="v">${n1(m.full)}</div></div><div class="tile"><div class="k">So far</div><div class="v">—</div></div>`
      : `<div class="tile"><div class="k">FanDuel</div><div class="v">${m.line ?? '—'}<small>${m.line != null ? odds(m.overOdds) : ''}</small></div></div>
         <div class="tile hl"><div class="k">GG proj</div><div class="v">${tween(`mk:${S.selected}:${m.id}`, m.fair ?? m.mean)}</div></div>
         <div class="tile"><div class="k">Edge</div><div class="v ${m.gap > 0 ? 'pos' : ''}">${edgeTxt(m.gap)}</div></div>`;
    const extras = [];
    if (m.last10) {
      const g10 = m.line != null ? m.last10.avg - m.line : null;
      const agree = g10 != null && m.gap != null && Math.sign(g10) === Math.sign(m.gap) && Math.abs(g10) >= 2;
      extras.push(`<div class="tip">📋 <b>Last-10 1H check:</b> ${esc(m.last10.away)} + ${esc(m.last10.home)} → <b>${n1(m.last10.avg)}</b>${g10 != null ? ` (gap ${sign(g10)}) — ${agree ? 'agrees with the model ✅' : 'doesn’t confirm'}` : ''}</div>`);
    }
    if (m.id.startsWith('q') && m.soFar != null) extras.push(`<div class="tip">Quarter points so far: <b>${m.soFar}</b>. ${esc(m.note || '')}</div>`);
    else if (m.id.startsWith('q') && m.note) extras.push(`<div class="tip">${esc(m.note)}</div>`);
    return `<article class="card market ${call ? `call-${cls(call)}` : ''}">
      <div class="market-top"><h3>${esc(m.label)}</h3><span class="verdict ${cls(call)}">${call ? `PLUS EDGE ${m.line}` : 'No play'}</span></div>
      <div class="stat3">${tiles}</div>
      ${gapbar(`mk:${S.selected}:${m.id}:gb`, m.gap)}
      <p class="say">${friendly(m, ev.progress.f)}</p>
      ${extras.join('')}
      ${m.line != null ? `<details class="fine"><summary>Price details</summary><div class="fine-grid">
        <span>FanDuel price</span><b>${odds(m.overOdds)}</b>
        <span>FanDuel’s chance it beats the line</span><b>${pct(m.fdOver)}</b>
        <span>GG chance it beats the line</span><b>${pct(m.pOver)}</b>
        <span>Player history alone / gap</span><b>${n1(m.mean)} / ${edgeTxt(m.rawGap)}</b>
        ${m.lateKeep != null ? `<span>Late-game correction</span><b>${Math.round(m.lateKeep * 100)}% of the points still expected</b>` : ''}
        <span>Trust model vs FanDuel</span><b>${m.weight != null ? `${Math.round(m.weight * 100)}% / ${100 - Math.round(m.weight * 100)}%` : '—'}</b>
        <span>Long-run return per $100</span><b>${evPct(m.evOver)}</b>
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
      ${gauge(`${key}:g`, gm.fair ?? gm.mean, gm.line)}`;
    const best = ev.best;
    $('callHero').innerHTML = best
      ? `<div class="call-hero ${cls(best.call)}"><div><div class="mk">The call · ${esc(best.label)}</div><div class="big">${callTxt(best)}</div></div>${meter(best)}<p>${friendly(best, ev.progress.f)} Price ${odds(best.overOdds)} · long-run return ${evPct(best.ev)} per $100.</p></div>`
      : `<div class="call-hero"><div><div class="mk">The call</div><div class="big" style="color:var(--muted)">NO PLAY</div></div>${meter(null)}<p>${friendly(gm, ev.progress.f)} We’ll flag it the moment our number gets ${S.settings.edge} points ahead of a FanDuel line.</p></div>`;
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
      <div class="row"><span>GG projection</span><b>${n1(gm.fair ?? gm.mean)}</b></div>
      <div class="row"><span>Model number (player history)</span><b>${n1(gm.mean)}</b></div>
      ${gm.lateKeep != null ? `<div class="row"><span>Late-game correction</span><b>keeps ${Math.round(gm.lateKeep * 100)}% of the points still expected</b></div>` : ''}
      <div class="row"><span>Pregame number</span><b>${n1(pre.expected)}</b></div>
      <div class="row"><span>Built from</span><b>${esc(pre.blendNote)}</b></div>
      <div class="row"><span>Ratings split</span><b>${n1(pre.away)} + ${n1(pre.home)}</b></div>
      <div class="row"><span>FanDuel opener</span><b>${g.opening ?? '—'}</b></div>
      <div class="row"><span>Live pace (per game)</span><b>${n1(ev.rate.pacePer20)}</b></div>
      <div class="row"><span>Blended pace</span><b>${n1(ev.rate.total)}</b></div>
      <div class="row"><span>Game clock</span><b>${Math.round(ev.progress.f * 100)}% · ${ev.progress.minutes}m since tip</b></div>
      <div class="row"><span>Clock check</span><b>${esc({ 'market-confirmed': 'FanDuel quarter markets ✓', 'market-corrected': 'Corrected by quarter markets', 'quarter-confirmed': 'Quarter ✓', 'quarter-corrected': 'Corrected by quarter', 'clock-estimate': 'Tip time', 'score-estimate': 'Score (tip time not posted)', overtime: 'Overtime', pregame: 'Pregame' }[ev.progress.source] || ev.progress.source)}${ev.progress.window ? ` · ${esc(ev.progress.window)}` : ''}</b></div>
      <div class="row"><span>Trust ours vs FanDuel</span><b>${mw}% / ${100 - mw}%</b></div>
      <div class="tip">FanDuel’s live line jumps too far on hot and cold starts; the gamers’ scoring history holds up better. GG blends both, trusting each by how accurate it has been at this point of the game.</div>
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
    const ORD = ['', '1st', '2nd', '3rd', '4th'];
    const legend = `<p class="roster-key">Big number = total points we expect when they play an average gamer. League average is about ${Math.round(mu)}. <b class="k-hi">High scoring</b> means 4+ above that, <b class="k-lo">Low scoring</b> 4+ below. Tap a gamer to add them to the check above.</p>`;
    $('playerTable').innerHTML = legend + list.slice(0, 80).map((p) => {
      const d = p.vsAvgTotal - mu;
      const pace = d > 4 ? ['fast', 'High scoring'] : d < -4 ? ['slow', 'Low scoring'] : ['mid', 'Average'];
      const facts = [`Scores ${Math.round(p.avgFor)}, allows ${Math.round(p.avgAgainst)}`];
      if (p.bestQuarter) facts.push(`best in the ${ORD[p.bestQuarter]} quarter`);
      const facts2 = [`${p.n} games played`];
      if (isNum(p.last10Half)) facts2.push(`last 10 first halves: ${Math.round(p.last10Half)} pts`);
      return `<div class="gamer-row" data-player="${esc(p.name)}">${avatar(p.name, 'sm')}
        <div class="gr-main"><div class="gr-top"><b>${esc(p.name)}</b><span class="pace-pill ${pace[0]}">${pace[1]}</span></div><div class="meta">${facts.join(' · ')}</div><div class="meta dim">${facts2.join(' · ')}</div></div>
        <div class="val">${Math.round(p.vsAvgTotal)}<span>typical game</span></div></div>`;
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

  // Plain-words call for one FanDuel line in the Matchup Lab.
  function labCall(label, p, ours) {
    if (!p || p.line == null) return '';
    const line = Number(p.line);
    const exp = isNum(p.mean) ? Number(p.mean) : Number(ours);
    const diff = Math.abs(exp - line);
    const moreLess = exp >= line ? 'more' : 'fewer';
    const c = isCall(p) ? p.call : null;
    if (c) {
      const chance = isNum(p.pOver) ? p.pOver : null;
      return `<div class="lab-call ${cls(c)}"><div class="lc-head"><span class="lc-label">${label}</span><span class="lc-pick">PLUS EDGE ${line}</span></div>
        <p>We expect about <b>${n1(exp)}</b> points, <b>${n1(diff)} ahead</b> of FanDuel's line of ${line}. That's a plus edge: more points than FanDuel expects.${chance != null ? ` Chance it beats ${line}: <b>${pct(chance)}</b>.` : ''}</p></div>`;
    }
    const reason = String(p.reason || '');
    const em = reason.match(/under\s+(\d+(?:\.\d+)?)/i);
    const edge = em ? em[1] : S.settings.edge;
    let why;
    if (/suspend/i.test(reason)) why = 'FanDuel has this line paused right now.';
    else if (/Below the line/i.test(reason) || (Number.isFinite(Number(exp)) && Number.isFinite(Number(line)) && Number(exp) <= Number(line))) why = 'Our number is not ahead of this line, so there is no plus edge here. We only play plus edges.';
    else if (/ratings may be off/i.test(reason)) why = `Player history says about ${n1(exp)}, but FanDuel says ${line}. A gap that big usually means our numbers on this pair are off, so we sit this one out.`;
    else if (/Edge under|Gap under/i.test(reason)) {
      why = p.rawGap !== undefined
        ? `We expect about ${n1(exp)}. After weighing FanDuel's own number, we're only ${n1(Math.abs(p.gap))} points apart. Too close to call.`
        : `We expect about ${n1(exp)}, only ${n1(diff)} ${moreLess} than FanDuel's ${line}. We need a gap of ${edge} or more to make a call.`;
    } else if (/Price/i.test(reason)) why = `We expect about ${n1(exp)} vs FanDuel's ${line}, but the odds FanDuel offers take away the edge.`;
    else why = `We expect about ${n1(exp)} vs FanDuel's ${line}.${reason ? ` ${esc(reason.replace(/\bunder\b/gi, 'below').replace(/\bover\b/gi, 'above'))}.` : ''}`;
    return `<div class="lab-call pass"><div class="lc-head"><span class="lc-label">${label}</span><span class="lc-pick">NO BET ${line}</span></div><p>${why}</p></div>`;
  }

  // If these two gamers are on FanDuel's live board right now, use its lines.
  function boardLinesFor(a, b) {
    const A = a.toUpperCase();
    const B = b.toUpperCase();
    const g = (S.board?.live || []).find((x) => {
      const p1 = String(x.away?.player || '').toUpperCase();
      const p2 = String(x.home?.player || '').toUpperCase();
      return (p1 === A && p2 === B) || (p1 === B && p2 === A);
    });
    if (!g) return null;
    const ln = (m) => (m && isNum(m.line) ? Number(m.line) : null);
    const game = ln(g.lines?.game);
    const half = ln(g.lines?.half1);
    return game == null && half == null ? null : { game, half };
  }

  async function runLab() {
    const a = $('labA').value.trim();
    const b = $('labB').value.trim();
    if (!a || !b) return;
    let filled = false;
    if (!$('labLine').value.trim() && !$('labHalf').value.trim()) {
      const bl = boardLinesFor(a, b);
      if (bl) {
        if (bl.game != null) $('labLine').value = bl.game;
        if (bl.half != null) $('labHalf').value = bl.half;
        filled = true;
      }
    }
    const qs = new URLSearchParams({ a, b, line: $('labLine').value.trim(), half1: $('labHalf').value.trim(), edge: S.settings.edge });
    $('labOut').innerHTML = '<div class="skeleton tall"></div>';
    try {
      const r = await api(`/api/eb/matchup?${qs}`);
      const A = a.toUpperCase();
      const B = b.toUpperCase();
      const ph = r.priceHalf;
      const q = r.quarters || [];
      const ORD = ['1st', '2nd', '3rd', '4th'];
      const half2 = q.length === 4 ? q[2] + q[3] : null;
      const noLines = !r.priceGame && !ph;

      const why = [];
      why.push(`We expect ${esc(A)} to score about <b>${n1(r.pregame.away)}</b> and ${esc(B)} about <b>${n1(r.pregame.home)}</b>, based on every game they've played.`);
      if (r.h2h?.meetings) {
        const adj = r.pregame.pair?.adj;
        const adjTxt = isNum(adj) && Math.abs(adj) >= 0.1
          ? ` We ${adj < 0 ? 'took' : 'added'} ${n1(Math.abs(adj))} ${adj < 0 ? 'points off' : 'points'} for this pairing.`
          : '';
        why.push(`They've played each other ${r.h2h.meetings} time${r.h2h.meetings === 1 ? '' : 's'} lately, averaging <b>${n1(r.h2h.avgTotal)}</b> total points.${adjTxt}`);
      } else {
        why.push('They haven’t played each other recently, so this is based on each gamer’s own games.');
      }
      if (isNum(r.last10Half)) {
        let check = '';
        if (ph && ph.line != null) {
          const g10 = r.last10Half - ph.line;
          const agree = isCall(ph) && Math.sign(g10) === Math.sign((isNum(ph.mean) ? ph.mean : r.half1) - ph.line) && Math.abs(g10) >= 2;
          check = agree ? ' That backs up our 1st-half call.' : (isCall(ph) ? ' That doesn’t back up our 1st-half call, so be careful.' : '');
        }
        why.push(`In their last 10 games, the 1st half averaged <b>${n1(r.last10Half)}</b> points.${check}`);
      } else {
        const missing = [[A, r.gamers?.a], [B, r.gamers?.b]].filter(([, g]) => !g?.profile?.last10Half).map(([n]) => n);
        if (missing.length) why.push(`We don't have quarter-by-quarter scores for ${esc(missing.join(' or '))} yet, so we can't check recent 1st halves.`);
      }

      $('labOut').innerHTML = `<div class="lab-res">
        <div class="vs-row" style="margin-bottom:4px"><div class="side">${avatar(a)}<div class="nm"><b>${esc(A)}</b><span>about ${n1(r.pregame.away)} pts</span></div></div><div class="vs-badge">VS</div><div class="side right">${avatar(b)}<div class="nm"><b>${esc(B)}</b><span>about ${n1(r.pregame.home)} pts</span></div></div></div>
        ${filled ? '<p class="lab-note">Filled in FanDuel’s live lines for this game.</p>' : ''}
        ${labCall('Full game', r.priceGame, r.pregame.expected)}
        ${labCall('1st half', ph, r.half1)}
        ${noLines ? '<div class="lab-hint"><b>Want a plus-edge call?</b> Type FanDuel’s game total and 1st-half line in the boxes above, then tap Run the numbers.</div>' : ''}
        <div class="lab-sec"><h5>Our projection</h5>
          <div class="proj-rows">
            <div class="pr main"><span>Full game total</span><b>${tween('lab:t', r.pregame.expected)} pts</b></div>
            <div class="pr"><span>1st half (Q1 + Q2)</span><b>${tween('lab:h', r.half1)} pts</b></div>
            ${half2 != null ? `<div class="pr"><span>2nd half (Q3 + Q4)</span><b>${n1(half2)} pts</b></div>` : ''}
          </div>
          <div class="q-strip">${q.map((v, i) => `<div class="qt"><span>${ORD[i]} qtr</span><b>${n1(v)}</b></div>`).join('')}</div>
        </div>
        <div class="lab-sec"><h5>Why we think so</h5><ul class="lab-why">${why.map((w) => `<li>${w}</li>`).join('')}</ul></div>
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
      // "Ours" is the number the app shows (GG proj). The server's own table grades its raw number (player history + score), which
      // the app never shows alone, so the game rows are worked out here from the graded games with today's rules (gg-live.js).
      let card = null;
      if (window.GGLive) {
        try {
          // (the graded list is large and changes slowly: asked for at most every five minutes, not on every refresh of this screen)
          const kept = S.gradedKept && S.gradedKept.days === S.perfDays && Date.now() - S.gradedKept.at < 300000 ? S.gradedKept : null;
          const gr = kept ? kept.data : await api(`/api/eb/graded?days=${S.perfDays}`);
          if (!kept && gr && Array.isArray(gr.graded)) S.gradedKept = { days: S.perfDays, at: Date.now(), data: gr };
          const sent = p.tracking && p.tracking.lastRun && p.tracking.lastRun.phaseWeights; // (sent only in the runs that re-learn them)
          const c = window.GGLive.reportCard(gr && gr.graded, Array.isArray(sent) ? sent : store.get('gg-phase-w', null));
          if (c && c.rows.length) card = c;
        } catch { /* the server's table is shown instead */ }
      }
      const accRow = (label, n, ours, fd) => `<tr><td>${label}</td><td>${n}</td><td class="${fd != null && ours <= fd ? 'pos' : ''}">${n1(ours)}</td><td>${fd != null ? n1(fd) : '—'}</td></tr>`;
      const cardLabel = (r) => (r.key === 'all' ? 'Game, before the tip (every game)' : r.key === 'pre' ? 'Game, before the tip (FanDuel line up early)' : `Game, about ${Math.round(r.f * 100)}% played`);
      const acc = card
        ? card.rows.map((r) => accRow(cardLabel(r), r.n, r.ours, r.fanduel)).join('') + p.accuracy.filter((a) => a.market !== 'game').map((a) => accRow(`1H @ ${a.checkpoint === 0 ? 'pregame' : `${a.checkpoint}%`}`, a.n, a.modelMae, a.lineMae)).join('')
        : p.accuracy.map((a) => accRow(`${a.market === 'game' ? 'Game' : '1H'} @ ${a.checkpoint === 0 ? 'pregame' : `${a.checkpoint}%`}`, a.n, a.modelMae, a.lineMae)).join('');
      const accNote = card
        ? 'Ours is the number the app shows (GG proj), graded with the rules it uses today. FanDuel is its line at the same moment. The same two gamers, meeting again within a week, finish 12.5 points apart on average (5,386 pairs of meetings): the closest any number can come before the tip is a miss of about 9.'
        : 'Here "ours" is the model alone (player history and the score so far), before it is mixed with FanDuel’s line into the number the app shows.';
      const recent = p.recent.slice(0, 20).map((s) => `<div class="res"><span class="badge ${s.result}">${s.result}</span>
        <div><b>${esc(String(s.name || '').replace(/^[^(]*\(([^)]+)\)[^(]*\(([^)]+)\).*$/, '$1 vs $2'))}</b><div class="meta">${esc(s.label)} · ${/^o/i.test(String(s.side || '')) ? 'above' : /^u/i.test(String(s.side || '')) ? 'below' : 'line'} ${s.line} (${odds(s.odds)}) · ${esc(String(s.note || '').replace(/\bunder\b/gi, 'below').replace(/\bover\b/gi, 'above'))}</div></div>
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
        ${acc ? `<p class="section-title">Average miss vs the final (lower is better)</p><div class="card pad"><table class="tbl"><thead><tr><th>Market</th><th>Games</th><th>Ours</th><th>FanDuel</th></tr></thead><tbody>${acc}</tbody></table><p class="muted small" id="accNote" style="margin:10px 0 0">${accNote}</p></div>` : ''}
        ${recent ? `<p class="section-title">Latest graded calls</p><div class="res-list">${recent}</div>` : ''}
        <p class="footnote">${tr ? `Tracking ${tr.active} live · ${tr.awaitingGrade} awaiting official finals · last run ${tr.lastRun ? new Date(tr.lastRun.at).toLocaleTimeString() : '—'}` : 'Tracker hasn’t run yet — it starts with the first Netlify scheduled run.'}</p>`;
      animate($('perfOut'));
    } catch (err) {
      $('perfOut').innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    }
  }

  // ---------- leagues ----------
  // Every real league FanDuel lists live (Sweden, Croatia, Spain women, Bahrain...), not just a fixed few.
  // league-live.js does the projections from the list row, so other leagues work even when the server
  // can't open them yet.
  const LL = window.LeagueLive || null;
  const LG_ORD = ['1st', '2nd', '3rd', '4th'];
  const lgLive = (g) => g.status === 'in_progress' || g.status === 'halftime';
  const lgKey = (g) => (LL ? LL.leagueKey(g) : g.leagueId);
  const lgName = (g) => (LL ? LL.leagueLabel(g) : (g.leagueAbbrev || g.leagueId || ''));
  const lgLineOf = (x) => (x && typeof x === 'object' ? x.line : x);
  const lgVal = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? '' : String(Number(x)));

  // FanDuel's game total when we first saw each game: the steadiest "what should this game score" number.
  function lgRememberFirstLines(games) {
    const seen = store.get('lg-first-lines', {});
    const now = Date.now();
    let changed = false;
    for (const g of games) {
      const line = Number(g.fdTotal?.line);
      if (!seen[g.id] && Number.isFinite(line) && line > 0) {
        // FanDuel only lists a game once it is live, so this first line usually already has the score so far inside it.
        // Keep where the game stood at that moment: the model then spreads only the points still to come (v3.10).
        const rec = { line, at: now };
        try {
          if (LL && lgLive(g)) { const p = LL.progress(g, { prior: line }); if (p && p.elapsed > 0.5 && !(p.pts === 0 && p.elapsed > 3)) { rec.pts = p.pts; rec.el = Math.round(p.elapsed * 100) / 100; rec.diff = Math.abs((Number(g.home?.score) || 0) - (Number(g.away?.score) || 0)); } }
        } catch (_) { /* keep the plain line */ }
        seen[g.id] = rec; changed = true;
      }
    }
    const keys = Object.keys(seen);
    for (const k of keys) if (now - (seen[k].at || 0) > 2 * 864e5) { delete seen[k]; changed = true; }
    const left = Object.keys(seen);
    if (left.length > 300) { left.sort((a, b) => seen[a].at - seen[b].at).slice(0, left.length - 300).forEach((k) => delete seen[k]); changed = true; }
    if (changed) store.set('lg-first-lines', seen);
    return seen;
  }
  const lgPrior = (g) => store.get('lg-first-lines', {})[g.id]?.line;
  // where the game stood when that first line was seen (null when it was seen before tip-off)
  const lgSeen = (g) => { const r = store.get('lg-first-lines', {})[g.id]; return r && r.el > 0 ? { pts: r.pts, elapsed: r.el, diff: r.diff } : null; };

  function lgFilters() {
    const by = new Map();
    for (const g of S.lg.games) {
      const k = lgKey(g);
      if (!by.has(k)) by.set(k, { k, label: lgName(g), live: 0 });
      if (lgLive(g)) by.get(k).live += 1;
    }
    const leagues = [...by.values()].sort((a, b) => (b.live > 0) - (a.live > 0) || a.label.localeCompare(b.label));
    return [['live', 'Live'], ['all', 'All'], ...leagues.map((e) => [e.k, e.label])];
  }

  function lgRowCall(g) {
    if (!LL || !lgLive(g) || !g.fdTotal?.line) return null;
    try {
      const r = LL.project(g, { prior: lgPrior(g), priorSeen: lgSeen(g), lines: { game: g.fdTotal.line } });
      const m = r.markets.find((x) => x.id === 'game');
      return { where: r.where, call: m?.call || null };
    } catch (_) { return null; }
  }

  function renderLeagueList() {
    const filters = lgFilters();
    if (!filters.some(([id]) => id === S.lg.filter)) S.lg.filter = 'all';
    $('leagueFilters').innerHTML = filters.map(([id, l]) => `<button type="button" data-lf="${esc(id)}" class="${S.lg.filter === id ? 'active' : ''}">${esc(l)}</button>`).join('');
    document.querySelectorAll('[data-lf]').forEach((b) => { b.onclick = () => { S.lg.filter = b.dataset.lf; renderLeagueList(); }; });
    const list = S.lg.games.filter((g) => (S.lg.filter === 'all' ? true : S.lg.filter === 'live' ? lgLive(g) : lgKey(g) === S.lg.filter));
    $('leagueList').innerHTML = list.length ? list.map((g) => {
      const rc = lgRowCall(g);
      const when = lgLive(g) ? (rc?.where || `${g.periodText || ''} ${g.clock || ''}`) : g.status === 'final' ? 'Final' : hhmm(g.date);
      return `<div class="league-row ${S.lg.selected === g.id ? 'selected' : ''}${enterCls(`lg:${g.id}`)}" data-lg="${esc(g.id)}">
      <div><div class="t">${esc(g.away.abbrev || g.away.shortName || g.away.name)} @ ${esc(g.home.abbrev || g.home.shortName || g.home.name)}</div>
      <div class="s">${esc(lgName(g))} · ${esc(when)}${g.fdTotal ? ` · FD ${esc(g.fdTotal.line)}` : ''}</div></div>
      <div class="lg-right">${rc?.call ? `<span class="verdict ${cls(rc.call)} sm">PLUS EDGE</span>` : ''}<div class="sc">${g.status === 'scheduled' ? '' : `${g.away.score}-${g.home.score}`}</div></div></div>`;
    }).join('') : '<div class="empty-line">No games for this filter.</div>';
    const note = lgFeedNote();
    if (note) $('leagueList').insertAdjacentHTML('afterbegin', `<div class="lg-feed-note">${esc(note)}</div>`);
    document.querySelectorAll('[data-lg]').forEach((r) => { r.onclick = () => { haptic(); selectLeagueGame(r.dataset.lg); }; });
  }

  // Says plainly when FanDuel's live list sends no basketball, so an empty Europe list isn't a mystery.
  function lgFeedNote() {
    const fd = S.lg.fdLive;
    if (!fd) return '';
    if (!fd.ok) return 'FanDuel’s live list isn’t answering right now, so European and other FanDuel-only games can’t show. NBA, college and EuroLeague games still come from their own feeds.';
    if (!fd.liveCount) return 'FanDuel’s live list isn’t sending any basketball right now, so European and other FanDuel-only games can’t show. NBA, college and EuroLeague games still come from their own feeds.';
    return '';
  }

  async function loadLeagues() {
    try {
      const d = await api('/api/games');
      S.lg.fdLive = d.fanduelLive || null;
      S.lg.games = d.games || [];
      lgRememberFirstLines(S.lg.games);
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
    const row = S.lg.games.find((g) => g.id === id) || null;
    let game = row;
    let leagueName = row ? (row.leagueName || lgName(row)) : '';
    let fdLines = null;
    const skip = (S.lg.noDetail || {})[id];
    try {
      if (skip && Date.now() - skip < 5 * 60e3) throw new Error('skip');
      const d = await api(`/api/games/${encodeURIComponent(id)}`);
      if (d?.game) {
        game = { ...(row || {}), ...d.game, fdTotal: d.game.fdTotal || row?.fdTotal || null };
        leagueName = d.league?.name || leagueName;
        fdLines = d.fdLines || d.game.fdLines || null;
      }
    } catch (err) {
      // The live server can't open every league yet; the list row has everything the projection needs.
      // Don't ask again for a few minutes, so the 30-second refresh doesn't keep calling a failing endpoint.
      if (err.message !== 'skip') S.lg.noDetail = { ...(S.lg.noDetail || {}), [id]: Date.now() };
    }
    if (S.lg.selected !== id) return;
    if (!game) { $('leagueDetail').innerHTML = '<p class="muted">This game isn’t on FanDuel’s board any more.</p>'; return; }
    const same = S.lg.detail?.id === id && $('lgForm');
    S.lg.detail = { id, game, leagueName, fdLines };
    if (same) { lgHeader(); lgFillAuto(); lgCompute(); } else renderLeagueDetail();
  }

  function lgCfg(g) { return LL ? LL.profileFor(g) : null; }

  // Boxes: game total, halves, and each quarter (or each half for college men).
  function lgBoxes(g) {
    const cfg = lgCfg(g)?.clock || { periods: 4, usesHalves: false };
    const boxes = [['game', 'Game total']];
    if (!cfg.usesHalves) boxes.push(['half1', '1st half'], ['half2', '2nd half']);
    const word = cfg.usesHalves ? 'half' : 'qtr';
    for (let n = 1; n <= cfg.periods; n += 1) boxes.push([`q${n}`, `${LG_ORD[n - 1] || `${n}th`} ${word}`]);
    return boxes;
  }

  // What FanDuel shows for each box right now (server lines when the server sends them).
  function lgAuto(D) {
    const f = D.fdLines || {};
    const out = { game: lgVal(lgLineOf(f.game) ?? D.game.fdTotal?.line), half1: lgVal(lgLineOf(f.half1)), half2: lgVal(lgLineOf(f.half2)) };
    for (const [n, v] of Object.entries(f.quarters || {})) out[`q${n}`] = lgVal(lgLineOf(v));
    return out;
  }

  function lgHeader() {
    const D = S.lg.detail;
    const g = D.game;
    const el = $('lgHead');
    if (!el) return;
    el.innerHTML = `<div><p class="eyebrow">${esc(D.leagueName)}</p><h2>${esc(g.away.name)} ${g.away.score ?? ''} @ ${esc(g.home.name)} ${g.home.score ?? ''}</h2></div>
      <span class="chip">${lgLive(g) ? 'LIVE' : g.status === 'final' ? 'FINAL' : esc(hhmm(g.date))}</span>`;
  }

  function lgFillAuto() {
    const D = S.lg.detail;
    const saved = store.get(`lg-lines:${D.id}`, {});
    const auto = lgAuto(D);
    for (const [k] of lgBoxes(D.game)) {
      const el = $(`lg_${k}`);
      if (!el || document.activeElement === el) continue;
      const typed = saved[k] != null && saved[k] !== '';
      el.value = typed ? saved[k] : (auto[k] || '');
      el.closest('label')?.classList.toggle('auto', !typed && Boolean(auto[k]));
    }
  }

  function renderLeagueDetail() {
    const D = S.lg.detail;
    const g = D.game;
    $('leagueDetail').innerHTML = `
      <div class="hud-head tight" id="lgHead"></div>
      <form id="lgForm" class="league-lines" autocomplete="off">
        ${lgBoxes(g).map(([k, l]) => `<label><span>${esc(l)}<i class="fd-tag">FD live</i></span><input id="lg_${k}" data-k="${k}" inputmode="decimal" placeholder="FanDuel line" /></label>`).join('')}
      </form>
      <div id="lgOut"></div>`;
    lgHeader();
    lgFillAuto();
    $('lgForm').onsubmit = (e) => e.preventDefault();
    $('lgForm').querySelectorAll('input').forEach((el) => {
      el.oninput = () => {
        const saved = store.get(`lg-lines:${D.id}`, {});
        const v = el.value.trim();
        if (v === '') delete saved[el.dataset.k]; else saved[el.dataset.k] = v;
        store.set(`lg-lines:${D.id}`, saved);
        el.closest('label')?.classList.remove('auto');
        lgCompute();
      };
      el.onblur = () => { if (el.value.trim() === '') lgFillAuto(); };
    });
    lgCompute();
    animate($('leagueDetail'));
  }

  function lgCallCard(m) {
    if (m.call) {
      return `<div class="lab-call ${cls(m.call)}"><div class="lc-head"><span class="lc-label">${esc(m.label)}</span><span class="lc-pick">PLUS EDGE ${esc(m.line)}</span></div><p>${esc(m.text)}</p></div>`;
    }
    return `<div class="lab-call pass"><div class="lc-head"><span class="lc-label">${esc(m.label)}</span><span class="lc-pick">NO BET ${esc(m.line)}</span></div><p>${esc(m.text)}</p></div>`;
  }

  function lgCompute() {
    const D = S.lg.detail;
    if (!D || !$('lgOut')) return;
    if (!LL) { $('lgOut').innerHTML = '<p class="muted">Projections didn’t load. Pull to refresh.</p>'; return; }
    const v = (k) => ($(`lg_${k}`) ? $(`lg_${k}`).value.trim() : '');
    const lines = { game: v('game'), half1: v('half1'), half2: v('half2'), quarter: {} };
    for (const [k] of lgBoxes(D.game)) if (k.startsWith('q')) lines.quarter[Number(k.slice(1))] = v(k);
    let r;
    try { r = LL.project(D.game, { prior: lgPrior(D.game), priorSeen: lgSeen(D.game), lines }); } catch (err) { $('lgOut').innerHTML = `<p class="muted">${esc(err.message)}</p>`; return; }
    const shortName = (per) => (per.n > (r.usesHalves ? 2 : 4) ? per.name : r.usesHalves ? per.name : `${LG_ORD[per.n - 1]} qtr`);
    const calls = r.markets.filter((m) => m.call);
    const rest = r.markets.filter((m) => !m.call);
    const m = r.math;
    $('lgOut').innerHTML = `<div class="lab-res">
      <p class="lab-note lg-where">${esc(r.where)}</p>
      ${[...calls, ...rest].map(lgCallCard).join('')}
      ${r.markets.length <= 1 && r.progress.state !== 'final' ? `<div class="lab-hint"><b>Want half and quarter calls?</b> Type FanDuel’s ${r.usesHalves ? 'half' : '1st half, 2nd half or quarter'} lines in the boxes above. The numbers update as you type.</div>` : ''}
      <div class="lab-sec"><h5>Our projection</h5>
        <div class="proj-rows">
          <div class="pr main"><span>Full game total</span><b>${n1(r.full)} pts</b></div>
          ${r.half1 != null ? `<div class="pr"><span>1st half (Q1 + Q2)</span><b>${n1(r.half1)} pts</b></div>` : ''}
          ${r.half2 != null ? `<div class="pr"><span>2nd half (Q3 + Q4)</span><b>${n1(r.half2)} pts</b></div>` : ''}
        </div>
        <div class="q-strip${r.periods.length > 4 ? ' q5' : ''}">${r.periods.map((per) => `<div class="qt ${per.state}"><span>${esc(shortName(per))}</span><b>${per.value == null ? '—' : n1(per.value)}</b><em>${per.state === 'done' ? 'final' : per.state === 'now' ? 'now' : ''}</em></div>`).join('')}</div>
      </div>
      ${r.why.length ? `<div class="lab-sec"><h5>Why we think so</h5><ul class="lab-why">${r.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
      <details class="fine"><summary>Show the math</summary><div class="fine-grid">
        <span>${m.priorFromLine === false ? 'Usual total for this league' : 'FanDuel starting total'}</span><b>${m.prior ?? '—'}</b>
        <span>Live pace (full game)</span><b>${m.livePace ?? '—'}</b>
        <span>Pace we use</span><b>${m.blendedPace ?? '—'}</b>
        <span>Weight on live pace</span><b>${Math.round((m.liveWeight || 0) * 100)}%</b>
        <span>Minutes played</span><b>${m.elapsed}</b>
        <span>Minutes left</span><b>${m.remaining}</b>
        <span>Game clock</span><b>${r.progress.clockSource === 'estimated' ? 'worked out from score' : esc(r.progress.clockSource)}</b>
      </div></details>
    </div>`;
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
    S.settings = { edge: Number($('setEdge').value) || 2, ev: Number($('setEv').value) || 0, poll: Math.max(4, Number($('setPoll').value) || 8) };
    store.set('ggw.settings', S.settings);
    startPolling();
    loadBoard(true);
    if (S.view === 'game') loadDetail();
    toast(`Calls now need a ${S.settings.edge}-pt edge and ${S.settings.ev}% value.`);
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
  const UA = navigator.userAgent || '';
  const PLATFORM = {
    android: /Android/i.test(UA),
    ios: /iPhone|iPad|iPod/i.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1),
    samsung: /SamsungBrowser/i.test(UA),
    // Built-in browsers of other apps (Claude, Gmail, Messages, Facebook, Instagram, Google app…) can't install apps.
    inApp: /; wv\)|FBAN|FBAV|Instagram|Line\/|Snapchat|Twitter|GSA\/|Claude/i.test(UA),
    iosNonSafari: /CriOS|FxiOS|EdgiOS|GSA\//i.test(UA),
  };
  const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;

  function installSteps() {
    const url = `${location.origin}/`;
    const host = location.host;
    if (PLATFORM.android && PLATFORM.inApp) {
      return {
        title: 'Open in Chrome to install',
        body: `<p>You’re in another app’s built-in browser, which can’t install apps. Open GG Winner in Chrome and tap <b>Install</b>.</p>
          <a class="cta full" href="intent://${host}/?source=install#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end">Open in Chrome</a>
          <button type="button" class="ghost-btn full" data-copy="${url}">Copy link</button>`,
      };
    }
    if (PLATFORM.android && PLATFORM.samsung) {
      return {
        title: 'Install on your phone',
        body: '<ol class="steps"><li>Tap the <b>≡</b> menu at the bottom right.</li><li>Tap <b>Add page to</b> → <b>Home screen</b>.</li><li>Tap <b>Add</b>. GG Winner is now on your home screen.</li></ol>',
      };
    }
    if (PLATFORM.android) {
      return {
        title: 'Install on your Pixel',
        body: `<ol class="steps"><li>Tap <b>⋮</b> in Chrome’s top-right corner.</li><li>Tap <b>Install app</b> (on some versions it says <b>Add to Home screen</b> → <b>Install</b>).</li><li>GG Winner lands on your home screen and in your app drawer — it opens full-screen like any app.</li></ol>
          <p class="muted small">Tip: long-press the GG Winner icon for quick shortcuts to Board, Lab and Results.</p>`,
      };
    }
    if (PLATFORM.ios) {
      if (PLATFORM.iosNonSafari || PLATFORM.inApp) {
        return {
          title: 'Open in Safari to install',
          body: `<p>On iPhone, apps install from Safari. Copy the link, open Safari, paste it, then tap <b>Share</b> → <b>Add to Home Screen</b>.</p><button type="button" class="cta full" data-copy="${url}">Copy link</button>`,
        };
      }
      return {
        title: 'Add to your Home Screen',
        body: '<ol class="steps"><li>Tap the <b>Share</b> button (square with an arrow).</li><li>Scroll and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. GG Winner opens full-screen from your Home Screen.</li></ol>',
      };
    }
    return {
      title: 'Install GG Winner',
      body: '<ol class="steps"><li>Click the install icon at the right end of the address bar (or the ⋮ menu → <b>Install GG Winner</b>).</li><li>It opens in its own window. On your phone, open the same link in Chrome to install it there.</li></ol>',
    };
  }

  function showInstallSheet() {
    const st = installSteps();
    $('installTitle').textContent = st.title;
    $('installBody').innerHTML = st.body.replace(/<li>/g, '<li><span>').replace(/<\/li>/g, '</span></li>');
    $('installBody').querySelectorAll('[data-copy]').forEach((b) => {
      b.onclick = async () => {
        try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link copied'); } catch { toast(b.dataset.copy, 6000); }
      };
    });
    $('installSheet').showModal();
  }

  function hideInstallUi() {
    $('installCard').classList.add('hidden');
    $('installBtn').classList.add('hidden');
  }

  function setupPwa() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const install = async () => {
      haptic();
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice.catch(() => null);
        deferredPrompt = null;
        if (choice && choice.outcome === 'accepted') hideInstallUi();
        return;
      }
      showInstallSheet();
    };
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (!isStandalone()) $('installBtn').classList.remove('hidden');
    });
    window.addEventListener('appinstalled', () => {
      hideInstallUi();
      try { $('installSheet').close(); } catch { /* not open */ }
      toast('GG Winner is on your home screen 🏀 Long-press the icon for shortcuts.', 6000);
    });
    $('installBtn').onclick = install;
    $('installGo').onclick = install;
    $('installLater').onclick = () => { $('installCard').classList.add('hidden'); store.set('cs.installLaterAt', Date.now()); };
    $('installClose').onclick = () => $('installSheet').close();
    // Offer install from the first visit (not only after Chrome's engagement check), until installed.
    if (!isStandalone()) {
      $('installBtn').classList.remove('hidden');
      const later = store.get('cs.installLaterAt', 0);
      if (!later || Date.now() - later > 3 * 86400000) $('installCard').classList.remove('hidden');
    }
    if (window.matchMedia) {
      window.matchMedia('(display-mode: standalone)').addEventListener?.('change', (e) => { if (e.matches) hideInstallUi(); });
    }
  }



  // Pull-to-refresh on the board (installed app — Chrome's own pull-to-refresh is off there).
  function setupPullToRefresh() {
    const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    if (!standalone) return;
    const el = $('ptr');
    let y0 = null;
    let dy = 0;
    window.addEventListener('touchstart', (e) => {
      if (window.scrollY > 0 || S.view !== 'board' || document.querySelector('dialog[open]')) return;
      y0 = e.touches[0].clientY;
      dy = 0;
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      const k = Math.min(1, dy / 90);
      el.style.transform = `translate(-50%, ${Math.min(dy, 110) - 60}px) rotate(${k * 270}deg)`;
      el.style.opacity = String(k);
      el.classList.toggle('ready', k >= 1);
    }, { passive: true });
    window.addEventListener('touchend', () => {
      if (y0 == null) return;
      const go = dy >= 90;
      y0 = null;
      el.classList.remove('ready');
      el.style.transform = '';
      el.style.opacity = '';
      if (go) {
        haptic();
        el.classList.add('spinning');
        loadBoard(true).finally(() => setTimeout(() => el.classList.remove('spinning'), 300));
      }
    });
  }

  function bind() {
    document.querySelectorAll('.tabs [data-view], .bottom-nav [data-view]').forEach((b) => { b.onclick = () => { haptic(); setView(b.dataset.view); }; });
    document.querySelectorAll('[data-view-go]').forEach((b) => { b.onclick = () => setView(b.dataset.viewGo); });
    $('refreshBtn').onclick = () => { haptic(); loadBoard(true); };
    $('settingsBtn').onclick = openSettings;
    $('helpBtn').onclick = openOnboarding;
    $('settingsHelp').onclick = () => { $('settings').close(); openOnboarding(); };
    $('settingsInstall').onclick = () => { $('settings').close(); $('installGo').click(); };
    $('saveSettings').onclick = () => saveSettings();
    [['setEdge', 'setEdgeVal'], ['setEv', 'setEvVal'], ['setPoll', 'setPollVal']].forEach(([a, b]) => { $(a).oninput = () => syncRange(a, b); });
    $('obNext').onclick = () => (obStep >= 2 ? closeOnboarding() : obShow(obStep + 1));
    $('obSkip').onclick = closeOnboarding;
    $('labForm').onsubmit = (e) => { e.preventDefault(); haptic(); runLab(); };
    $('playerSearch').oninput = renderPlayers;
    $('pfSearch').oninput = renderProfiles;
    $('pfClose').onclick = () => $('pfSheet').close();
    $('pfSheet').addEventListener('click', (e) => { if (e.target === $('pfSheet')) $('pfSheet').close(); });
    document.querySelectorAll('#pfSort button').forEach((b) => {
      b.onclick = () => {
        PF.sort = b.dataset.sort;
        document.querySelectorAll('#pfSort button').forEach((x) => x.classList.toggle('active', x === b));
        renderProfiles();
      };
    });
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
    window.addEventListener('popstate', (e) => {
      const v = e.state?.view || 'board';
      setView(v, { fromHistory: true });
    });
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
  setupPullToRefresh();
  const deep = (location.hash || '').replace('#', '') || new URLSearchParams(location.search).get('view');
  if (['board', 'players', 'game', 'lab', 'results', 'leagues'].includes(deep)) S.view = deep;
  try { history.replaceState({ view: S.view }, '', `#${S.view}`); } catch { /* ignore */ }
  setView(S.view, { fromHistory: true });
  loadBoard(false);
  startPolling();
  setTimeout(moveInk, 300);
  if (!store.get('cs.onboarded', false)) setTimeout(openOnboarding, 700);
})();
