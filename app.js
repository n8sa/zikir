(() => {
  "use strict";

  const STORAGE_KEY = "zikir-app-v1";
  const defaults = {
    history: {}, sessions: [],
    settings: { defaultTarget: "33", vibration: true, sound: true, autoStop: false }
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    home: $("homeScreen"), counter: $("counterScreen"), heatmap: $("heatmap"),
    heatmapRange: $("heatmapRange"), todayCount: $("todayCount"), todaySessions: $("todaySessions"),
    targetOptions: $("targetOptions"), play: $("playButton"), settingsButton: $("settingsButton"),
    closeCounter: $("closeCounterButton"), tapSurface: $("tapSurface"), count: $("countDisplay"),
    progressText: $("progressText"), progressBar: $("progressBar"), counterMode: $("counterMode"),
    completionText: $("completionText"), stop: $("stopButton"), backdrop: $("backdrop"),
    daySheet: $("daySheet"), dayTitle: $("daySheetTitle"), dayTotal: $("daySheetTotal"), daySessions: $("daySheetSessions"),
    finishSheet: $("finishSheet"), finishTitle: $("finishTitle"), finishDetail: $("finishDetail"),
    save: $("saveButton"), continue: $("continueButton"), settingsSheet: $("settingsSheet"),
    defaultTargets: $("defaultTargetOptions"), vibration: $("vibrationSetting"), sound: $("soundSetting"),
    autoStop: $("autoStopSetting"), reset: $("resetButton"), resetSheet: $("resetSheet"),
    confirmReset: $("confirmResetButton"), cancelReset: $("cancelResetButton")
  };

  let state = loadState();
  let selectedTarget = state.settings.defaultTarget;
  let session = null;
  let audioContext = null;
  let autoFinishTimer = null;
  let activeSheet = null;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return {
        history: saved?.history || {}, sessions: Array.isArray(saved?.sessions) ? saved.sessions : [],
        settings: { ...defaults.settings, ...(saved?.settings || {}) }
      };
    } catch (_) { return JSON.parse(JSON.stringify(defaults)); }
  }

  function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function localDateKey(date = new Date()) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
  function parseLocalDate(key) { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); }
  function formatDay(date) { return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date); }
  function intensity(total) { return total === 0 ? 0 : total <= 32 ? 1 : total <= 99 ? 2 : total <= 299 ? 3 : 4; }

  function renderHome() {
    renderHeatmap();
    const today = state.history[localDateKey()] || { total: 0, sessions: 0 };
    els.todayCount.textContent = today.total.toLocaleString();
    els.todaySessions.textContent = today.sessions ? `${today.sessions} ${today.sessions === 1 ? "session" : "sessions"}` : "No sessions yet";
    setTargetButtons(els.targetOptions, "target", selectedTarget);
  }

  function renderHeatmap() {
    els.heatmap.replaceChildren();
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const first = new Date(today); first.setDate(first.getDate() - 83);
    els.heatmapRange.textContent = `${formatDay(first)} – ${formatDay(today)}`;
    for (let i = 0; i < 84; i += 1) {
      const date = new Date(first); date.setDate(first.getDate() + i);
      const key = localDateKey(date);
      const data = state.history[key] || { total: 0, sessions: 0 };
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `heat-cell level-${intensity(data.total)}${key === localDateKey() ? " today" : ""}`;
      cell.dataset.date = key;
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", `${formatDay(date)}: ${data.total} zikir, ${data.sessions} sessions`);
      cell.title = `${formatDay(date)} · ${data.total} zikir`;
      els.heatmap.append(cell);
    }
  }

  function setTargetButtons(container, attribute, value) {
    const htmlAttribute = attribute.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    container.querySelectorAll(`[data-${htmlAttribute}]`).forEach((button) => {
      const active = button.dataset[attribute] === String(value);
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
    });
  }

  function startSession() {
    clearTimeout(autoFinishTimer);
    session = { count: 0, target: selectedTarget, startedAt: Date.now(), completed: false, saving: false };
    els.home.hidden = true; els.counter.hidden = false;
    els.counter.classList.remove("completed"); els.completionText.textContent = "";
    renderCounter();
  }

  function renderCounter() {
    if (!session) return;
    els.count.textContent = session.count.toLocaleString();
    const free = session.target === "free";
    els.counterMode.textContent = free ? "Free mode" : `Target ${session.target}`;
    els.progressText.textContent = free ? session.count.toLocaleString() : `${session.count.toLocaleString()} / ${session.target}`;
    els.progressBar.style.width = free ? "0%" : `${Math.min(100, session.count / Number(session.target) * 100)}%`;
    els.progressBar.parentElement.hidden = free;
  }

  function increment() {
    if (!session || session.saving || activeSheet) return;
    session.count += 1;
    renderCounter();
    pulse();
    if (state.settings.vibration && "vibrate" in navigator) navigator.vibrate(10);
    if (state.settings.sound) playTone("tap");
    const target = session.target === "free" ? null : Number(session.target);
    if (target && session.count === target && !session.completed) completeTarget();
  }

  function pulse() {
    els.count.classList.remove("bump"); els.tapSurface.classList.remove("pulse");
    void els.count.offsetWidth;
    els.count.classList.add("bump"); els.tapSurface.classList.add("pulse");
  }

  function completeTarget() {
    session.completed = true;
    els.counter.classList.add("completed"); els.completionText.textContent = "Completed";
    if (state.settings.vibration && "vibrate" in navigator) navigator.vibrate([40, 40, 70]);
    if (state.settings.sound) playTone("complete");
    setTimeout(() => els.counter.classList.remove("completed"), 1700);
    if (state.settings.autoStop) {
      session.saving = true;
      autoFinishTimer = setTimeout(saveAndFinish, 1100);
    }
  }

  function playTone(kind) {
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const now = audioContext.currentTime;
      const tone = (frequency, start, duration, volume) => {
        const oscillator = audioContext.createOscillator(); const gain = audioContext.createGain();
        oscillator.type = "sine"; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start); gain.gain.exponentialRampToValueAtTime(volume, start + .012);
        gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
        oscillator.connect(gain).connect(audioContext.destination); oscillator.start(start); oscillator.stop(start + duration + .02);
      };
      if (kind === "tap") tone(290, now, .045, .018);
      else { tone(392, now, .42, .045); tone(523.25, now + .16, .55, .035); }
    } catch (_) { /* Audio is an optional enhancement. */ }
  }

  function requestFinish() {
    if (!session || session.saving) return;
    els.finishTitle.textContent = session.count ? `${session.count.toLocaleString()} zikir recorded` : "No zikir recorded";
    els.finishDetail.textContent = session.count ? "Take a quiet moment, then save when you are ready." : "This session will not be added to your history.";
    els.save.textContent = session.count ? "Save & Finish" : "Finish";
    openSheet(els.finishSheet);
  }

  function saveAndFinish() {
    if (!session) return;
    clearTimeout(autoFinishTimer);
    const current = session;
    if (current.count > 0) {
      const date = localDateKey();
      const duration = Math.max(0, Math.round((Date.now() - current.startedAt) / 1000));
      state.sessions.push({ date, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), count: current.count, target: current.target === "free" ? "free" : Number(current.target), duration });
      const day = state.history[date] || { total: 0, sessions: 0 };
      state.history[date] = { total: day.total + current.count, sessions: day.sessions + 1 };
      persist();
    }
    session = null; closeSheet();
    els.counter.hidden = true; els.home.hidden = false;
    renderHome();
  }

  function openSheet(sheet) {
    if (activeSheet) activeSheet.hidden = true;
    activeSheet = sheet; sheet.hidden = false; els.backdrop.hidden = false;
    requestAnimationFrame(() => sheet.querySelector("button")?.focus());
  }
  function closeSheet() { if (activeSheet) activeSheet.hidden = true; activeSheet = null; els.backdrop.hidden = true; }

  function showDay(key) {
    const data = state.history[key] || { total: 0, sessions: 0 };
    els.dayTitle.textContent = formatDay(parseLocalDate(key));
    els.dayTotal.textContent = data.total ? `${data.total.toLocaleString()} zikir` : "No zikir recorded";
    els.daySessions.textContent = data.sessions ? `${data.sessions} ${data.sessions === 1 ? "session" : "sessions"}` : "A quiet day with no saved sessions.";
    openSheet(els.daySheet);
  }

  function openSettings() {
    setTargetButtons(els.defaultTargets, "defaultTarget", state.settings.defaultTarget);
    els.vibration.checked = state.settings.vibration; els.sound.checked = state.settings.sound; els.autoStop.checked = state.settings.autoStop;
    openSheet(els.settingsSheet);
  }
  function saveSetting(name, value) { state.settings[name] = value; persist(); }

  els.heatmap.addEventListener("click", (event) => { const cell = event.target.closest(".heat-cell"); if (cell) showDay(cell.dataset.date); });
  els.targetOptions.addEventListener("click", (event) => { const button = event.target.closest("[data-target]"); if (!button) return; selectedTarget = button.dataset.target; saveSetting("defaultTarget", selectedTarget); setTargetButtons(els.targetOptions, "target", selectedTarget); });
  els.defaultTargets.addEventListener("click", (event) => { const button = event.target.closest("[data-default-target]"); if (!button) return; selectedTarget = button.dataset.defaultTarget; saveSetting("defaultTarget", selectedTarget); setTargetButtons(els.defaultTargets, "defaultTarget", selectedTarget); setTargetButtons(els.targetOptions, "target", selectedTarget); });
  els.play.addEventListener("click", startSession);
  els.tapSurface.addEventListener("click", increment);
  els.stop.addEventListener("click", (event) => { event.stopPropagation(); requestFinish(); });
  els.closeCounter.addEventListener("click", (event) => { event.stopPropagation(); requestFinish(); });
  els.save.addEventListener("click", (event) => { event.stopPropagation(); saveAndFinish(); });
  els.continue.addEventListener("click", (event) => { event.stopPropagation(); closeSheet(); });
  els.settingsButton.addEventListener("click", openSettings);
  els.vibration.addEventListener("change", () => saveSetting("vibration", els.vibration.checked));
  els.sound.addEventListener("change", () => saveSetting("sound", els.sound.checked));
  els.autoStop.addEventListener("change", () => saveSetting("autoStop", els.autoStop.checked));
  els.reset.addEventListener("click", () => openSheet(els.resetSheet));
  els.cancelReset.addEventListener("click", openSettings);
  els.confirmReset.addEventListener("click", () => { state = JSON.parse(JSON.stringify(defaults)); selectedTarget = "33"; persist(); closeSheet(); renderHome(); });
  els.backdrop.addEventListener("click", () => { if (activeSheet === els.finishSheet) return; closeSheet(); });
  document.querySelectorAll("[data-close-sheet]").forEach((button) => button.addEventListener("click", closeSheet));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && activeSheet && activeSheet !== els.finishSheet) closeSheet(); });

  renderHome();
})();
