/* NCLEX Ward — simple game feed */
(function () {
  function BANK() {
    var raw = window.NCLEX_BANK || [];
    var seen = {};
    var out = [];
    raw.forEach(function (q) {
      if (!q || !q.id || seen[q.id]) return;
      seen[q.id] = 1;
      out.push(q);
    });
    return out;
  }
  function CASES() { return window.NCLEX_CASES || { rn: {}, pn: {} }; }
  function LABELS() { return window.NCLEX_LABELS || { rn: {}, pn: {} }; }
  const DIFFN = { 0: "All", 1: "Easy", 2: "Medium", 3: "Hard" };
  const SHIFT_LEN = 20;
  const XP_PER = { 1: 10, 2: 20, 3: 30 };
  const $ = (id) => document.getElementById(id);
  const uiKey = "ward_ui";
  const nameKey = "ward_name";
  let track = localStorage.getItem("ward_track") || "";
  let mode = "mix";
  let caseId = "sepsis";
  let diffFilter = 0;
  let queue = [];
  let i = 0;
  let selected = new Set();
  let locked = false;
  let gradedOk = null;
  let rendered = null;
  let streak = 0;
  let shiftCorrect = 0;
  let shiftMaxStreak = 0;
  let shiftLog = [];
  let history = [];
  let animating = false;

  function ui() { try { return JSON.parse(localStorage.getItem(uiKey) || "{}"); } catch (e) { return {}; } }
  function saveUi(p) { localStorage.setItem(uiKey, JSON.stringify(Object.assign({ hintSeen: false, font: "m" }, ui(), p))); }
  function nurseName() { return (localStorage.getItem(nameKey) || "").trim(); }
  function storeKey() { return "ward_" + (track || "x"); }
  function rawStats() { try { return JSON.parse(localStorage.getItem(storeKey()) || "{}"); } catch (e) { return {}; } }
  function stats() {
    const s = rawStats();
    return {
      ok: s.ok || 0,
      n: s.n || 0,
      xp: s.xp || 0,
      miss: Array.isArray(s.miss) ? s.miss : [],
      seenRight: s.seenRight || {},
      byCat: s.byCat || {},
      byDiff: s.byDiff || {},
      review: Array.isArray(s.review) ? s.review : [],
      streak: s.streak || 0
    };
  }
  function saveStats(p) { localStorage.setItem(storeKey(), JSON.stringify(Object.assign(stats(), p))); }
  function levelOf(xp) { return Math.floor((xp || 0) / 100) + 1; }
  function xpInto(xp) { return (xp || 0) % 100; }
  function pool() {
    return BANK().filter(function (q) {
      return q && q.tracks && q.tracks.indexOf(track) !== -1 && (!diffFilter || q.difficulty === diffFilter);
    });
  }
  function byId(id) {
    var all = BANK().slice();
    var cases = CASES();
    Object.keys(cases).forEach(function (t) {
      Object.keys(cases[t] || {}).forEach(function (c) {
        ((cases[t][c] && cases[t][c].steps) || []).forEach(function (s) { all.push(s); });
      });
    });
    return all.filter(function (q) { return q && q.id === id; })[0];
  }
  function shuffle(a) {
    var x = a.slice();
    for (var n = x.length - 1; n > 0; n--) {
      var j = Math.floor(Math.random() * (n + 1));
      var tmp = x[n]; x[n] = x[j]; x[j] = tmp;
    }
    return x;
  }
  function toast(t) {
    var el = $("toast");
    if (!el) return;
    el.textContent = t;
    el.classList.add("show", "pop");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show", "pop"); }, 1400);
  }
  function live(t) { if ($("live")) $("live").textContent = t; }
  function applyFont() {
    var f = ui().font || "m";
    document.documentElement.classList.remove("fs-s", "fs-m", "fs-l");
    document.documentElement.classList.add("fs-" + f);
    document.querySelectorAll("#fonts button").forEach(function (b) { b.classList.toggle("active", b.dataset.fs === f); });
  }
  function modeLabel() {
    if (mode === "miss") return "MISSED";
    if (mode === "shift") return "QUICK 20";
    if (mode === "case") return "STORY";
    if (mode === "review") return "REVIEW";
    if (diffFilter) return DIFFN[diffFilter].toUpperCase();
    return "";
  }
  function buildQueue() {
    var bank = pool();
    history = []; i = 0; shiftCorrect = 0; shiftMaxStreak = 0; shiftLog = [];
    if (mode === "case") queue = (((CASES()[track] || {})[caseId] || { steps: [] }).steps || []).slice();
    else if (mode === "miss") queue = shuffle(BANK().filter(function (q) { return q && q.tracks && q.tracks.indexOf(track) !== -1 && stats().miss.indexOf(q.id) !== -1; }));
    else if (mode === "review") {
      var ids = stats().review.map(function (r) { return r.id; });
      var seen = {};
      queue = [];
      ids.forEach(function (id) {
        if (seen[id]) return;
        var q = byId(id);
        if (q && q.tracks && q.tracks.indexOf(track) !== -1) { queue.push(q); seen[id] = 1; }
      });
    } else if (mode === "shift") queue = shuffle(bank).slice(0, SHIFT_LEN);
    else queue = shuffle(bank);
  }
  function paintHud() {
    var s = stats();
    var xp = s.xp || 0;
    if ($("trackPill")) $("trackPill").textContent = (track || "—").toUpperCase();
    if ($("streak")) $("streak").textContent = String(streak);
    if ($("score")) $("score").textContent = String(xp);
    if ($("lvlChip")) $("lvlChip").textContent = "LV " + levelOf(xp);
    if ($("missCount")) $("missCount").textContent = String(s.miss.length);
    if ($("xpFill")) $("xpFill").style.width = xpInto(xp) + "%";
    if ($("modeTag")) $("modeTag").textContent = modeLabel();
  }
  function prepare(q) {
    var opts = (q.opts || []).map(function (t, idx) {
      return { t: t, k: (q.ans || []).indexOf(idx) !== -1, w: (q.whyWrong && q.whyWrong[idx]) || "" };
    });
    return { raw: q, multi: !!q.multi, opts: shuffle(opts) };
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&" + "amp;")
      .replace(/</g, "&" + "lt;")
      .replace(/>/g, "&" + "gt;")
      .replace(/"/g, "&" + "quot;")
      .replace(/'/g, "&#39;");
  }
  function letters() { return ["A", "B", "C", "D", "E", "F"]; }
  function renderFromPrepared(prep, restore) {
    rendered = prep;
    var q = prep.raw;
    selected = restore ? new Set(restore.selected) : new Set();
    locked = restore ? restore.locked : false;
    gradedOk = restore ? restore.gradedOk : null;
    var extra = q.multi ? "ALL THAT APPLY" : "PICK ONE";
    var d = q.difficulty || 2;
    var dName = d === 3 ? "HARD" : d === 1 ? "EASY" : "MED";
    var dCls = d === 3 ? "hard" : d === 1 ? "easy" : "med";
    $("card").innerHTML =
      '<div class="chart">' +
        '<div class="roomrow">' +
          '<div class="qnum">' + (i + 1) + " / " + queue.length + "</div>" +
          '<div class="meta">' +
            '<span class="tag">' + extra + "</span>" +
            '<span class="tag ' + dCls + '">' + dName + "</span>" +
          "</div>" +
        "</div>" +
        (q.case ? '<div class="case" id="caseBox">' + escapeHtml(q.case) + "</div>" : "") +
        '<p class="stem" id="stemBox">' + escapeHtml(q.stem) + "</p>" +
        '<div class="opts" id="optBox">' + prep.opts.map(function (o, idx) {
          return '<button class="opt" type="button" data-i="' + idx + '"><span class="ltr">' + letters()[idx] + "</span><span>" + escapeHtml(o.t) + "</span></button>";
        }).join("") + "</div>" +
        '<div class="why" id="why"></div>' +
      "</div>";
    var box = $("optBox");
    if (box) box.querySelectorAll(".opt").forEach(function (b) { b.onclick = function () { tap(Number(b.dataset.i)); }; });
    if (restore && restore.locked) paintGrade(restore.gradedOk);
    else {
      selected.forEach(function (n) { var el = box && box.children[n]; if (el) el.classList.add("selected"); });
      if ($("mainBtn")) $("mainBtn").textContent = "CHECK";
    }
    paintHud();
    if ($("hint")) $("hint").classList.toggle("hidden", !!ui().hintSeen);
  }
  function render() {
    if (!queue.length || i < 0 || i >= queue.length || !queue[i]) {
      if (mode === "miss") return showEmptyMiss();
      if (mode === "case") return showCaseDebrief();
      if (mode === "shift") return showShiftDebrief();
      $("card").innerHTML = '<div class="chart"><p class="stem">Nothing in this set yet. Open ME and pick All / Easy / Medium / Hard.</p></div>';
      if ($("mainBtn")) $("mainBtn").textContent = "CHECK";
      paintHud();
      rendered = { raw: { id: "", stem: "", why: "", cat: "", difficulty: 2, opts: [], ans: [] }, multi: false, opts: [] };
      return;
    }
    renderFromPrepared(prepare(queue[i]), null);
  }
  function tap(idx) {
    if (locked || animating) return;
    if (!rendered.multi) selected = new Set([idx]);
    else if (selected.has(idx)) selected.delete(idx);
    else selected.add(idx);
    var box = $("optBox");
    if (!box) return;
    Array.prototype.forEach.call(box.children, function (el, n) { el.classList.toggle("selected", selected.has(n)); });
  }
  function exactMatch() {
    var need = new Set();
    rendered.opts.forEach(function (o, n) { if (o.k) need.add(n); });
    if (selected.size !== need.size) return false;
    var ok = true;
    selected.forEach(function (n) { if (!need.has(n)) ok = false; });
    return ok;
  }
  function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function paintGrade(ok) {
    var need = new Set();
    rendered.opts.forEach(function (o, n) { if (o.k) need.add(n); });
    var box = $("optBox");
    if (box) Array.prototype.forEach.call(box.children, function (el, n) {
      if (need.has(n)) el.classList.add("correct");
      else if (selected.has(n)) el.classList.add("wrong");
    });
    var why = $("why");
    var nx = "";
    if (!ok) {
      var lines = [];
      selected.forEach(function (n) {
        if (!rendered.opts[n].k && rendered.opts[n].w) lines.push("Not \u201c" + clip(rendered.opts[n].t, 42) + "\u201d because " + rendered.opts[n].w);
      });
      if (!lines.length) {
        var bait = rendered.opts.filter(function (o) { return !o.k && o.w; })[0];
        if (bait) lines.push("Not \u201c" + clip(bait.t, 42) + "\u201d because " + bait.w);
      }
      nx = lines.slice(0, 2).map(function (l) { return '<div class="nx">' + escapeHtml(l) + "</div>"; }).join("");
    } else {
      var bait2 = rendered.opts.filter(function (o) { return !o.k && o.w; })[0];
      if (bait2) nx = '<div class="nx">Not \u201c' + escapeHtml(clip(bait2.t, 42)) + "\u201d because " + escapeHtml(bait2.w) + "</div>";
    }
    if (why) {
      why.innerHTML = "<strong>" + (ok ? "Correct." : "Missed \u2014 saved.") + "</strong> " + escapeHtml(rendered.raw.why || "") + nx;
      why.classList.add("show");
    }
    if ($("mainBtn")) $("mainBtn").textContent = "NEXT";
  }
  function applyMissLogic(id, ok) {
    var s = stats();
    var miss = new Set(s.miss);
    var seenRight = Object.assign({}, s.seenRight);
    var gained = 0;
    var beforeLv = levelOf(s.xp || 0);
    if (ok) {
      seenRight[id] = (seenRight[id] || 0) + 1;
      if (seenRight[id] >= 2) { miss.delete(id); delete seenRight[id]; }
      gained = XP_PER[rendered.raw.difficulty || 2] || 20;
      if (streak >= 3) gained += 5;
    } else {
      miss.add(id);
      seenRight[id] = 0;
    }
    var byCat = Object.assign({}, s.byCat);
    var cat = rendered.raw.cat;
    byCat[cat] = byCat[cat] || { ok: 0, n: 0 };
    byCat[cat].n += 1;
    if (ok) byCat[cat].ok += 1;
    var byDiff = Object.assign({}, s.byDiff);
    var d = String(rendered.raw.difficulty || 2);
    byDiff[d] = byDiff[d] || { ok: 0, n: 0 };
    byDiff[d].n += 1;
    if (ok) byDiff[d].ok += 1;
    var review = s.review.slice();
    review.unshift({
      id: id,
      ok: ok,
      stem: rendered.raw.stem,
      cat: cat,
      diff: rendered.raw.difficulty || 2,
      why: rendered.raw.why,
      ts: Date.now()
    });
    if (review.length > 80) review = review.slice(0, 80);
    var xp = (s.xp || 0) + gained;
    saveStats({
      miss: Array.from(miss),
      seenRight: seenRight,
      byCat: byCat,
      byDiff: byDiff,
      review: review,
      ok: s.ok + (ok ? 1 : 0),
      n: s.n + 1,
      xp: xp
    });
    return { gained: gained, leveled: levelOf(xp) > beforeLv, level: levelOf(xp) };
  }
  function grade() {
    if (animating) return;
    if (locked) { next(1); return; }
    if (selected.size === 0) { toast("Pick an answer first"); return; }
    locked = true;
    var ok = exactMatch();
    gradedOk = ok;
    paintGrade(ok);
    var flash = $("flash");
    if (flash) {
      flash.className = "flash " + (ok ? "good" : "bad");
      setTimeout(function () { flash.className = "flash"; }, 280);
    }
    if (ok) {
      streak += 1;
      shiftCorrect += 1;
      shiftMaxStreak = Math.max(shiftMaxStreak, streak);
    } else {
      streak = 0;
    }
    var result = applyMissLogic(rendered.raw.id, ok);
    if (ok) {
      if (result.leveled) toast("LEVEL " + result.level + "!");
      else if (streak > 1) toast(streak + " streak  +" + result.gained);
      else toast("+" + result.gained + " XP");
      live("Correct. " + rendered.raw.why);
    } else {
      toast("Missed \u2014 saved");
      live("Incorrect. " + rendered.raw.why);
    }
    shiftLog.push({ id: rendered.raw.id, ok: ok, cat: rendered.raw.cat, stem: rendered.raw.stem });
    paintHud();
  }
  function snapshot() { return { i: i, selected: Array.from(selected), locked: locked, gradedOk: gradedOk, prep: rendered }; }
  function bankSkipMiss() {
    if (locked || !rendered) return;
    streak = 0;
    applyMissLogic(rendered.raw.id, false);
    shiftLog.push({ id: rendered.raw.id, ok: false, cat: rendered.raw.cat, stem: rendered.raw.stem, skipped: true });
    toast("Skipped \u2014 saved as missed");
    live("Skipped and saved as missed.");
    paintHud();
  }
  function atEnd() { return i >= queue.length - 1; }
  function resetCardEl(card) {
    if (!card) return;
    card.classList.remove("exit-up", "exit-down", "enter-from-down", "enter-from-up");
    card.style.transform = "";
    card.style.opacity = "";
  }
  function swapCard(dir, after) {
    var card = $("card");
    function finish() {
      try { after(); } catch (err) { console.error(err); }
      resetCardEl(card);
      animating = false;
    }
    if (!card) { finish(); return; }
    animating = true;
    resetCardEl(card);
    card.classList.add(dir > 0 ? "exit-up" : "exit-down");
    setTimeout(finish, 160);
  }
  function next(dir) {
    if (animating || !rendered) return;
    if (dir > 0 && !locked) bankSkipMiss();
    if (dir > 0 && (mode === "case" || mode === "shift") && atEnd()) {
      if (mode === "case") return showCaseDebrief();
      return showShiftDebrief();
    }
    if (dir > 0 && !queue.length) return render();
    history.push(snapshot());
    if (history.length > 40) history.shift();
    swapCard(dir, function () {
      if (dir > 0) {
        if (mode === "mix" || mode === "review" || mode === "miss") {
          if (queue.length) {
            i = (i + 1) % queue.length;
            if (i === 0 && mode === "mix") queue = shuffle(queue);
          }
        } else {
          i += 1;
        }
      }
      render();
      if (dir > 0 && !ui().hintSeen) saveUi({ hintSeen: true });
      if ($("hint")) $("hint").classList.add("hidden");
    });
  }
  function back() {
    if (animating) return;
    var prev = history.pop();
    if (!prev) { toast("First question"); return; }
    swapCard(-1, function () {
      i = prev.i;
      if (prev.prep && prev.prep.raw) renderFromPrepared(prev.prep, prev);
      else render();
    });
  }
  function hideOverlays() {
    ["gate", "menu", "debrief", "field"].forEach(function (id) {
      var el = $(id);
      if (el) el.classList.add("hidden");
    });
  }
  function showEmptyMiss() {
    $("debrief").className = "debrief";
    $("debrief").innerHTML = "<h2>No misses.</h2><p class=\"muted\">Get one wrong and it shows up here until you get it right twice.</p><div class=\"choice\"><button type=\"button\" id=\"dMix\"><b>Keep playing</b></button></div>";
    $("dMix").onclick = function () { startMode("mix"); };
  }
  function showCaseDebrief() {
    var pack = (CASES()[track] || {})[caseId] || { title: "Story", wrap: "" };
    var n = shiftLog.length; var ok = shiftLog.filter(function (x) { return x.ok; }).length;
    var misses = shiftLog.filter(function (x) { return !x.ok; });
    $("debrief").className = "debrief";
    $("debrief").innerHTML = "<h2>Story done.</h2><p class=\"muted\">" + ok + "/" + n + " on " + escapeHtml(pack.title) + "</p><p class=\"muted\">" + escapeHtml(pack.wrap || "") + "</p>" +
      (misses.length ? '<div class="miss-list">' + misses.map(function (m) { return "\u2022 " + escapeHtml(m.stem); }).join("<br>") + "</div>" : '<p class="muted">Clean run.</p>') +
      '<div class="choice"><button type="button" id="dMix"><b>Keep playing</b></button><button type="button" id="dMiss"><b>Play missed</b></button></div>';
    $("dMix").onclick = function () { startMode("mix"); };
    $("dMiss").onclick = function () { startMode("miss"); };
  }
  function showShiftDebrief() {
    var n = shiftLog.length; var ok = shiftLog.filter(function (x) { return x.ok; }).length;
    var pct = n ? Math.round(100 * ok / n) : 0;
    var misses = shiftLog.filter(function (x) { return !x.ok; });
    $("debrief").className = "debrief";
    $("debrief").innerHTML = "<h2>Quick 20 done.</h2><p class=\"muted\">" + ok + "/" + n + " \u00b7 " + pct + "% \u00b7 best streak " + shiftMaxStreak + "</p>" +
      (misses.length ? '<div class="miss-list">' + misses.slice(0, 8).map(function (m) { return "\u2022 " + escapeHtml(m.stem); }).join("<br>") + "</div>" : '<p class="muted">No misses.</p>') +
      '<div class="choice"><button type="button" id="dMiss"><b>Play missed</b></button><button type="button" id="dMix"><b>Keep playing</b></button></div>';
    $("dMiss").onclick = function () { startMode("miss"); };
    $("dMix").onclick = function () { startMode("mix"); };
  }
  function startMode(m, cid) {
    mode = m;
    if (cid) caseId = cid;
    hideOverlays();
    buildQueue();
    if (mode === "miss" && !queue.length) return showEmptyMiss();
    render();
  }
  function openFeed() {
    if (!track) { toast("Pick RN or PN first"); return; }
    var nm = $("nurseName") && $("nurseName").value.trim();
    if (nm) localStorage.setItem(nameKey, nm);
    localStorage.setItem("ward_track", track);
    streak = 0;
    hideOverlays();
    if (!queue.length) { mode = "mix"; buildQueue(); }
    render();
  }
  function showMenu(openCases) {
    var s = stats();
    var acc = s.n ? Math.round(100 * s.ok / s.n) : 0;
    $("menuCopy").textContent = (track || "").toUpperCase() + " \u00b7 LV " + levelOf(s.xp) + " \u00b7 " + acc + "% \u00b7 " + s.miss.length + " missed";
    var box = $("casePick");
    if (openCases) {
      box.classList.remove("hidden");
      var pack = CASES()[track] || {};
      box.innerHTML = Object.keys(pack).map(function (id) {
        return '<button type="button" data-case="' + id + '"><b>' + pack[id].title + "</b><span>6 questions</span></button>";
      }).join("") || '<p class="muted">Stories still loading.</p>';
      box.querySelectorAll("button").forEach(function (b) { b.onclick = function () { startMode("case", b.dataset.case); }; });
    } else box.classList.add("hidden");
    $("menu").classList.remove("hidden");
    applyFont();
  }
  function showField() {
    hideOverlays();
    var s = stats();
    var acc = s.n ? Math.round(100 * s.ok / s.n) : 0;
    var lv = levelOf(s.xp);
    function lane(d, label) {
      var b = s.byDiff[String(d)] || { ok: 0, n: 0 };
      var pct = b.n ? Math.round(100 * b.ok / b.n) : 0;
      return '<button class="lane' + (diffFilter === d ? " active" : "") + '" data-d="' + d + '"><b>' + label + "</b><span>" + (b.n ? pct + "% right" : "tap to play") + "</span></button>";
    }
    var missed = s.miss.map(function (id) { return byId(id); }).filter(Boolean);
    var missHtml = missed.length
      ? missed.slice(0, 16).map(function (q) {
          return '<button type="button" class="bad" data-jump="' + q.id + '"><b>' + escapeHtml(clip(q.stem, 90)) + "</b><em>Tap to try again</em></button>";
        }).join("")
      : '<p class="muted">No missed questions yet.</p>';
    $("field").className = "field";
    $("field").innerHTML =
      '<p class="kicker">' + (track || "").toUpperCase() + " \u00b7 Level " + lv + "</p>" +
      "<h2>" + acc + "%</h2>" +
      '<div class="statrow">' +
        '<div class="stat"><b>' + s.ok + "</b><span>correct</span></div>" +
        '<div class="stat"><b>' + s.miss.length + "</b><span>missed</span></div>" +
        '<div class="stat"><b>' + (s.xp || 0) + "</b><span>XP</span></div>" +
      "</div>" +
      '<p class="kicker">Play by level</p>' +
      '<div class="lanes">' + lane(0, "All") + lane(1, "Easy") + lane(2, "Med") + "</div>" +
      '<div class="lanes" style="grid-template-columns:1fr 1fr">' + lane(3, "Hard") + '<button class="lane" id="walkLane"><b>Play</b><span>Start this set</span></button></div>' +
      '<p class="kicker">Missed</p><div class="roomlist" id="missBox">' + missHtml + "</div>" +
      '<div class="choice">' +
        '<button type="button" id="fMiss"><b>Play all missed</b></button>' +
        '<button type="button" id="fMix"><b>Back to play</b></button>' +
      "</div>";
    $("field").querySelectorAll(".lane[data-d]").forEach(function (b) {
      b.onclick = function () { diffFilter = Number(b.dataset.d); showField(); };
    });
    $("walkLane").onclick = function () { startMode("mix"); };
    $("field").querySelectorAll("[data-jump]").forEach(function (b) {
      b.onclick = function () {
        var q = byId(b.dataset.jump);
        if (!q) return;
        mode = "review";
        queue = [q];
        i = 0;
        hideOverlays();
        render();
      };
    });
    $("fMiss").onclick = function () { startMode("miss"); };
    $("fMix").onclick = function () { startMode("mix"); };
  }
  function pickTrack(t) {
    track = t;
    if ($("pickRN")) $("pickRN").classList.toggle("active", t === "rn");
    if ($("pickPN")) $("pickPN").classList.toggle("active", t === "pn");
  }
  function isScrollableTarget(el) {
    var n = el;
    while (n && n !== document.body) {
      if (n.id === "optBox" || n.id === "stemBox" || n.id === "caseBox" || n.id === "why" || n.id === "field") return true;
      n = n.parentElement;
    }
    return false;
  }
  function bindSwipe() {
    var startY = null, startX = null;
    function down(e) { var t = e.touches ? e.touches[0] : e; startY = t.clientY; startX = t.clientX; }
    function up(e) {
      if (startY == null) return;
      var t = e.changedTouches ? e.changedTouches[0] : e;
      var dy = startY - t.clientY; var dx = Math.abs(t.clientX - startX); startY = null;
      if (dx > 70) return;
      if (dy > 56) next(1); else if (dy < -56) back();
    }
    ["handle", "dock"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener("touchstart", down, { passive: true });
      el.addEventListener("touchend", up, { passive: true });
    });
    if (!$("stage")) return;
    $("stage").addEventListener("touchstart", function (e) {
      if (isScrollableTarget(e.target) || (e.target.closest && e.target.closest(".opt"))) { startY = null; return; }
      down(e);
    }, { passive: true });
    $("stage").addEventListener("touchend", function (e) {
      if (startY == null || isScrollableTarget(e.target)) { startY = null; return; }
      up(e);
    }, { passive: true });
    var wheelLock = false;
    $("stage").addEventListener("wheel", function (e) {
      if (isScrollableTarget(e.target) || wheelLock || animating) return;
      if (e.deltaY > 40) { wheelLock = true; next(1); setTimeout(function () { wheelLock = false; }, 450); }
      else if (e.deltaY < -40) { wheelLock = true; back(); setTimeout(function () { wheelLock = false; }, 450); }
    }, { passive: true });
  }
  function bindKeys() {
    document.addEventListener("keydown", function (e) {
      if ($("gate").classList.contains("hidden") === false) return;
      if (!$("menu").classList.contains("hidden")) return;
      if (!$("debrief").classList.contains("hidden")) return;
      if (!$("field").classList.contains("hidden")) return;
      if (e.target && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key >= "1" && e.key <= "4") { tap(Number(e.key) - 1); e.preventDefault(); }
      else if (e.key === "Enter") { if (!locked) grade(); e.preventDefault(); }
      else if (e.key === "j" || e.key === "J" || e.key === " ") { next(1); e.preventDefault(); }
      else if (e.key === "k" || e.key === "K") { back(); e.preventDefault(); }
    });
  }
  function on(id, fn) { var el = $(id); if (el) el.onclick = fn; }
  on("pickRN", function () { pickTrack("rn"); });
  on("pickPN", function () { pickTrack("pn"); });
  on("startBtn", function () { mode = "mix"; buildQueue(); openFeed(); });
  on("mainBtn", function () { locked ? next(1) : grade(); });
  on("backBtn", back);
  on("menuBtn", function () { showMenu(false); });
  on("meBtn", showField);
  on("missChip", function () { startMode("miss"); });
  on("closeMenu", function () { $("menu").classList.add("hidden"); });
  on("modeMix", function () { startMode("mix"); });
  on("modeShift", function () { startMode("shift"); });
  on("modeCase", function () { showMenu(true); });
  on("switchTrack", function () { $("menu").classList.add("hidden"); $("gate").classList.remove("hidden"); });
  document.querySelectorAll("#fonts button").forEach(function (b) {
    b.onclick = function () { saveUi({ font: b.dataset.fs }); applyFont(); };
  });
  if ($("nurseName")) $("nurseName").value = nurseName();
  bindSwipe(); bindKeys(); applyFont();
  try {
    if (track === "rn" || track === "pn") { pickTrack(track); mode = "mix"; buildQueue(); openFeed(); }
    else if ($("gate")) $("gate").classList.remove("hidden");
  } catch (err) {
    if ($("gate")) $("gate").classList.remove("hidden");
    toast("Reload and tap PLAY");
  }
})();
