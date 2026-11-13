/* GG Winner: plain-English research (add-on, v1, Nov 6 2026).
   Load it BEFORE app.js:  <script src="/research.js"></script>
   It changes no numbers of its own: it keeps a copy of the data app.js already loads (with the same late-game
   correction app.js applies, from gg-live.js)
   and rewrites the explanations in plain words: what the pick is, our number
   vs FanDuel's line, and the two or three reasons behind it.
   To undo it, remove the script tag. */
(() => {
  const R = { board: null, detail: null, edge: 4 };

  // ---------- keep a copy of the data the app already fetches (no extra calls) ----------
  const origFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  if (origFetch) window.fetch = async (input, init) => {
    const res = await origFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (res.ok && /\/api\/eb\/(board|game\/)/.test(url)) {
        const data = await res.clone().json();
        const m = /[?&]edge=([\d.]+)/.exec(url);
        if (m) R.edge = Number(m[1]);
        // the same late-game correction the app makes to its own copy (gg-live.js), with the same bars, so the words here and
        // the numbers on the cards always come from the same numbers
        const v = /[?&]ev=([\d.]+)/.exec(url);
        if (window.GGLive) { try { window.GGLive.fix(data, { edgeMin: R.edge, evMin: v ? Number(v[1]) : undefined }); } catch { /* keep the server's numbers */ } }
        if (/\/api\/eb\/board/.test(url)) R.board = data;
        else R.detail = data;
      }
    } catch { /* never break the app */ }
    return res;
  };

  // ---------- small helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isNum = (v) => v != null && v !== '' && Number.isFinite(Number(v));
  const whole = (v) => (isNum(v) ? String(Math.round(Number(v))) : '?');
  const one = (v) => (isNum(v) ? String(Math.round(Number(v) * 10) / 10) : '?');
  const pts = (v) => { const x = Math.round(Math.abs(Number(v)) * 10) / 10; return `${x} ${x === 1 ? 'point' : 'points'}`; };
  const isCall = (m) => m && m.call === 'Over'; // plus edges only
  const odds = (o) => (o == null ? '' : o > 0 ? `+${o}` : `${o}`);

  function marketName(m) {
    if (!m) return 'this bet';
    if (m.id === 'game') return 'the full game';
    if (m.id === 'half1') return 'the 1st half';
    if (m.id === 'half2') return 'the 2nd half';
    if (/^q\d/.test(m.id)) return `quarter ${m.id.slice(1)}`;
    if (/Total$/.test(m.id)) return String(m.label || '').replace(/ team total$/i, '’s own points');
    return String(m.label || 'this bet').toLowerCase();
  }

  // ---------- the core: turn one market into plain words ----------
  // Returns { verdict, headline, reasons: [{kind:'yes'|'no'|'info', text}], chance, sure }
  function explain(m, ev, g, extra = {}) {
    const v2 = m && m.rawGap !== undefined; // Nov 5 model: GG projection = model blended with FanDuel's line
    const edge = R.edge || (v2 ? 2 : 4);
    const out = { verdict: isCall(m) ? `PLUS EDGE ${m.line}` : 'NO PLAY', headline: '', reasons: [], chance: '', sure: '' };
    if (!m || !ev) return out;
    const call = isCall(m) ? m.call : null;
    const name = marketName(m);
    const line = isNum(m.line) ? Number(m.line) : null;
    const mean = v2 && isNum(m.fair) ? Number(m.fair) : isNum(m.mean) ? Number(m.mean) : null;
    const model = isNum(m.mean) ? Number(m.mean) : null;
    const r = m.reason || '';
    const f = ev.progress?.f || 0;
    const live = g && g.status === 'live';
    const away = g?.away?.player || 'Away';
    const home = g?.home?.player || 'Home';

    // Headline: the pick and our number vs the line.
    if (call) {
      out.headline = `We expect about <b>${whole(mean)}</b> points in ${name}. That’s <b>${pts(m.gap)} ahead</b> of FanDuel’s line of ${line}, a plus edge: our number says more points than FanDuel does.`;
    } else if (line == null && m.full != null) {
      out.headline = `FanDuel hasn’t posted a line for ${name} yet. We expect about <b>${whole(m.full)}</b> points in it.`;
    } else if (line == null) {
      out.headline = mean != null ? `FanDuel hasn’t posted a line for ${name} yet. We expect about <b>${whole(mean)}</b>.` : `FanDuel hasn’t posted a line for ${name} yet.`;
    } else if (mean != null && line != null && mean < line) {
      // plus edges only: our number is never set against a line it is not ahead of (checked before every other reason, v3.10)
      out.headline = 'No play. Our number is not ahead of this line, and we only play plus edges, where our number is ahead of the line.';
    } else if (mean == null && m.full != null) {
      out.headline = `We expect about <b>${whole(m.full)}</b> points in ${name} (line ${line}). To judge it we need the score when the quarter starts, so keep this game open through the break.`;
    } else if (/suspended/i.test(r)) {
      out.headline = `FanDuel has paused betting on this for a moment. We expect about <b>${whole(mean)}</b> and the line was ${line}.`;
    } else if (/ratings may be off/i.test(r)) {
      // (the server sat this one out on ITS number: quoted as it was, before the late-game correction)
      out.headline = `No bet. Player history says about <b>${whole(isNum(m.serverMean) ? m.serverMean : model)}</b> but FanDuel’s line is ${line}. A gap that big usually means our numbers on this pair are off, so we sit this one out.`;
    } else if (/Below the line/i.test(r) || (mean != null && mean < line)) {
      out.headline = 'No play. Our number is not ahead of this line, and we only play plus edges, where our number is ahead of the line.';
    } else if (/Gap under|Edge under/i.test(r) || (m.gap != null && Math.abs(m.gap) < edge)) {
      out.headline = `No bet. We expect about <b>${whole(mean)}</b> and FanDuel’s line is ${line}. That’s only ${pts(m.gap || 0)} apart, and we want at least ${edge} before we call it.`;
    } else if (/Price/i.test(r)) {
      out.headline = `We expect about <b>${whole(mean)}</b>, ${pts(m.gap)} ${m.gap > 0 ? 'ahead of' : 'behind'} the line of ${line}, but FanDuel’s price is too expensive to be worth it.`;
    } else if (/Low confidence/i.test(r)) {
      out.headline = `We expect about <b>${whole(mean)}</b> vs the line of ${line}, but there isn’t enough history on these players to trust it yet.`;
    } else if (/early|late/i.test(r)) {
      out.headline = f > 0.8 ? 'No bet. It’s the final stretch, and late calls lose too often, so we sit out.' : 'Too early in the game for a reliable call on this.';
    } else {
      out.headline = mean != null ? `We expect about <b>${whole(mean)}</b> and FanDuel’s line is ${line}. No bet right now.` : 'No bet right now.';
    }

    // Reasons, compared with the line on the same scale as the bet.
    const ref = line != null ? line : mean;
    const dir = (v) => (ref == null || !isNum(v) ? null : Number(v) > ref ? 'Over' : Number(v) < ref ? 'Under' : null);
    const kindOf = (v) => {
      const d = dir(v);
      if (!call || !d) return 'info';
      return d === call ? 'yes' : 'no';
    };
    // plus edges only: when our number is not ahead of the line, nothing is measured against that line at all
    const belowLine = line != null && isNum(mean) && Number(mean) <= line;
    const vsLine = (v) => {
      if (belowLine || line == null || !isNum(v)) return '';
      const d = Number(v) - line;
      if (Math.abs(d) < 0.5) return ', right on the line';
      return `, ${pts(d)} ${d > 0 ? 'ahead of' : 'behind'} the line`;
    };
    const pre = ev.pregame || {};
    const cand = [];
    const isGame = m.id === 'game';
    const isHalf = m.id === 'half1';

    if (isGame) {
      const hist = isNum(pre.model) ? pre.model : pre.expected;
      if (isNum(hist)) {
        cand.push({ w: 3, kind: kindOf(hist), text: `<b>Their history:</b> past games say about ${whole(hist)} total (${esc(away)} about ${whole(pre.away)}, ${esc(home)} about ${whole(pre.home)})${vsLine(hist)}.` });
      }
      const pace = ev.rate?.pacePer20;
      if (live && f >= 0.15 && isNum(pace)) {
        const mins = Math.round(ev.progress?.minutes || f * 20);
        cand.push({ w: f >= 0.4 ? 4 : 2, kind: kindOf(pace), text: `<b>Right now:</b> it’s ${g.away.score}–${g.home.score} after about ${mins} minutes. At this speed they finish near ${whole(pace)}${vsLine(pace)}.` });
      }
      if (pre.pair && pre.pair.n >= 3 && isNum(pre.pair.avgTotal)) {
        cand.push({ w: 2, kind: kindOf(pre.pair.avgTotal), text: `<b>Against each other:</b> ${pre.pair.n} recent games, ${whole(pre.pair.avgTotal)} total on average${vsLine(pre.pair.avgTotal)}.` });
      }
    } else if (isHalf) {
      if (m.last10 && isNum(m.last10.avg)) {
        cand.push({ w: 4, kind: kindOf(m.last10.avg), text: `<b>Last 10 first halves:</b> ${esc(away)} about ${whole(m.last10.away)}, ${esc(home)} about ${whole(m.last10.home)}, so about ${whole(m.last10.avg)} together${vsLine(m.last10.avg)}.` });
      }
      if (isNum(pre.expected)) {
        const halfShare = isNum(mean) && isNum(ev.rate?.total) && ev.rate.total > 0 ? mean / ev.rate.total : 0.5;
        const h = pre.expected * (halfShare > 0.3 && halfShare < 0.7 ? halfShare : 0.5);
        cand.push({ w: 3, kind: kindOf(h), text: `<b>Their history:</b> past games point to about ${whole(pre.expected)} for the full game, so about ${whole(h)} by halftime${vsLine(h)}.` });
      }
      if (live && f > 0 && f < 0.5) {
        const sofar = (g.away.score || 0) + (g.home.score || 0);
        const halfPace = f > 0.05 ? sofar / (f * 2) : null;
        if (isNum(halfPace)) cand.push({ w: 3, kind: kindOf(halfPace), text: `<b>Right now:</b> ${sofar} points so far. At this speed they reach about ${whole(halfPace)} by halftime${vsLine(halfPace)}.` });
      }
    } else if (/^q\d/.test(m.id)) {
      if (isNum(m.full)) cand.push({ w: 3, kind: kindOf(m.full), text: `<b>Their history:</b> these two usually score about ${whole(m.full)} in a quarter like this${vsLine(m.full)}.` });
      if (isNum(m.soFar)) cand.push({ w: 4, kind: 'info', text: `<b>This quarter so far:</b> ${m.soFar} points.` });
    } else if (/Total$/.test(m.id)) {
      const side = m.id === 'awayTotal' ? 'away' : 'home';
      const other = side === 'away' ? 'home' : 'away';
      const me = extra.gamers?.[side]?.rating;
      const opp = extra.gamers?.[other]?.rating;
      if (me && opp && isNum(me.avgFor) && isNum(opp.avgAgainst)) {
        cand.push({ w: 3, kind: kindOf((me.avgFor + opp.avgAgainst) / 2), text: `<b>Matchup:</b> ${esc(g?.[side]?.player)} usually scores ${whole(me.avgFor)}, and ${esc(g?.[other]?.player)} usually gives up ${whole(opp.avgAgainst)}.` });
      }
    }

    // For a call: up to two reasons that back it, then the strongest one against it.
    cand.sort((a, b) => b.w - a.w);
    if (call) {
      const yes = cand.filter((c) => c.kind === 'yes');
      const no = cand.filter((c) => c.kind === 'no');
      out.reasons = [...yes.slice(0, no.length ? 2 : 3), ...no.slice(0, 1)];
      const total = yes.length + no.length;
      out.agree = `${yes.length} of ${total} signs point to more points than FanDuel expects`;
    } else {
      out.reasons = cand.slice(0, 3).map((c) => ({ ...c, kind: 'info' }));
    }

    // Chance and how sure, in plain words.
    if (isNum(m.pOver) && line != null && !belowLine) {
      const p = m.pOver;
      const k = Math.round(p * 10);
      out.chance = p > 0.45 && p < 0.55 && !call ? 'Close to a coin flip.' : `We think it finishes above ${line} about ${k} times out of 10.`;
    }
    const lvl = ev.confidence?.level;
    const base = lvl === 'HIGH' ? 'lots of games on both players' : lvl === 'LOW' ? 'not many games on these players yet' : 'a fair amount of history on these players';
    if (call) out.sure = `How sure: <b>${lvl === 'HIGH' ? 'High' : lvl === 'LOW' ? 'Low' : 'Medium'}</b>. ${out.agree}, with ${base}.`;
    return out;
  }

  function renderExplain(x, { compact = false } = {}) {
    const icon = { yes: '✓', no: '✗', info: '•' };
    let list = x.reasons;
    if (compact && list.length > 2) {
      const no = list.find((r) => r.kind === 'no');
      list = no ? [list.find((r) => r.kind !== 'no'), no].filter(Boolean) : list.slice(0, 2);
    }
    const reasons = list
      .map((r) => `<li class="pe-${r.kind}"><i>${icon[r.kind]}</i><span>${r.text}</span></li>`).join('');
    const foot = [x.chance, x.sure].filter(Boolean).join(' ');
    return `<div class="pe" data-pe="1"><p class="pe-head">${x.headline}</p>${reasons ? `<p class="pe-label">Why</p><ul class="pe-why">${reasons}</ul>` : ''}${foot ? `<p class="pe-foot">${foot}</p>` : ''}</div>`;
  }

  // ---------- "Show the math" with plain labels ----------
  function mathBox(m) {
    if (!m || m.line == null) return '';
    // a line our number is not ahead of gets no numbers of ours (plus edges only)
    { const o = isNum(m.fair) ? m.fair : m.mean; if (isNum(o) && Number(o) <= Number(m.line)) return ''; }
    const pc = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`);
    const ev = (e) => (e == null ? '—' : `${e > 0 ? '+' : ''}${Math.round(e * 1000) / 10}%`);
    return `<details class="fine pe-math" data-pe="1"><summary>Show the math</summary><div class="fine-grid">
      <span>FanDuel price</span><b>${odds(m.overOdds)}</b>
      <span>FanDuel’s own chance it beats the line</span><b>${pc(m.fdOver)}</b>
      <span>Our chance it beats the line</span><b>${pc(m.pOver)}</b>
      <span>Our number (what we expect)</span><b>${one(m.fair)}</b>${m.rawGap !== undefined ? `
      <span>Player history alone</span><b>${one(m.mean)}</b>${m.lateKeep != null ? `
      <span>Late-game correction</span><b>${Math.round(m.lateKeep * 100)}% of the points still expected are kept</b>` : ''}
      <span>How much we trust history vs FanDuel</span><b>${m.weight != null ? `${Math.round(m.weight * 100)}% / ${100 - Math.round(m.weight * 100)}%` : '—'}</b>` : ''}
      <span>Long-run return per $100</span><b>${ev(m.evOver)}</b>
      <span>Normal swing either way</span><b>about ${whole(m.sd)} points</b>
    </div><p class="pe-note">“Long-run return” is what you’d win or lose on average per bet at these prices if our chance is right. We only call bets above your value setting.</p></details>`;
  }

  // ---------- the "How we got our number" card ----------
  function whyCard(d) {
    const g = d.game; const ev = d.eval; const pre = ev.pregame || {};
    const gm = (ev.markets || []).find((m) => m.id === 'game') || {};
    const live = g.status === 'live';
    const mw = Math.round((ev.modelWeight ?? 0.35) * 100);
    const blend = /FanDuel opener/i.test(pre.blendNote || '');
    const steps = [];
    if (isNum(pre.model)) steps.push(`<li><b>Player history:</b> ${esc(g.away.player)} and ${esc(g.home.player)}’s past games point to about <b>${whole(pre.model)}</b> total.</li>`);
    // How much FanDuel's first line counts in the starting number is in the server's note ("ratings 25% / FanDuel opener 75%"):
    // none of it when both gamers have plenty of games, three quarters when one of them is new. (v3.11.1: this step used to say
    // "we meet it halfway" in every game, which was never the case.)
    const fdShare = (() => { const x = /FanDuel opener\s+(\d+)%/i.exec(pre.blendNote || ''); return x ? Number(x[1]) : null; })();
    if (blend && isNum(g.opening) && fdShare > 0) steps.push(`<li><b>FanDuel’s first line:</b> FanDuel opened at ${g.opening}. We have few games on one of these gamers, so that line counts for ${fdShare}% of our starting number: <b>${whole(pre.expected)}</b>.</li>`);
    else if (blend && isNum(g.opening) && fdShare === 0 && isNum(pre.expected)) steps.push(`<li><b>FanDuel’s first line:</b> FanDuel opened at ${g.opening}. With this much history on both gamers we start from our own number, <b>${whole(pre.expected)}</b>.</li>`);
    else if (isNum(pre.expected) && !isNum(pre.model)) steps.push(`<li><b>Starting number:</b> about <b>${whole(pre.expected)}</b> before tip-off.</li>`);
    if (pre.pair && pre.pair.n >= 3) steps.push(`<li><b>Head to head:</b> they’ve met ${pre.pair.n} times lately (about ${whole(pre.pair.avgTotal)} total). ${Math.abs(Number(pre.pair.adj) || 0) < 0.05 ? 'That did not move our number.' : `That nudged our number ${pre.pair.adj >= 0 ? 'up' : 'down'} ${pts(pre.pair.adj)}.`}</li>`);
    if (live && isNum(ev.rate?.pacePer20)) steps.push(`<li><b>How it’s going:</b> at today’s scoring speed they finish near ${whole(ev.rate.pacePer20)}. We let the start of the game count only a little, because hot and cold starts usually even out.</li>`);
    if (live && gm.lateKeep != null && isNum(gm.serverMean) && isNum(gm.mean)) steps.push(`<li><b>Late in the game:</b> the clock reading runs a little behind near the end, so fewer points are left than it suggests. We keep ${Math.round(gm.lateKeep * 100)}% of the points still expected, which takes the player-history number from ${one(gm.serverMean)} to <b>${one(gm.mean)}</b>.</li>`);
    const v2 = gm.rawGap !== undefined;
    const ours = v2 && isNum(gm.fair) ? gm.fair : gm.mean;
    const w = v2 && gm.weight != null ? Math.round(gm.weight * 100) : mw;
    if (gm.line != null && isNum(ours) && Number(ours) <= Number(gm.line)) steps.push('<li><b>Last check:</b> our number is not ahead of FanDuel’s live line, so there is no plus edge on the full game right now.</li>');
    else if (gm.line != null && isNum(ours)) steps.push(`<li><b>Last check:</b> ${v2 ? `player history says ${whole(gm.mean)}. At this point of the game we trust that ${w}% and FanDuel’s live line ${100 - w}%` : `we lean ${w}% on our number and ${100 - w}% on FanDuel’s live line`}. That gives <b>${whole(ours)}</b>, vs FanDuel’s ${gm.line}.</li>`);
    else if (isNum(ours)) steps.push(`<li><b>Our number now:</b> about <b>${whole(ours)}</b> for the full game.</li>`);
    const lvl = ev.confidence?.level;
    const sure = lvl === 'HIGH' ? 'High. We have lots of games on both players.' : lvl === 'LOW' ? 'Low. We don’t have many games on these players yet, so treat this as a rough guess.' : 'Medium. We have some history on these players.';
    const notes = (ev.confidence?.notes || []).map((x) => `<li>${esc(x)}</li>`).join('');
    const src = { 'market-confirmed': 'FanDuel’s quarter markets', 'market-corrected': 'FanDuel’s quarter markets', 'quarter-confirmed': 'the quarter shown', 'quarter-corrected': 'the quarter shown', 'clock-estimate': 'the tip-off time', 'score-estimate': 'the score (no tip time posted)', overtime: 'overtime', pregame: 'before tip-off' }[ev.progress?.source] || 'the feed';
    return `<div class="pe" data-pe="1">
      <div class="hud-head tight"><div><p class="eyebrow">THE RESEARCH</p><h2>How we got our number</h2></div><span class="chip ${lvl === 'HIGH' ? 'hot' : lvl === 'LOW' ? 'warn' : ''}">${lvl === 'HIGH' ? 'High' : lvl === 'LOW' ? 'Low' : 'Medium'} confidence</span></div>
      <ol class="pe-steps">${steps.join('')}</ol>
      <p class="pe-foot"><b>How sure:</b> ${sure}</p>
      <details class="fine pe-math"><summary>Show the math</summary><div class="fine-grid">
        <span>Player-history number</span><b>${one(pre.model)}</b>
        <span>Starting number (before tip)</span><b>${one(pre.expected)}</b>
        <span>Expected split</span><b>${esc(g.away.player)} ${one(pre.away)} · ${esc(g.home.player)} ${one(pre.home)}</b>
        <span>FanDuel’s first line</span><b>${g.opening ?? '—'}</b>
        <span>Finish at today’s speed</span><b>${one(ev.rate?.pacePer20)}</b>
        <span>Game played</span><b>${Math.round((ev.progress?.f || 0) * 100)}% · ${ev.progress?.minutes ?? 0} min</b>
        <span>Clock read from</span><b>${esc(src)}</b>
        <span>Confidence score</span><b>${ev.confidence?.score ?? '—'} of 100</b>
      </div>${notes ? `<ul class="notes">${notes}</ul>` : ''}</details>
    </div>`;
  }

  // ---------- apply to the page after app.js draws it ----------
  const $ = (id) => document.getElementById(id);
  function findGame(eventId) {
    const b = R.board || {};
    return [...(b.live || []), ...(b.upcoming || [])].find((g) => String(g.eventId || g.id) === String(eventId));
  }

  function applyPicks() {
    const rail = $('picks');
    if (!rail || !R.board) return;
    const picks = R.board.picks || [];
    rail.querySelectorAll('article.pick').forEach((card, i) => {
      if (card.querySelector('[data-pe]')) return;
      const p = picks[i];
      if (!p || String(p.eventId) !== card.dataset.event) return;
      const g = findGame(p.eventId) || p;
      const ev = g.eval || p.eval;
      if (!ev) return;
      const x = explain(p.market, ev, g);
      const say = card.querySelector('.pick-say');
      if (say) say.outerHTML = renderExplain(x, { compact: true });
      const mk = card.querySelectorAll('.pick-call .mk');
      if (mk[1]) mk[1].textContent = 'Vs line';
      if (mk[0]) mk[0].textContent = `The pick · ${marketName(p.market).replace(/^the /, '')}`;
    });
  }

  function applyDetail() {
    const d = R.detail;
    if (!d || !d.eval) return;
    const g = d.game; const ev = d.eval;
    const extra = { gamers: d.gamers, h2h: d.h2h };
    const hero = $('callHero');
    if (hero && hero.firstElementChild && !hero.querySelector('[data-pe]')) {
      const gm = (ev.markets || []).find((m) => m.id === 'game') || {};
      const m = ev.best || gm;
      const p = hero.querySelector('p');
      const x = explain(m, ev, g, extra);
      if (p) p.outerHTML = renderExplain(x) + (isCall(m) ? `<p class="pe-price">FanDuel price ${odds(m.overOdds)}</p>` : '');
      const mk = hero.querySelector('.mk');
      if (mk && ev.best) mk.textContent = `The pick · ${marketName(ev.best).replace(/^the /, '')}`;
    }
    const panel = $('marketPanel');
    if (panel && panel.firstElementChild && !panel.querySelector('[data-pe]')) {
      const id = document.querySelector('#marketTabs button.active')?.dataset.mk || 'game';
      const m = (ev.markets || []).find((x) => x.id === id);
      if (m) {
        const say = panel.querySelector('.say');
        if (say) say.outerHTML = renderExplain(explain(m, ev, g, extra));
        panel.querySelectorAll('.tip').forEach((t) => { if (/Last-10 1H check/.test(t.textContent)) t.remove(); });
        const fine = panel.querySelector('details.fine');
        if (fine) fine.outerHTML = mathBox(m);
        panel.querySelectorAll('.stat3 .tile .k').forEach((k) => {
          if (k.textContent === 'Ours') k.textContent = 'Our number';
          if (k.textContent === 'Gap') k.textContent = 'Vs line';
        });
      }
    }
    const why = $('whyCard');
    if (why && why.firstElementChild && !why.querySelector('[data-pe]')) why.innerHTML = whyCard(d);
  }

  function applyModelNote() {
    const el = $('modelNote');
    const m = R.board?.model;
    if (!el || !m || el.dataset.pe === el.textContent) return;
    const at = m.builtAt ? new Date(m.builtAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    el.textContent = `Our numbers come from ${Number(m.games || 0).toLocaleString()} finished games by ${m.players || 0} players${at ? `, refreshed at ${at}` : ''}.`;
    el.dataset.pe = el.textContent;
  }

  let obs = null; let queued = false;
  function apply() {
    queued = false;
    if (obs) obs.disconnect();
    try { applyPicks(); applyDetail(); applyModelNote(); } catch (e) { /* keep the app's own text if anything goes wrong */ if (window.console) console.warn('research.js', e); }
    if (obs) obs.observe(document.body, { childList: true, subtree: true });
  }
  function schedule() { if (!queued) { queued = true; queueMicrotask(apply); } }

  function css() {
    const s = document.createElement('style');
    s.textContent = `
      .pe-head{margin:8px 0 6px;line-height:1.45;font-size:15px}
      .pe-label{margin:10px 0 4px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.65}
      .pe-why{list-style:none;margin:0;padding:0;display:grid;gap:6px}
      .pe-why li{display:flex;gap:8px;align-items:flex-start;line-height:1.4;font-size:14px}
      .pe-why li i{font-style:normal;flex:0 0 20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;background:rgba(255,255,255,.08)}
      .pe-why li.pe-yes i{background:rgba(46,204,113,.2);color:#2ecc71}
      .pe-why li.pe-no i{background:rgba(255,99,99,.2);color:#ff6b6b}
      .pe-foot{margin:10px 0 0;font-size:13px;line-height:1.45;opacity:.85}
      .pe-price{margin:6px 0 0;font-size:12px;opacity:.7}
      .pe-steps{margin:8px 0 0;padding-left:20px;display:grid;gap:8px;line-height:1.45;font-size:14px}
      .pe-note{font-size:12px;opacity:.7;margin:8px 0 0;line-height:1.4}
      .pick .pe-head{font-size:14px}
      .pick .pe-why li{font-size:13px}`;
    document.head.appendChild(s);
  }

  function start() {
    css();
    obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true });
    schedule();
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  // For testing and the preview page.
  window.GGResearch = { explain, renderExplain, whyCard, mathBox, _state: R };
})();
