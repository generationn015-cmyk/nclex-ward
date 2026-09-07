/* NCLEX Ward - floor + field */
(function () {
  const BANK = window.NCLEX_BANK || [];
  const CASES = window.NCLEX_CASES || { rn: {}, pn: {} };
  const LABELS = window.NCLEX_LABELS || { rn: {}, pn: {} };
  const DIFFN = window.NCLEX_DIFF || { 1: "Stable", 2: "Watch", 3: "Crash" };
  const SHIFT_LEN = 20;
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
    return { ok: s.ok || 0, n: s.n || 0, miss: Array.isArray(s.miss) ? s.miss : [], seenRight: s.seenRight || {}, byCat: s.byCat || {}, byDiff: s.byDiff || {}, review: Array.isArray(s.review) ? s.review : [], streak: s.streak || 0 };
  }
  function saveStats(p) { localStorage.setItem(storeKey(), JSON.stringify(Object.assign(stats(), p))); }
  function pool() { return BANK.filter(function (q) { return q.tracks && q.tracks.indexOf(track) !== -1 && (!diffFilter || q.difficulty === diffFilter); }); }
  function byId(id) {
    var all = BANK.slice();
    Object.keys(CASES).forEach(function (t) {
      Object.keys(CASES[t] || {}).forEach(function (c) {
        ((CASES[t][c] && CASES[t][c].steps) || []).forEach(function (s) { all.push(s); });
      });
    });
    return all.filter(function (q) { return q.id === id; })[0];
  }
  function shuffle(a) {
    var x = a.slice();
    for (var n = x.length - 1; n > 0; n--) { var j = Math.floor(Math.random() * (n + 1)); var tmp = x[n]; x[n] = x[j]; x[j] = tmp; }
    return x;
  }
  function toast(t) { var el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(function () { el.classList.remove("show"); }, 1400); }
  function live(t) { $("live").textContent = t; }
  function applyFont() {
    var f = ui().font || "m";
    document.documentElement.classList.remove("fs-s", "fs-m", "fs-l");
    document.documentElement.classList.add("fs-" + f);
    document.querySelectorAll("#fonts button").forEach(function (b) { b.classList.toggle("active", b.dataset.fs === f); });
  }
  function buildQueue() {
    var bank = pool();
    history = []; i = 0; shiftCorrect = 0; shiftMaxStreak = 0; shiftLog = [];
    if (mode === "case") queue = ((CASES[track] || {})[caseId] || { steps: [] }).steps.slice();
    else if (mode === "miss") queue = shuffle(BANK.filter(function (q) { return q.tracks && q.tracks.indexOf(track) !== -1 && stats().miss.indexOf(q.id) !== -1; }));
    else if (mode === "review") {
      var ids = stats().review.map(function (r) { return r.id; }); var seen = {}; queue = [];
      ids.forEach(function (id) { if (seen[id]) return; var q = byId(id); if (q && q.tracks && q.tracks.indexOf(track) !== -1) { queue.push(q); seen[id] = 1; } });
    } else if (mode === "shift") queue = shuffle(bank).slice(0, SHIFT_LEN);
    else queue = shuffle(bank);
  }
  function paintPills() {
    $("trackPill").textContent = ((track || "-") + (diffFilter ? " " + (DIFFN[diffFilter] || "") : "")).toUpperCase();
    $("streak").textContent = String(streak); $("score").textContent = String(shiftCorrect);
    var floor = $("floor"); if (!floor) return;
    var html = "";
    for (var n = 0; n < 8; n++) {
      var cls = "bay";
      if (queue.length) {
        var idx = i % 8;
        if (n === idx) cls += rendered && rendered.raw && rendered.raw.difficulty === 3 ? " hot" : " on";
        else if (n < idx || (mode !== "mix" && n < Math.min(i, 8))) cls += " done";
      }
      html += '<i class="' + cls + '"></i>';
    }
    floor.innerHTML = html;
  }
  function prepare(q) {
    var opts = q.opts.map(function (t, idx) { return { t: t, k: q.ans.indexOf(idx) !== -1, w: (q.whyWrong && q.whyWrong[idx]) || "" }; });
    return { raw: q, multi: q.multi, opts: shuffle(opts) };
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&"+"amp;").replace(/</g, "&"+"lt;").replace(/>/g, "&"+"gt;").replace(/"/g, "&"+"quot;").replace(/'/g, "&#39;");
  }
  function letters() { return ["A", "B", "C", "D", "E", "F"]; }
  function renderFromPrepared(prep, restore) {
    rendered = prep; var q = prep.raw;
    selected = restore ? new Set(restore.selected) : new Set();
    locked = restore ? restore.locked : false; gradedOk = restore ? restore.gradedOk : null;
    var labels = LABELS[track] || {};
    var extra = q.multi ? "SELECT ALL" : "ONE ACTION";
    var d = q.difficulty || 2; var dName = DIFFN[d] || "Watch"; var dCls = d === 3 ? "crash" : d === 1 ? "stable" : "watch";
    var room = 410 + ((i + (q.id || "").length) % 18);
    $("card").innerHTML = '<div class="chart"><div class="roomrow"><div class="room">RM ' + room + '</div><div class="meta"><span class="tag">' + extra + '</span><span class="tag ' + dCls + '">' + dName + '</span><span class="tag">' + escapeHtml(labels[q.cat] || q.cat || "") + '</span><span class="tag">' + (i + 1) + '/' + queue.length + '</span></div></div>' + (q.case ? '<div class="case" id="caseBox">' + escapeHtml(q.case) + '</div>' : '') + '<p class="stem" id="stemBox">' + escapeHtml(q.stem) + '</p><div class="opts" id="optBox">' + prep.opts.map(function (o, idx) { return '<button class="opt" type="button" data-i="' + idx + '"><span class="ltr">' + letters()[idx] + '</span><span>' + escapeHtml(o.t) + '</span></button>'; }).join('') + '</div><div class="why" id="why"></div></div>';
    $("optBox").querySelectorAll(".opt").forEach(function (b) { b.onclick = function () { tap(Number(b.dataset.i)); }; });
    if (restore && restore.locked) paintGrade(restore.gradedOk);
    else { selected.forEach(function (n) { var el = $("optBox").children[n]; if (el) el.classList.add("selected"); }); $("mainBtn").textContent = "LOCK CHART"; }
    paintPills(); $("hint").classList.toggle("hidden", !!ui().hintSeen);
  }
  function render() {
    if (!queue.length) { if (mode === "miss") return showEmptyMiss(); $("card").innerHTML = '<div class="chart"><p class="stem">No rooms on this lane yet.</p></div>'; paintPills(); return; }
    renderFromPrepared(prepare(queue[i]), null);
  }
  function tap(idx) {
    if (locked || animating) return;
    if (!rendered.multi) selected = new Set([idx]); else if (selected.has(idx)) selected.delete(idx); else selected.add(idx);
    Array.prototype.forEach.call($("optBox").children, function (el, n) { el.classList.toggle("selected", selected.has(n)); });
  }
  function exactMatch() {
    var need = new Set(); rendered.opts.forEach(function (o, n) { if (o.k) need.add(n); });
    if (selected.size !== need.size) return false; var ok = true; selected.forEach(function (n) { if (!need.has(n)) ok = false; }); return ok;
  }
  function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '...' : s; }
  function paintGrade(ok) {
    var need = new Set(); rendered.opts.forEach(function (o, n) { if (o.k) need.add(n); });
    Array.prototype.forEach.call($("optBox").children, function (el, n) { if (need.has(n)) el.classList.add("correct"); else if (selected.has(n)) el.classList.add("wrong"); });
    var why = $("why"); var nx = "";
    if (!ok) {
      var lines = [];
      selected.forEach(function (n) { if (!rendered.opts[n].k && rendered.opts[n].w) lines.push('Not "' + clip(rendered.opts[n].t, 42) + '" because ' + rendered.opts[n].w); });
      if (!lines.length) { var bait = rendered.opts.filter(function (o) { return !o.k && o.w; })[0]; if (bait) lines.push('Not "' + clip(bait.t, 42) + '" because ' + bait.w); }
      nx = lines.slice(0, 2).map(function (l) { return '<div class="nx">' + escapeHtml(l) + '</div>'; }).join('');
    } else {
      var bait2 = rendered.opts.filter(function (o) { return !o.k && o.w; })[0];
      if (bait2) nx = '<div class="nx">Not "' + escapeHtml(clip(bait2.t, 42)) + '" because ' + escapeHtml(bait2.w) + '</div>';
    }
    why.innerHTML = '<strong>' + (ok ? 'Clean.' : 'Miss - stays on your field.') + '</strong> ' + escapeHtml(rendered.raw.why) + nx;
    why.classList.add("show"); $("mainBtn").textContent = "NEXT ROOM";
  }
  function applyMissLogic(id, ok) {
    var s = stats(); var miss = new Set(s.miss); var seenRight = Object.assign({}, s.seenRight);
    if (ok) { seenRight[id] = (seenRight[id] || 0) + 1; if (seenRight[id] >= 2) { miss.delete(id); delete seenRight[id]; } }
    else { miss.add(id); seenRight[id] = 0; }
    var byCat = Object.assign({}, s.byCat); var cat = rendered.raw.cat; byCat[cat] = byCat[cat] || { ok: 0, n: 0 }; byCat[cat].n += 1; if (ok) byCat[cat].ok += 1;
    var byDiff = Object.assign({}, s.byDiff); var d = String(rendered.raw.difficulty || 2); byDiff[d] = byDiff[d] || { ok: 0, n: 0 }; byDiff[d].n += 1; if (ok) byDiff[d].ok += 1;
    var review = s.review.slice(); review.unshift({ id: id, ok: ok, stem: rendered.raw.stem, cat: cat, diff: rendered.raw.difficulty || 2, why: rendered.raw.why, ts: Date.now() }); if (review.length > 80) review = review.slice(0, 80);
    saveStats({ miss: Array.from(miss), seenRight: seenRight, byCat: byCat, byDiff: byDiff, review: review, ok: s.ok + (ok ? 1 : 0), n: s.n + 1 });
  }
  function grade() {
    if (animating) return; if (locked) { next(1); return; } if (selected.size === 0) { toast("pick an action first"); return; }
    locked = true; var ok = exactMatch(); gradedOk = ok; paintGrade(ok);
    var flash = $("flash"); flash.className = "flash " + (ok ? "good" : "bad"); setTimeout(function () { flash.className = "flash"; }, 280);
    if (ok) { streak += 1; shiftCorrect += 1; shiftMaxStreak = Math.max(shiftMaxStreak, streak); toast(streak > 1 ? streak + " streak" : "charted"); live("Correct. " + rendered.raw.why); }
    else { streak = 0; toast("on the callback list"); live("Incorrect. " + rendered.raw.why); }
    applyMissLogic(rendered.raw.id, ok); shiftLog.push({ id: rendered.raw.id, ok: ok, cat: rendered.raw.cat, stem: rendered.raw.stem }); paintPills();
  }
  function snapshot() { return { i: i, selected: Array.from(selected), locked: locked, gradedOk: gradedOk, prep: rendered }; }
  function bankSkipMiss() {
    if (locked || !rendered) return; streak = 0; applyMissLogic(rendered.raw.id, false);
    shiftLog.push({ id: rendered.raw.id, ok: false, cat: rendered.raw.cat, stem: rendered.raw.stem, skipped: true }); toast("banked as missed"); live("Skipped and banked as missed."); paintPills();
  }
  function atEnd() { return i >= queue.length - 1; }
  function next(dir) {
    if (animating || !rendered) return; if (dir > 0 && !locked) bankSkipMiss();
    if (dir > 0 && (mode === "case" || mode === "shift") && atEnd()) { if (mode === "case") return showCaseDebrief(); return showShiftDebrief(); }
    animating = true; history.push(snapshot()); if (history.length > 40) history.shift();
    var card = $("card"); card.classList.add(dir > 0 ? "exit-up" : "exit-down");
    setTimeout(function () {
      if (dir > 0) { if (mode === "mix" || mode === "review") { i = (i + 1) % queue.length; if (i === 0) queue = shuffle(queue); } else i += 1; render(); card.classList.add("enter-from-down"); }
      else { render(); card.classList.add("enter-from-up"); }
      requestAnimationFrame(function () { card.classList.remove("enter-from-down", "enter-from-up"); });
      animating = false; if (dir > 0 && !ui().hintSeen) saveUi({ hintSeen: true }); $("hint").classList.add("hidden");
    }, 200);
  }
  function back() {
    if (animating) return; var prev = history.pop(); if (!prev) { toast("first room on the hall"); return; }
    animating = true; var card = $("card"); card.classList.add("exit-down");
    setTimeout(function () { i = prev.i; renderFromPrepared(prev.prep, prev); card.classList.add("enter-from-up"); requestAnimationFrame(function () { card.classList.remove("enter-from-up"); }); animating = false; }, 200);
  }
  function hideOverlays() { $("gate").classList.add("hidden"); $("menu").classList.add("hidden"); $("debrief").classList.add("hidden"); if ($("field")) $("field").classList.add("hidden"); }
  function showEmptyMiss() {
    $("debrief").className = "debrief";
    $("debrief").innerHTML = '<h2>Callback list is clear.</h2><p class="muted">Misses stay until you get them clean twice.</p><div class="choice"><button type="button" id="dMix"><b>Walk the floor</b></button><button type="button" id="dField"><b>Open my field</b></button></div>';
    $("dMix").onclick = function () { startMode("mix"); }; $("dField").onclick = showField;
  }
  function showCaseDebrief() {
    var pack = (CASES[track] || {})[caseId] || { title: "Case", wrap: "" };
    var n = shiftLog.length; var ok = shiftLog.filter(function (x) { return x.ok; }).length; var misses = shiftLog.filter(function (x) { return !x.ok; });
    $("debrief").className = "debrief";
    $("debrief").innerHTML = '<h2>Case closed.</h2><p class="muted">' + ok + '/' + n + ' on ' + escapeHtml(pack.title) + '</p><p class="muted">' + escapeHtml(pack.wrap || '') + '</p>' + (misses.length ? '<div class="miss-list">' + misses.map(function (m) { return '* ' + escapeHtml(m.stem); }).join('<br>') + '</div>' : '<p class="muted">Clean case.</p>') + '<div class="choice"><button type="button" id="dMix"><b>Walk the floor</b></button><button type="button" id="dMiss"><b>Callback list</b></button><button type="button" id="dField"><b>My field</b></button></div>';
    $("dMix").onclick = function () { startMode("mix"); }; $("dMiss").onclick = function () { startMode("miss"); }; $("dField").onclick = showField;
  }
  function showShiftDebrief() {
    var n = shiftLog.length; var ok = shiftLog.filter(function (x) { return x.ok; }).length; var pct = n ? Math.round(100 * ok / n) : 0; var misses = shiftLog.filter(function (x) { return !x.ok; });
    $("debrief").className = "debrief";
    $("debrief").innerHTML = '<h2>End of shift.</h2><p class="muted">' + ok + '/' + n + ' ' + pct + '% max streak ' + shiftMaxStreak + '</p>' + (misses.length ? '<div class="miss-list">' + misses.slice(0, 8).map(function (m) { return '* ' + escapeHtml(m.stem); }).join('<br>') + '</div>' : '<p class="muted">No misses this shift.</p>') + '<div class="choice"><button type="button" id="dMiss"><b>Review missed</b></button><button type="button" id="dField"><b>My field</b></button><button type="button" id="dMix"><b>Walk the floor</b></button></div>';
    $("dMiss").onclick = function () { startMode("miss"); }; $("dField").onclick = showField; $("dMix").onclick = function () { startMode("mix"); };
  }
  function startMode(m, cid) { mode = m; if (cid) caseId = cid; hideOverlays(); buildQueue(); if (mode === "miss" && !queue.length) return showEmptyMiss(); render(); }
  function openFeed() {
    if (!track) { toast("RN or PN first"); return; }
    var nm = $("nurseName") && $("nurseName").value.trim(); if (nm) localStorage.setItem(nameKey, nm);
    localStorage.setItem("ward_track", track); streak = 0; hideOverlays(); if (!queue.length) { mode = "mix"; buildQueue(); } render();
  }
  function showMenu(openCases) {
    var s = stats(); var acc = s.n ? Math.round(100 * s.ok / s.n) : 0;
    $("menuCopy").textContent = (nurseName() ? nurseName() + ' · ' : '') + (track || '').toUpperCase() + ' · ' + acc + '% (' + s.ok + '/' + s.n + ') · callbacks ' + s.miss.length;
    var box = $("casePick");
    if (openCases) {
      box.classList.remove("hidden"); var pack = CASES[track] || {};
      box.innerHTML = Object.keys(pack).map(function (id) { return '<button type="button" data-case="' + id + '"><b>' + pack[id].title + '</b><span>6-step unfolding case</span></button>'; }).join('') || '<p class="muted">Cases still loading.</p>';
      box.querySelectorAll("button").forEach(function (b) { b.onclick = function () { startMode("case", b.dataset.case); }; });
    } else box.classList.add("hidden");
    $("menu").classList.remove("hidden"); applyFont();
  }
  function showField() {
    hideOverlays();
    var s = stats(); var acc = s.n ? Math.round(100 * s.ok / s.n) : 0; var labels = LABELS[track] || LABELS.rn || {};
    var cats = ["care", "sic", "hpm", "psy", "bcc", "pharm", "rrp", "pa"];
    var bars = cats.map(function (k) { var c = s.byCat[k] || { ok: 0, n: 0 }; var pct = c.n ? Math.round(100 * c.ok / c.n) : 0; var weak = c.n >= 3 && pct < 70; return '<div class="barrow"><span>' + escapeHtml(labels[k] || k) + '</span><div class="track' + (weak ? ' weak' : '') + '"><i style="width:' + pct + '%"></i></div><span>' + (c.n ? pct + '%' : '-') + '</span></div>'; }).join('');
    function lane(d, label) { var b = s.byDiff[String(d)] || { ok: 0, n: 0 }; var pct = b.n ? Math.round(100 * b.ok / b.n) : 0; return '<button class="lane' + (diffFilter === d ? ' active' : '') + '" data-d="' + d + '"><b>' + label + '</b><span>' + (b.n ? pct + '% · ' + b.n + ' rooms' : 'not walked') + '</span></button>'; }
    var missed = s.miss.map(function (id) { return byId(id); }).filter(Boolean);
    var missHtml = missed.length ? missed.slice(0, 20).map(function (q) { return '<button type="button" class="bad" data-jump="' + q.id + '"><b>' + escapeHtml(clip(q.stem, 90)) + '</b><em>' + escapeHtml(labels[q.cat] || '') + ' · ' + (DIFFN[q.difficulty] || '') + ' · needs 2 clean hits</em></button>'; }).join('') : '<p class="muted">No rooms on the callback list.</p>';
    var recent = s.review.slice(0, 12);
    var revHtml = recent.length ? recent.map(function (r) { return '<button type="button" class="' + (r.ok ? 'ok' : 'bad') + '" data-jump="' + r.id + '"><b>' + (r.ok ? 'HIT · ' : 'MISS · ') + escapeHtml(clip(r.stem, 80)) + '</b><em>' + escapeHtml(r.why || '') + '</em></button>'; }).join('') : '<p class="muted">Work a room and it lands here to review.</p>';
    $("field").className = "field";
    $("field").innerHTML = '<p class="kicker">Assignment field</p><h2>' + escapeHtml(nurseName() || 'Night nurse') + '</h2><p class="muted">' + (track || '').toUpperCase() + ' · lifetime ' + acc + '% (' + s.ok + '/' + s.n + ') · ' + s.miss.length + ' callbacks. Weak bars turn red after 3+ tries under 70%.</p><div class="who"><input id="fieldName" maxlength="24" value="' + escapeHtml(nurseName()) + '" placeholder="Name on the board"><button class="btn ghost" id="saveName" type="button">Save</button></div><p class="kicker">Difficulty lanes</p><div class="lanes">' + lane(0, 'Whole floor') + lane(1, 'Stable') + lane(2, 'Watch') + '</div><div class="lanes" style="grid-template-columns:1fr 1fr">' + lane(3, 'Crash') + '<button class="lane" id="walkLane"><b>Walk this lane</b><span>Filter the mix</span></button></div><p class="kicker">Client needs</p><div class="bars">' + bars + '</div><p class="kicker">Got wrong - callback list</p><div class="roomlist">' + missHtml + '</div><p class="kicker">Review log</p><div class="roomlist">' + revHtml + '</div><div class="choice"><button type="button" id="fMiss"><b>Drill callbacks</b><span>Only the rooms you missed</span></button><button type="button" id="fRev"><b>Replay review log</b><span>Hits and misses you already charted</span></button><button type="button" id="fMix"><b>Back to the floor</b></button></div>';
    $("field").querySelectorAll(".lane[data-d]").forEach(function (b) { b.onclick = function () { diffFilter = Number(b.dataset.d); showField(); }; });
    $("walkLane").onclick = function () { startMode("mix"); };
    $("saveName").onclick = function () { localStorage.setItem(nameKey, $("fieldName").value.trim()); toast("name on the board"); showField(); };
    $("field").querySelectorAll("[data-jump]").forEach(function (b) { b.onclick = function () { var q = byId(b.dataset.jump); if (!q) return; mode = "review"; queue = [q]; i = 0; hideOverlays(); render(); }; });
    $("fMiss").onclick = function () { startMode("miss"); }; $("fRev").onclick = function () { startMode("review"); }; $("fMix").onclick = function () { startMode("mix"); };
  }
  function pickTrack(t) { track = t; $("pickRN").classList.toggle("active", t === "rn"); $("pickPN").classList.toggle("active", t === "pn"); }
  function isScrollableTarget(el) { var n = el; while (n && n !== document.body) { if (n.id === "optBox" || n.id === "stemBox" || n.id === "caseBox" || n.id === "why" || n.id === "field") return true; n = n.parentElement; } return false; }
  function bindSwipe() {
    var startY = null, startX = null;
    function down(e) { var t = e.touches ? e.touches[0] : e; startY = t.clientY; startX = t.clientX; }
    function up(e) { if (startY == null) return; var t = e.changedTouches ? e.changedTouches[0] : e; var dy = startY - t.clientY; var dx = Math.abs(t.clientX - startX); startY = null; if (dx > 70) return; if (dy > 56) next(1); else if (dy < -56) back(); }
    ["handle", "dock"].forEach(function (id) { $(id).addEventListener("touchstart", down, { passive: true }); $(id).addEventListener("touchend", up, { passive: true }); });
    $("stage").addEventListener("touchstart", function (e) { if (isScrollableTarget(e.target) || (e.target.closest && e.target.closest(".opt"))) { startY = null; return; } down(e); }, { passive: true });
    $("stage").addEventListener("touchend", function (e) { if (startY == null || isScrollableTarget(e.target)) { startY = null; return; } up(e); }, { passive: true });
    var wheelLock = false;
    $("stage").addEventListener("wheel", function (e) { if (isScrollableTarget(e.target) || wheelLock || animating) return; if (e.deltaY > 40) { wheelLock = true; next(1); setTimeout(function () { wheelLock = false; }, 450); } else if (e.deltaY < -40) { wheelLock = true; back(); setTimeout(function () { wheelLock = false; }, 450); } }, { passive: true });
  }
  function bindKeys() {
    document.addEventListener("keydown", function (e) {
      if ($("gate").classList.contains("hidden") === false) return;
      if (!$("menu").classList.contains("hidden")) return;
      if (!$("debrief").classList.contains("hidden")) return;
      if ($("field") && !$("field").classList.contains("hidden")) return;
      if (e.target && ["INPUT", "TEXTAREA"].indexOf(e.target.tagName) !== -1) return;
      if (e.key >= "1" && e.key <= "4") { tap(Number(e.key) - 1); e.preventDefault(); }
      else if (e.key === "Enter") { if (!locked) grade(); e.preventDefault(); }
      else if (e.key === "j" || e.key === "J" || e.key === " ") { next(1); e.preventDefault(); }
      else if (e.key === "k" || e.key === "K") { back(); e.preventDefault(); }
    });
  }
  $("pickRN").onclick = function () { pickTrack("rn"); };
  $("pickPN").onclick = function () { pickTrack("pn"); };
  $("startBtn").onclick = function () { mode = "mix"; buildQueue(); openFeed(); };
  $("mainBtn").onclick = function () { locked ? next(1) : grade(); };
  $("backBtn").onclick = back;
  $("menuBtn").onclick = function () { showMenu(false); };
  $("closeMenu").onclick = function () { $("menu").classList.add("hidden"); };
  $("modeMix").onclick = function () { startMode("mix"); };
  $("modeShift").onclick = function () { startMode("shift"); };
  $("modeCase").onclick = function () { showMenu(true); };
  $("modeMiss").onclick = function () { startMode("miss"); };
  if ($("openField")) $("openField").onclick = showField;
  $("switchTrack").onclick = function () { $("menu").classList.add("hidden"); $("gate").classList.remove("hidden"); };
  document.querySelectorAll("#fonts button").forEach(function (b) { b.onclick = function () { saveUi({ font: b.dataset.fs }); applyFont(); }; });
  if ($("nurseName")) $("nurseName").value = nurseName();
  bindSwipe(); bindKeys(); applyFont();
  if (track === "rn" || track === "pn") { pickTrack(track); mode = "mix"; buildQueue(); openFeed(); }
  else $("gate").classList.remove("hidden");
})();
