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

  var MAX_OPTIONS = 5;
  var MIN_OPTIONS = 2;
  var COMMIT_SECONDS = 10;

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

  // ---------- State ----------
  var mode = 'task';
  var options = [];
  var lastPickIndex = -1;
  var rerollUsed = false;
  var countdownTimer = null;
  var phase = 'entry'; // entry -> deciding -> revealed -> locked

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

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : { streak: 0, lastActive: null };
    } catch (e) {
      return { streak: 0, lastActive: null };
    }
  }

  function saveStore(store) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) {}
  }

  var store = loadStore();
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
    entrySection.classList.remove('hidden');
    setShellState('idle');
    setBubble(IDLE_PROMPTS[mode], false);
    clearInterval(countdownTimer);
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

  // ---------- Init ----------
  setShellState('idle');
  setBubble(IDLE_PROMPTS[mode], false);
  updateAskAvailability();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').catch(function () {});
    });
  }
})();
