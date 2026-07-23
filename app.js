(function () {
  'use strict';

  // ---------- DOM ----------
  var shellWrap = document.getElementById('shellWrap');
  var shellFigure = document.getElementById('shellFigure');
  var bubble = document.getElementById('bubble');
  var bubbleText = document.getElementById('bubbleText');
  var countdownWrap = document.getElementById('countdownWrap');
  var countdownFill = document.getElementById('countdownFill');
  var countdownLabel = document.getElementById('countdownLabel');
  var postActions = document.getElementById('postActions');
  var didItBtn = document.getElementById('didItBtn');
  var skipBtn = document.getElementById('skipBtn');
  var rerollBtn = document.getElementById('rerollBtn');
  var optionInput = document.getElementById('optionInput');
  var addBtn = document.getElementById('addBtn');
  var chipsEl = document.getElementById('chips');
  var entryHint = document.getElementById('entryHint');
  var askBtn = document.getElementById('askBtn');
  var streakCount = document.getElementById('streakCount');
  var modeButtons = document.querySelectorAll('.mode-btn');
  var entrySection = document.getElementById('entry');
  var helpBtn = document.getElementById('helpBtn');
  var closeHelp = document.getElementById('closeHelp');
  var helpModal = document.getElementById('helpModal');
  var bellBtn = document.getElementById('bellBtn');
  var backupBtn = document.getElementById('backupBtn');
  var backupModal = document.getElementById('backupModal');
  var backupExport = document.getElementById('backupExport');
  var backupImport = document.getElementById('backupImport');
  var copyBackupBtn = document.getElementById('copyBackupBtn');
  var restoreBackupBtn = document.getElementById('restoreBackupBtn');
  var backupError = document.getElementById('backupError');
  var closeBackup = document.getElementById('closeBackup');
  var queueSection = document.getElementById('queueSection');
  var queueList = document.getElementById('queueList');
  var remindToggleBtn = document.getElementById('remindToggleBtn');
  var remindPanel = document.getElementById('remindPanel');
  var timeChips = document.querySelectorAll('.time-chip');
  var stepOneInput = document.getElementById('stepOneInput');

  var MAX_OPTIONS = 5;
  var MIN_OPTIONS = 2;
  var COMMIT_SECONDS = 10;
  var SNOOZE_MINUTES = 15;

  // Public by design (this is what "public" means for VAPID). Filled in after the
  // Worker is deployed -- see worker/wrangler.toml for the matching private key.
  var VAPID_PUBLIC_KEY = 'BDa0yzmp2vLuI7FJknJbX3K3LIiPQgs5lWNOhdsQihim92F3v5ChApv14pFGZIQiNX5XZHDNXiRkAEXJO8_rIQI';
  var WORKER_URL = 'https://shelldon-reminders.fairwolfmaiden.workers.dev';

  function isWorkerConfigured() {
    return WORKER_URL.indexOf('YOUR_SUBDOMAIN') === -1;
  }

  // ---------- Voice lines ----------
  var IDLE_PROMPTS = {
    task: "Give me something to work with. I can't read minds. I can barely read.",
    life: "What are we deciding today? Food, outfit, whatever. Just say it.",
  };

  var SHAKE_LINES = [
    'Hold on.', 'Processing your chaos.', "Don't rush art.", 'One second.', 'Thinking. Barely.',
  ];

  var REVEAL_PREFIXES = [
    'The Shell Has Spoken:', 'Fine. Decided:', "Here. It's:", 'Verdict:', 'The Shell Commands:',
  ];

  var REVEAL_ASIDES = [
    'Was that so hard?', "You're welcome.", "Don't overthink it now.", 'Go. Before you change your mind.', "That's it. That's the whole answer.",
  ];

  var REROLL_ASIDES = [
    "Fine. One more.", "Last time. I mean it.", "Okay, okay. Again:",
  ];

  var DID_IT_LINES = [
    "Look at you, functioning.", "See? Not so bad.", "Noted. Reluctantly impressed.", "Good. Next.",
  ];

  var SKIP_LINES = [
    "Didn't happen. Shocking. We'll try again later.", 'Skipped. The world keeps turning.', 'Noted. No judgment. Much.',
  ];

  var NOT_ENOUGH_LINES = [
    'Two options minimum. I need something to choose between.', "One option isn't a decision, that's just a plan.",
  ];

  function snoozeLine(count) {
    if (count <= 1) return "Fine. One more. I'm keeping a tally.";
    if (count === 2) return "That's two. I'm still counting.";
    return "That's " + count + " now. Impressive, in a concerning way.";
  }

  // ---------- State ----------
  var mode = 'task';
  var options = [];
  var lastPickIndex = -1;
  var rerollUsed = false;
  var countdownTimer = null;
  var phase = 'entry'; // entry -> deciding -> revealed -> locked
  var queueRefreshTimer = null;

  // ---------- Shell rendering ----------
  function svgFromGrid(grid) {
    var cell = 8;
    var size = ShellDesign.GRID * cell;
    var rects = [];
    for (var y = 0; y < grid.length; y++) {
      for (var x = 0; x < grid[y].length; x++) {
        var color = grid[y][x];
        if (!color) continue;
        rects.push('<rect x="' + x * cell + '" y="' + y * cell + '" width="' + cell + '" height="' + cell + '" fill="' + color + '"/>');
      }
    }
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">' + rects.join('') + '</svg>';
  }

  function setShellState(state) {
    shellFigure.innerHTML = svgFromGrid(ShellDesign.buildGrid({ state: state, transparentBg: true }));
  }

  // ---------- Audio (procedural chiptune, no assets) ----------
  var audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function tone(freq, startOffset, duration, type) {
    var ctx = ensureAudio();
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.value = freq;
    var t0 = ctx.currentTime + startOffset;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.12, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function playShakeSound() {
    tone(220, 0, 0.08);
    tone(180, 0.12, 0.08);
    tone(220, 0.24, 0.08);
    tone(180, 0.36, 0.08);
  }

  function playRevealSound() {
    tone(392, 0, 0.09);
    tone(494, 0.09, 0.09);
    tone(659, 0.18, 0.16);
  }

  function playClickSound() {
    tone(300, 0, 0.05, 'square');
  }

  function playDoneSound() {
    tone(523, 0, 0.08);
    tone(659, 0.08, 0.08);
    tone(784, 0.16, 0.2);
  }

  function playSkipSound() {
    tone(220, 0, 0.15, 'triangle');
  }

  // ---------- Streak (localStorage) ----------
  var STORE_KEY = 'shelldon_v1';

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function daysBetween(a, b) {
    var da = new Date(a + 'T00:00:00');
    var db = new Date(b + 'T00:00:00');
    return Math.round((db - da) / 86400000);
  }

  function applyDefaults(raw) {
    var s = (raw && typeof raw === 'object') ? raw : {};
    if (typeof s.streak !== 'number') s.streak = 0;
    if (!s.lastActive) s.lastActive = null;
    if (!Array.isArray(s.commitments)) s.commitments = [];
    if (typeof s.pushEnabled !== 'boolean') s.pushEnabled = false;
    if (!s.deviceId) {
      s.deviceId = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 32);
    }
    return s;
  }

  function loadStore() {
    var raw;
    try {
      var stored = localStorage.getItem(STORE_KEY);
      raw = stored ? JSON.parse(stored) : {};
    } catch (e) {
      raw = {};
    }
    return applyDefaults(raw);
  }

  function saveStore(store) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) {}
  }

  var store = loadStore();
  saveStore(store); // persists a freshly generated deviceId (or other migrated defaults) immediately

  function getDeviceId() { return store.deviceId; }

  // ---------- Backup / restore (no accounts -- just a copyable code) ----------
  function encodeBackup(s) {
    return window.btoa(unescape(encodeURIComponent(JSON.stringify(s))));
  }

  function decodeBackup(code) {
    var parsed = JSON.parse(decodeURIComponent(escape(window.atob(code.trim()))));
    if (!parsed || typeof parsed !== 'object') throw new Error('bad backup shape');
    return parsed;
  }

  function restoreFromBackup(code) {
    var parsed = decodeBackup(code); // throws on malformed input; caller handles the error
    var restored = applyDefaults(parsed);
    Object.keys(store).forEach(function (k) { delete store[k]; });
    Object.assign(store, restored);
    saveStore(store);
    bellBtn.classList.toggle('active', store.pushEnabled);
    renderStreak();
    resetToEntry();
    renderQueue();
  }

  (function reconcileStreakOnLoad() {
    if (store.lastActive) {
      var gap = daysBetween(store.lastActive, todayStr());
      if (gap > 1) {
        store.streak = 0;
        saveStore(store);
      }
    }
    renderStreak();
  })();

  function renderStreak() {
    streakCount.textContent = String(store.streak);
  }

  function registerActedOn() {
    var today = todayStr();
    if (store.lastActive === today) {
      // already counted today, no change
    } else if (store.lastActive && daysBetween(store.lastActive, today) === 1) {
      store.streak += 1;
      store.lastActive = today;
    } else {
      store.streak = 1;
      store.lastActive = today;
    }
    saveStore(store);
    renderStreak();
  }

  // ---------- Commitments & reminders ----------
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function computeDueAt(opts) {
    if (opts.mins) return Date.now() + opts.mins * 60000;
    var now = new Date();
    if (opts.preset === 'tonight') {
      if (now.getHours() >= 20) return Date.now() + 2 * 60 * 60000;
      var tonight = new Date();
      tonight.setHours(20, 0, 0, 0);
      return tonight.getTime();
    }
    if (opts.preset === 'tomorrow') {
      var tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      return tomorrow.getTime();
    }
    return Date.now() + 60 * 60000;
  }

  function formatDueLabel(ms) {
    var d = new Date(ms);
    var now = new Date();
    var timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return timeStr;
    var tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    if (d.toDateString() === tomorrow.toDateString()) return 'tomorrow ' + timeStr;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + timeStr;
  }

  function minutesOverdue(dueAt) {
    return Math.floor((Date.now() - dueAt) / 60000);
  }

  function severityState(c) {
    var mins = minutesOverdue(c.dueAt);
    if (mins >= 120 || c.snoozeCount >= 3) return 'fed_up';
    return 'annoyed';
  }

  function getOverdueCommitments() {
    var now = Date.now();
    return store.commitments
      .filter(function (c) { return c.status === 'pending' && c.dueAt <= now; })
      .sort(function (a, b) { return a.dueAt - b.dueAt; });
  }

  function buildPushMessage(c) {
    var base = c.text + '.';
    if (c.stepOne) base += ' Step one: ' + c.stepOne + '.';
    return base + ' Still waiting.';
  }

  function postCommitmentToWorker(c) {
    if (!isWorkerConfigured() || !store.pushEnabled) return;
    fetch(WORKER_URL + '/commitments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId(), id: c.id, dueAt: c.dueAt, message: buildPushMessage(c) }),
    }).catch(function () {});
  }

  function cancelWorkerCommitment(id) {
    if (!isWorkerConfigured()) return;
    var url = WORKER_URL + '/commitments/' + encodeURIComponent(id) + '?deviceId=' + encodeURIComponent(getDeviceId());
    fetch(url, { method: 'DELETE' }).catch(function () {});
  }

  function refreshIdleFace() {
    if (phase !== 'entry') return;
    var overdue = getOverdueCommitments();
    if (overdue.length === 0) {
      setShellState('idle');
      return;
    }
    var worst = overdue[0];
    overdue.forEach(function (c) {
      if (severityState(c) === 'fed_up') worst = c;
    });
    setShellState(severityState(worst));
  }

  function resolveQueueItem(id, status) {
    var c = store.commitments.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    c.status = status;
    saveStore(store);
    cancelWorkerCommitment(id);
    if (status === 'done') {
      registerActedOn();
      setBubble(pick(DID_IT_LINES), true);
      playDoneSound();
    } else {
      setBubble(pick(SKIP_LINES), true);
      playSkipSound();
    }
    renderQueue();
  }

  function snoozeQueueItem(id) {
    var c = store.commitments.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    c.dueAt = Date.now() + SNOOZE_MINUTES * 60000;
    c.snoozeCount = (c.snoozeCount || 0) + 1;
    saveStore(store);
    postCommitmentToWorker(c);
    setBubble(snoozeLine(c.snoozeCount), true);
    playClickSound();
    renderQueue();
  }

  function renderQueue() {
    var overdue = getOverdueCommitments();
    queueList.innerHTML = '';
    if (overdue.length === 0) {
      queueSection.classList.add('hidden');
      refreshIdleFace();
      return;
    }
    queueSection.classList.remove('hidden');
    overdue.forEach(function (c) {
      var li = document.createElement('li');
      li.className = 'queue-item';

      var textP = document.createElement('p');
      textP.className = 'queue-item-text';
      textP.textContent = c.text + (c.stepOne ? ' — step one: ' + c.stepOne : '');

      var metaP = document.createElement('p');
      metaP.className = 'queue-item-meta';
      var mins = minutesOverdue(c.dueAt);
      var overdueLabel = mins < 60 ? mins + 'm overdue' : Math.floor(mins / 60) + 'h overdue';
      metaP.textContent = overdueLabel + (c.snoozeCount > 0 ? ' · snoozed ' + c.snoozeCount + 'x' : '');

      var actions = document.createElement('div');
      actions.className = 'queue-item-actions';

      var doneBtn = document.createElement('button');
      doneBtn.className = 'pixel-btn';
      doneBtn.textContent = '✅ DONE';
      doneBtn.addEventListener('click', function () { resolveQueueItem(c.id, 'done'); });

      var snoozeBtn = document.createElement('button');
      snoozeBtn.className = 'pixel-btn';
      snoozeBtn.textContent = '😴 +15M';
      snoozeBtn.addEventListener('click', function () { snoozeQueueItem(c.id); });

      var skipBtnQ = document.createElement('button');
      skipBtnQ.className = 'pixel-btn';
      skipBtnQ.textContent = '⏭';
      skipBtnQ.addEventListener('click', function () { resolveQueueItem(c.id, 'skipped'); });

      actions.appendChild(doneBtn);
      actions.appendChild(snoozeBtn);
      actions.appendChild(skipBtnQ);
      li.appendChild(textP);
      li.appendChild(metaP);
      li.appendChild(actions);
      queueList.appendChild(li);
    });
    refreshIdleFace();
  }

  function scheduleReminder(opts) {
    if (phase !== 'revealed' && phase !== 'locked') return;
    if (lastPickIndex < 0 || !options[lastPickIndex]) return;

    var dueAt = computeDueAt(opts);
    var c = {
      id: uid(),
      text: options[lastPickIndex],
      stepOne: stepOneInput.value.trim() || null,
      dueAt: dueAt,
      createdAt: Date.now(),
      status: 'pending',
      snoozeCount: 0,
    };
    store.commitments.push(c);
    saveStore(store);
    postCommitmentToWorker(c);

    clearInterval(countdownTimer);
    setBubble("Fine. I'll bug you at " + formatDueLabel(dueAt) + '.', true);
    playClickSound();
    postActions.classList.add('hidden');
    countdownWrap.classList.add('hidden');
    remindPanel.classList.add('hidden');
    remindToggleBtn.classList.remove('active');
    stepOneInput.value = '';
    setTimeout(function () { resetToEntry(); renderQueue(); }, 1400);
  }

  // ---------- Push subscription ----------
  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = window.atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function isIOSDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isInstalledStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function subscribePush() {
    if (isIOSDevice() && !isInstalledStandalone()) {
      setBubble("Install me first: tap Share, then \"Add to Home Screen.\" Reopen me from there and I'll be ready to nudge you.", false);
      return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      if (isIOSDevice()) {
        setBubble("Your iOS version is too old for this. Update to iOS 16.4+ for reminders.", false);
      } else {
        setBubble("Your browser won't do push. Noted. Moving on.", false);
      }
      return;
    }
    if (!isWorkerConfigured()) {
      setBubble("Reminders aren't wired up yet. Ask again later.", false);
      return;
    }
    Notification.requestPermission().then(function (permission) {
      if (permission !== 'granted') {
        setBubble('Fine. Be that way. No nudges then.', false);
        return;
      }
      navigator.serviceWorker.ready
        .then(function (reg) {
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          });
        })
        .then(function (sub) {
          return fetch(WORKER_URL + '/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: getDeviceId(), subscription: sub }),
          });
        })
        .then(function () {
          store.pushEnabled = true;
          saveStore(store);
          bellBtn.classList.add('active');
          setBubble("Fine. I'll bug you when it's time. Don't make me regret this.", false);
        })
        .catch(function () {
          setBubble('Something broke setting that up. Try again in a bit.', false);
        });
    });
  }

  // ---------- Helpers ----------
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function setBubble(text, isVerdict) {
    bubbleText.textContent = text;
    bubble.classList.toggle('verdict', !!isVerdict);
  }

  function updateAskAvailability() {
    askBtn.disabled = options.length < MIN_OPTIONS;
    if (options.length >= MAX_OPTIONS) {
      optionInput.disabled = true;
      addBtn.disabled = true;
      entryHint.textContent = 'That’s enough options. Ask the shell already.';
    } else {
      optionInput.disabled = false;
      addBtn.disabled = false;
      entryHint.textContent = options.length < MIN_OPTIONS
        ? 'Add ' + (MIN_OPTIONS - options.length) + ' more to unlock the shell.'
        : 'Add up to ' + (MAX_OPTIONS - options.length) + ' more, or just ask.';
    }
  }

  function renderChips() {
    chipsEl.innerHTML = '';
    options.forEach(function (opt, i) {
      var li = document.createElement('li');
      li.className = 'chip';
      var span = document.createElement('span');
      span.textContent = opt;
      var btn = document.createElement('button');
      btn.textContent = '✕';
      btn.setAttribute('aria-label', 'Remove ' + opt);
      btn.addEventListener('click', function () {
        options.splice(i, 1);
        renderChips();
        updateAskAvailability();
      });
      li.appendChild(span);
      li.appendChild(btn);
      chipsEl.appendChild(li);
    });
    updateAskAvailability();
  }

  function resetToEntry() {
    phase = 'entry';
    options = [];
    lastPickIndex = -1;
    rerollUsed = false;
    renderChips();
    countdownWrap.classList.add('hidden');
    postActions.classList.add('hidden');
    remindPanel.classList.add('hidden');
    remindToggleBtn.classList.remove('active');
    stepOneInput.value = '';
    entrySection.classList.remove('hidden');
    setBubble(IDLE_PROMPTS[mode], false);
    clearInterval(countdownTimer);
    refreshIdleFace();
  }

  // ---------- Core decide flow ----------
  function addOption() {
    var val = optionInput.value.trim();
    if (!val) return;
    if (options.length >= MAX_OPTIONS) return;
    if (options.some(function (o) { return o.toLowerCase() === val.toLowerCase(); })) {
      optionInput.value = '';
      return;
    }
    options.push(val);
    optionInput.value = '';
    renderChips();
    optionInput.focus();
  }

  function askShelldon() {
    if (phase === 'deciding') return;
    if (options.length < MIN_OPTIONS) {
      setBubble(pick(NOT_ENOUGH_LINES), false);
      return;
    }
    if (phase === 'revealed' || phase === 'locked') return; // resolve current one first

    phase = 'deciding';
    ensureAudio();
    setShellState('shake');
    setBubble(pick(SHAKE_LINES), false);
    entrySection.classList.add('hidden');
    shellWrap.classList.remove('revealing');
    shellWrap.classList.add('shaking');
    playShakeSound();
    if (navigator.vibrate) navigator.vibrate([30, 40, 30, 40, 30]);

    setTimeout(function () { reveal(false); }, 620);
  }

  function reveal(isReroll) {
    shellWrap.classList.remove('shaking');
    var idx = Math.floor(Math.random() * options.length);
    if (isReroll && options.length > 1) {
      while (idx === lastPickIndex) idx = Math.floor(Math.random() * options.length);
    }
    lastPickIndex = idx;
    var choice = options[idx];

    var prefix = isReroll ? pick(REROLL_ASIDES) : pick(REVEAL_PREFIXES);
    var aside = pick(REVEAL_ASIDES);
    setBubble(prefix + ' ' + choice + '. ' + aside, true);
    setShellState('reveal');
    shellWrap.classList.add('revealing');
    playRevealSound();

    phase = 'revealed';
    postActions.classList.remove('hidden');
    didItBtn.disabled = false;
    skipBtn.disabled = false;
    rerollBtn.disabled = rerollUsed;
    rerollBtn.title = rerollUsed ? "No. You asked, I answered. We're done here." : '';
    remindPanel.classList.add('hidden');
    remindToggleBtn.classList.remove('active');
    stepOneInput.value = '';
    startCountdown();
  }

  function startCountdown() {
    clearInterval(countdownTimer);
    countdownWrap.classList.remove('hidden');
    var remaining = COMMIT_SECONDS;
    countdownFill.style.width = '100%';
    countdownFill.style.background = '';
    countdownLabel.textContent = 'Lock it in… ' + remaining;

    countdownTimer = setInterval(function () {
      remaining -= 1;
      var pct = Math.max(0, (remaining / COMMIT_SECONDS) * 100);
      countdownFill.style.width = pct + '%';
      if (remaining <= 0) {
        clearInterval(countdownTimer);
        phase = 'locked';
        countdownLabel.textContent = 'Locked in.';
        countdownFill.style.background = 'var(--pink)';
        rerollBtn.disabled = true;
        rerollBtn.title = 'Too late for that.';
        setShellState('idle');
      } else {
        countdownLabel.textContent = 'Lock it in… ' + remaining;
      }
    }, 1000);
  }

  function handleReroll() {
    if (rerollUsed || rerollBtn.disabled) return;
    rerollUsed = true;
    playClickSound();
    reveal(true);
  }

  function handleDidIt() {
    clearInterval(countdownTimer);
    registerActedOn();
    setShellState('pleased');
    setBubble(pick(DID_IT_LINES), true);
    playDoneSound();
    postActions.classList.add('hidden');
    countdownWrap.classList.add('hidden');
    setTimeout(resetToEntry, 1400);
  }

  function handleSkip() {
    clearInterval(countdownTimer);
    setShellState('annoyed');
    setBubble(pick(SKIP_LINES), true);
    playSkipSound();
    postActions.classList.add('hidden');
    countdownWrap.classList.add('hidden');
    setTimeout(resetToEntry, 1400);
  }

  // ---------- Wire up ----------
  addBtn.addEventListener('click', addOption);
  optionInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); addOption(); }
  });

  askBtn.addEventListener('click', askShelldon);
  shellWrap.addEventListener('click', askShelldon);

  didItBtn.addEventListener('click', handleDidIt);
  skipBtn.addEventListener('click', handleSkip);
  rerollBtn.addEventListener('click', handleReroll);

  modeButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      mode = btn.getAttribute('data-mode');
      modeButtons.forEach(function (b) {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      resetToEntry();
    });
  });

  helpBtn.addEventListener('click', function () { helpModal.classList.remove('hidden'); });
  closeHelp.addEventListener('click', function () { helpModal.classList.add('hidden'); });
  helpModal.addEventListener('click', function (e) { if (e.target === helpModal) helpModal.classList.add('hidden'); });

  backupBtn.addEventListener('click', function () {
    backupExport.value = encodeBackup(store);
    backupImport.value = '';
    backupError.classList.add('hidden');
    backupModal.classList.remove('hidden');
  });
  closeBackup.addEventListener('click', function () { backupModal.classList.add('hidden'); });
  backupModal.addEventListener('click', function (e) { if (e.target === backupModal) backupModal.classList.add('hidden'); });

  copyBackupBtn.addEventListener('click', function () {
    var restoreLabel = copyBackupBtn.textContent;
    function flash(label) {
      copyBackupBtn.textContent = label;
      setTimeout(function () { copyBackupBtn.textContent = restoreLabel; }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(backupExport.value).then(function () { flash('COPIED!'); }).catch(function () {
        backupExport.select();
        flash('SELECTED -- PRESS CTRL+C');
      });
    } else {
      backupExport.select();
      flash('SELECTED -- PRESS CTRL+C');
    }
  });

  restoreBackupBtn.addEventListener('click', function () {
    try {
      restoreFromBackup(backupImport.value);
      backupError.classList.add('hidden');
      backupModal.classList.add('hidden');
      setBubble("Fine. You're all caught up again.", false);
    } catch (e) {
      backupError.classList.remove('hidden');
    }
  });

  remindToggleBtn.addEventListener('click', function () {
    var willShow = remindPanel.classList.contains('hidden');
    remindPanel.classList.toggle('hidden', !willShow);
    remindToggleBtn.classList.toggle('active', willShow);
  });

  timeChips.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var mins = btn.getAttribute('data-mins');
      var preset = btn.getAttribute('data-preset');
      scheduleReminder(mins ? { mins: parseInt(mins, 10) } : { preset: preset });
    });
  });

  bellBtn.addEventListener('click', subscribePush);

  // ---------- Init ----------
  setBubble(IDLE_PROMPTS[mode], false);
  updateAskAvailability();
  if (store.pushEnabled) bellBtn.classList.add('active');
  renderQueue();
  queueRefreshTimer = setInterval(renderQueue, 30000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').catch(function () {});
    });
  }
})();
