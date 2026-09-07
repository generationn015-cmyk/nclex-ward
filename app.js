/* NCLEX Ward swipe feed */
(function () {
  const BANK = window.NCLEX_BANK || [];
  const CASES = window.NCLEX_CASES || { rn: {}, pn: {} };
  const LABELS = window.NCLEX_LABELS || { rn: {}, pn: {} };
  const SHIFT_LEN = 20;
  const $ = (id) => document.getElementById(id);
  const uiKey = "ward_ui";
  let track = localStorage.getItem("ward_track") || "";
  let mode = "mix";
  let caseId = "sepsis";
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
  function ui() { try { return JSON.parse(localStorage.getItem(uiKey) || "{}"); } catch { return {}; } }
  function saveUi(p) { localStorage.setItem(uiKey, JSON.stringify(Object.assign({ hintSeen: false, font: "m" }, ui(), p))); }
  function storeKey() { return "ward_" + (track || "x"); }
  function rawStats() { try { return JSON.parse(localStorage.getItem(storeKey()) || "{}"); } catch { return {}; } }
  function stats() {
    const s = rawStats();
    return { ok: s.ok || 0, n: s.n || 0, miss: Array.isArray(s.miss) ? s.miss : [], seenRight: s.seenRight || {}, byCat: s.byCat || {}, streak: s.streak || 0 };
  }
  function saveStats(p) { localStorage.setItem(storeKey(), JSON.stringify(Object.assign(stats(), p))); }
  function pool() { return BANK.filter((q) => q.tracks && q.tracks.includes(track)); }
  function allCaseItems() {
    const out = [];
    Object.values(CASES).forEach((pack) => { Object.values(pack || {}).forEach((c) => out.push(...(c.steps || []))); });
    return out;
  }
  function shuffle(a) {
    const x = a.slice();
    for (let n = x.length - 1; n > 0; n--) { const j = Math.floor(Math.random() * (n + 1)); [x[n], x[j]] = [x[j], x[n]]; }
    return x;
  }
  function toast(t) {
    const el = $("toast"); el.textContent = t; el.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove("show"), 1400);
  }
  function live(t) { $("live").textContent = t; }
  function applyFont() {
    const f = ui().font || "m";
    document.documentElement.classList.remove("fs-s", "fs-m", "fs-l");
    document.documentElement.classList.add("fs-" + f);
    document.querySelectorAll("#fonts button").forEach((b) => b.classList.toggle("active", b.dataset.fs === f));
  }
  function buildQueue() {
    const bank = pool();
    history = []; i = 0; shiftCorrect = 0; shiftMaxStreak = 0; shiftLog = [];
    if (mode === "case") queue = ((CASES[track] || {})[caseId] || { steps: [] }).steps.slice();
    else if (mode === "miss") queue = shuffle(bank.filter((q) => stats().miss.includes(q.id)));
    else if (mode === "shift") queue = shuffle(bank).slice(0, SHIFT_LEN);
    else queue = shuffle(bank);
  }
  function paintPills() {
    $("trackPill").textContent = (track || "—").toUpperCase();
    $("streak").textContent = String(streak);
    $("score").textContent = String(shiftCorrect);
  }
  function prepare(q) {
    const opts = q.opts.map((t, idx) => ({ t, k: q.ans.includes(idx), w: (q.whyWrong && q.whyWrong[idx]) || "" }));
    return { raw: q, multi: q.multi, opts: shuffle(opts) };
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&", "<": "<", ">": ">", '"': """, "'": "&#39;" }[c]));
  }
  function renderFromPrepared(prep, restore) {
    rendered = prep;
    const q = prep.raw;
    selected = restore ? new Set(restore.selected) : new Set();
    locked = restore ? restore.locked : false;
    gradedOk = restore ? restore.gradedOk : null;
    const labels = LABELS[track] || {};
    const extra = q.multi ? " · select all" : "";
    $("card").innerHTML =
      `<div class="kicker">${labels[q.cat] || q.cat} · ${i + 1}/${queue.length}${extra}</div>` +
      (q.case ? `<div class="case" id="caseBox">${escapeHtml(q.case)}</div>` : "") +
      `<p class="stem" id="stemBox">${escapeHtml(q.stem)}</p>` +
      `<div class="opts" id="optBox">${prep.opts.map((o, idx) => `<button class="opt" type="button" data-i="${idx}">${escapeHtml(o.t)}</button>`).join("")}</div>` +
      `<div class="why" id="why"></div>`;
    $("optBox").querySelectorAll(".opt").forEach((b) => { b.onclick = () => tap(Number(b.dataset.i)); });
    if (restore && restore.locked) paintGrade(restore.gradedOk);
    else {
      selected.forEach((n) => { const el = $("optBox").children[n]; if (el) el.classList.add("selected"); });
      $("mainBtn").textContent = "Lock in";
    }
    paintPills();
    $("hint").classList.toggle("hidden", !!ui().hintSeen);
  }
  function render() {
    if (!queue.length) {
      if (mode === "miss") return showEmptyMiss();
      $("card").innerHTML = `<p class="kicker">Deck</p><p class="stem">No items loaded for this track yet. Hard-refresh in a minute if you just opened this.</p>`;
      return;
    }
    renderFromPrepared(prepare(queue[i]), null);
  }
  function tap(idx) {
    if (locked || animating) return;
    if (!rendered.multi) selected = new Set([idx]);
    else if (selected.has(idx)) selected.delete(idx);
    else selected.add(idx);
    [...$("optBox").children].forEach((el, n) => el.classList.toggle("selected", selected.has(n)));
  }
  function exactMatch() {
    const need = new Set(rendered.opts.map((o, n) => (o.k ? n : null)).filter((n) => n !== null));
    if (selected.size !== need.size) return false;
    for (const n of selected) if (!need.has(n)) return false;
    return true;
  }
  function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function paintGrade(ok) {
    const need = new Set(rendered.opts.map((o, n) => (o.k ? n : null)).filter((n) => n !== null));
    [...$("optBox").children].forEach((el, n) => {
      if (need.has(n)) el.classList.add("correct");
      else if (selected.has(n)) el.classList.add("wrong");
    });
    const why = $("why");
    let nx = "";
    if (!ok) {
      const lines = [];
      selected.forEach((n) => {
        if (!rendered.opts[n].k && rendered.opts[n].w) lines.push("Not \u201c" + clip(rendered.opts[n].t, 42) + "\u201d because " + rendered.opts[n].w);
      });
      if (!lines.length) {
        const bait = rendered.opts.find((o) => !o.k && o.w);
        if (bait) lines.push("Not \u201c" + clip(bait.t, 42) + "\u201d because " + bait.w);
      }
      nx = lines.slice(0, 2).map((l) => `<div class="nx">${escapeHtml(l)}</div>`).join("");
    } else {
      const bait = rendered.opts.find((o) => !o.k && o.w);
      if (bait) nx = `<div class="nx">Not \u201c${escapeHtml(clip(bait.t, 42))}\u201d because ${escapeHtml(bait.w)}</div>`;
    }
    why.innerHTML = `<strong>${ok ? "Clean." : "Miss."}</strong> ${escapeHtml(rendered.raw.why)}${nx}`;
    why.classList.add("show");
    $("mainBtn").textContent = "Swipe up";
  }
  function applyMissLogic(id, ok) {
    const s = stats();
    const miss = new Set(s.miss);
    const seenRight = Object.assign({}, s.seenRight);
    if (ok) {
      seenRight[id] = (seenRight[id] || 0) + 1;
      if (seenRight[id] >= 2) { miss.delete(id); delete seenRight[id]; }
    } else { miss.add(id); seenRight[id] = 0; }
    const byCat = Object.assign({}, s.byCat);
    const cat = rendered.raw.cat;
    byCat[cat] = byCat[cat] || { ok: 0, n: 0 };
    byCat[cat].n += 1;
    if (ok) byCat[cat].ok += 1;
    saveStats({ miss: [...miss], seenRight, byCat, ok: s.ok + (ok ? 1 : 0), n: s.n + 1 });
  }
  function grade() {
    if (animating) return;
    if (locked) { next(1); return; }
    if (selected.size === 0) { toast("pick something first"); return; }
    locked = true;
    const ok = exactMatch();
    gradedOk = ok;
    paintGrade(ok);
    const flash = $("flash");
    flash.className = "flash " + (ok ? "good" : "bad");
    setTimeout(() => { flash.className = "flash"; }, 280);
    if (ok) { streak += 1; shiftCorrect += 1; shiftMaxStreak = Math.max(shiftMaxStreak, streak); toast(streak > 1 ? streak + " streak" : "yes"); live("Correct. " + rendered.raw.why); }
    else { streak = 0; toast("read it \u00b7 then swipe"); live("Incorrect. " + rendered.raw.why); }
    applyMissLogic(rendered.raw.id, ok);
    shiftLog.push({ id: rendered.raw.id, ok, cat: rendered.raw.cat, stem: rendered.raw.stem });
    paintPills();
  }
  function snapshot() { return { i, selected: [...selected], locked, gradedOk, prep: rendered }; }
  function bankSkipMiss() {
    if (locked || !rendered) return;
    streak = 0;
    applyMissLogic(rendered.raw.id, false);
    shiftLog.push({ id: rendered.raw.id, ok: false, cat: rendered.raw.cat, stem: rendered.raw.stem, skipped: true });
    toast("banked as missed"); live("Skipped and banked as missed."); paintPills();
  }
  function atEnd() { return i >= queue.length - 1; }
  function next(dir) {
    if (animating || !rendered) return;
    if (dir > 0 && !locked) bankSkipMiss();
    if (dir > 0 && (mode === "case" || mode === "shift") && atEnd()) {
      if (mode === "case") return showCaseDebrief();
      return showShiftDebrief();
    }
    animating = true;
    history.push(snapshot());
    if (history.length > 40) history.shift();
    const card = $("card");
    card.classList.add(dir > 0 ? "exit-up" : "exit-down");
    setTimeout(() => {
      if (dir > 0) {
        if (mode === "mix") { i = (i + 1) % queue.length; if (i === 0) queue = shuffle(queue); }
        else i += 1;
        render(); card.classList.add("enter-from-down");
      } else { render(); card.classList.add("enter-from-up"); }
      requestAnimationFrame(() => card.classList.remove("enter-from-down", "enter-from-up"));
      animating = false;
      if (dir > 0 && !ui().hintSeen) saveUi({ hintSeen: true });
      $("hint").classList.add("hidden");
    }, 200);
  }
  function back() {
    if (animating) return;
    const prev = history.pop();
    if (!prev) { toast("start of the pile"); return; }
    animating = true;
    const card = $("card");
    card.classList.add("exit-down");
    setTimeout(() => {
      i = prev.i; renderFromPrepared(prev.prep, prev);
      card.classList.add("enter-from-up");
      requestAnimationFrame(() => card.classList.remove("enter-from-up"));
      animating = false;
    }, 200);
  }
  function showEmptyMiss() {
    $("debrief").className = "debrief";
    $("debrief").innerHTML = `<h2>Missed bin is empty.</h2><p class="muted">Nothing sitting in the missed bin. Two clean answers are required to graduate an item out of it.</p><div class="choice"><button type="button" id="dMix"><b>Endless mix</b></button><button type="button" id="dShift"><b>Work a shift</b></button></div>`;
    $("dMix").onclick = () => startMode("mix"); $("dShift").onclick = () => startMode("shift");
  }
  function showCaseDebrief() {
    const pack = (CASES[track] || {})[caseId] || { title: "Case", wrap: "" };
    const n = shiftLog.length; const ok = shiftLog.filter((x) => x.ok).length;
    const misses = shiftLog.filter((x) => !x.ok);
    $("debrief").className = "debrief";
    $("debrief").innerHTML = `<h2>Case closed.</h2><p class="muted">${ok}/${n} on ${pack.title}.</p><p class="muted">${escapeHtml(pack.wrap || "")}</p>${misses.length ? `<div class="miss-list">${misses.map((m) => "\u2022 " + escapeHtml(m.stem)).join("<br>")}</div>` : `<p class="muted">Clean case.</p>`}<div class="choice"><button type="button" id="dMix"><b>Endless mix</b></button><button type="button" id="dMiss"><b>Missed reel</b></button><button type="button" id="dCase"><b>Another case</b></button></div>`;
    $("dMix").onclick = () => startMode("mix"); $("dMiss").onclick = () => startMode("miss");
    $("dCase").onclick = () => { $("debrief").classList.add("hidden"); showMenu(true); };
  }
  function showShiftDebrief() {
    const n = shiftLog.length; const ok = shiftLog.filter((x) => x.ok).length;
    const pct = n ? Math.round(100 * ok / n) : 0;
    const by = {};
    shiftLog.forEach((r) => { by[r.cat] = by[r.cat] || { ok: 0, n: 0 }; by[r.cat].n += 1; if (r.ok) by[r.cat].ok += 1; });
    const labels = LABELS[track] || {};
    const catLines = Object.keys(by).map((k) => `${labels[k] || k} ${by[k].ok}/${by[k].n}`).join(" \u00b7 ");
    const misses = shiftLog.filter((x) => !x.ok);
    $("debrief").className = "debrief";
    $("debrief").innerHTML = `<h2>End of shift.</h2><p class="muted">${ok}/${n} \u00b7 ${pct}% \u00b7 max streak ${shiftMaxStreak}</p><p class="muted">${escapeHtml(catLines || "No category splits.")}</p>${misses.length ? `<div class="miss-list">${misses.slice(0, 8).map((m) => "\u2022 " + escapeHtml(m.stem)).join("<br>")}</div>` : `<p class="muted">No misses this shift.</p>`}<div class="choice"><button type="button" id="dMiss"><b>Review missed</b></button><button type="button" id="dShift"><b>Another shift</b></button><button type="button" id="dMix"><b>Endless mix</b></button></div>`;
    $("dMiss").onclick = () => startMode("miss"); $("dShift").onclick = () => startMode("shift"); $("dMix").onclick = () => startMode("mix");
  }
  function hideOverlays() { $("gate").classList.add("hidden"); $("menu").classList.add("hidden"); $("debrief").classList.add("hidden"); }
  function startMode(m, cid) {
    mode = m; if (cid) caseId = cid; hideOverlays(); buildQueue();
    if (mode === "miss" && !queue.length) return showEmptyMiss();
    render();
  }
  function openFeed() {
    if (!track) { toast("RN or PN first"); return; }
    localStorage.setItem("ward_track", track); streak = 0; hideOverlays();
    if (!queue.length) { mode = "mix"; buildQueue(); }
    render();
  }
  function showMenu(openCases) {
    const s = stats(); const acc = s.n ? Math.round(100 * s.ok / s.n) : 0;
    const labels = LABELS[track] || LABELS.rn || {};
    const cats = Object.keys(s.byCat || {}).map((k) => `${labels[k] || k} ${s.byCat[k].ok}/${s.byCat[k].n}`).join(" \u00b7 ");
    $("menuCopy").textContent = (track || "").toUpperCase() + " \u00b7 lifetime " + acc + "% (" + s.ok + "/" + s.n + ") \u00b7 missed bin " + s.miss.length + (cats ? " \u00b7 " + cats : "");
    const box = $("casePick");
    if (openCases) {
      box.classList.remove("hidden");
      const pack = CASES[track] || {};
      box.innerHTML = Object.keys(pack).map((id) => `<button type="button" data-case="${id}"><b>${pack[id].title}</b><span>6-step unfolding case</span></button>`).join("") || "<p class=muted>Cases still loading.</p>";
      box.querySelectorAll("button").forEach((b) => { b.onclick = () => startMode("case", b.dataset.case); });
    } else box.classList.add("hidden");
    $("menu").classList.remove("hidden"); applyFont();
  }
  function pickTrack(t) {
    track = t;
    $("pickRN").classList.toggle("active", t === "rn");
    $("pickPN").classList.toggle("active", t === "pn");
  }
  function isScrollableTarget(el) {
    let n = el;
    while (n && n !== document.body) {
      if (n.id === "optBox" || n.id === "stemBox" || n.id === "caseBox" || n.id === "why") return true;
      n = n.parentElement;
    }
    return false;
  }
  function bindSwipe() {
    let startY = null, startX = null;
    function down(e) { const t = e.touches ? e.touches[0] : e; startY = t.clientY; startX = t.clientX; }
    function up(e) {
      if (startY == null) return;
      const t = e.changedTouches ? e.changedTouches[0] : e;
      const dy = startY - t.clientY; const dx = Math.abs(t.clientX - startX); startY = null;
      if (dx > 70) return;
      if (dy > 56) next(1); else if (dy < -56) back();
    }
    ["handle", "dock"].forEach((id) => {
      $(id).addEventListener("touchstart", down, { passive: true });
      $(id).addEventListener("touchend", up, { passive: true });
    });
    $("stage").addEventListener("touchstart", (e) => {
      if (isScrollableTarget(e.target) || (e.target.closest && e.target.closest(".opt"))) { startY = null; return; }
      down(e);
    }, { passive: true });
    $("stage").addEventListener("touchend", (e) => {
      if (startY == null || isScrollableTarget(e.target)) { startY = null; return; }
      up(e);
    }, { passive: true });
    let wheelLock = false;
    $("stage").addEventListener("wheel", (e) => {
      if (isScrollableTarget(e.target) || wheelLock || animating) return;
      if (e.deltaY > 40) { wheelLock = true; next(1); setTimeout(() => wheelLock = false, 450); }
      else if (e.deltaY < -40) { wheelLock = true; back(); setTimeout(() => wheelLock = false, 450); }
    }, { passive: true });
  }
  function bindKeys() {
    document.addEventListener("keydown", (e) => {
      if ($("gate").classList.contains("hidden") === false) return;
      if (!$("menu").classList.contains("hidden")) return;
      if (!$("debrief").classList.contains("hidden")) return;
      if (e.target && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key >= "1" && e.key <= "4") { tap(Number(e.key) - 1); e.preventDefault(); }
      else if (e.key === "Enter") { if (!locked) grade(); e.preventDefault(); }
      else if (e.key === "j" || e.key === "J" || e.key === " ") { next(1); e.preventDefault(); }
      else if (e.key === "k" || e.key === "K") { back(); e.preventDefault(); }
    });
  }
  $("pickRN").onclick = () => pickTrack("rn");
  $("pickPN").onclick = () => pickTrack("pn");
  $("startBtn").onclick = () => { mode = "mix"; buildQueue(); openFeed(); };
  $("mainBtn").onclick = () => locked ? next(1) : grade();
  $("backBtn").onclick = back;
  $("menuBtn").onclick = () => showMenu(false);
  $("closeMenu").onclick = () => $("menu").classList.add("hidden");
  $("modeMix").onclick = () => startMode("mix");
  $("modeShift").onclick = () => startMode("shift");
  $("modeCase").onclick = () => showMenu(true);
  $("modeMiss").onclick = () => startMode("miss");
  $("switchTrack").onclick = () => { $("menu").classList.add("hidden"); $("gate").classList.remove("hidden"); };
  document.querySelectorAll("#fonts button").forEach((b) => { b.onclick = () => { saveUi({ font: b.dataset.fs }); applyFont(); }; });
  bindSwipe(); bindKeys(); applyFont();
  if (track === "rn" || track === "pn") { pickTrack(track); mode = "mix"; buildQueue(); openFeed(); }
  else $("gate").classList.remove("hidden");
})();
