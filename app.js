// ── Constants ────────────────────────────────────────────────
const DURATIONS = [0.5, 1, 3, 5, 10, 15, 20, 25, 30, 45, 60]; // minutes (0.5 = 30 seconds)
const SHORT_BREAK_MIN = 5;
const LONG_BREAK_MIN  = 15;
const POMODOROS_BEFORE_LONG = 4;
const CIRCUMFERENCE = 2 * Math.PI * 96; // matches SVG r="96" → 603.186
const STORAGE_KEY   = 'pomodoro-work-duration';

const SESSION_COLORS = {
  work:          '#e94560',
  'short-break': '#0f9b8e',
  'long-break':  '#f5a623',
};

const SESSION_LABELS = {
  work:          'Focus',
  'short-break': 'Short Break',
  'long-break':  'Long Break',
};

const NOTIFICATION_MESSAGES = {
  work:          { title: 'Focus session complete!', body: 'Time for a well-deserved break.' },
  'short-break': { title: 'Break over!',             body: 'Ready to focus again?' },
  'long-break':  { title: 'Long break over!',        body: "Let's start a new cycle." },
  test:          { title: 'Notifications enabled!',  body: "You'll be notified when sessions end." },
};

// ── State ────────────────────────────────────────────────────
const state = {
  workDuration:     25,        // minutes (user-selected, persisted)
  currentSession:   'work',    // 'work' | 'short-break' | 'long-break'
  pomodoroCount:    0,         // completed work sessions this cycle
  totalSeconds:     25 * 60,
  remainingSeconds: 25 * 60,
  isRunning:        false,
  intervalId:       null,
  wakeLock:         null,
  tickStartTime:    null,      // wall-clock ms at last tick
};

// ── DOM references ───────────────────────────────────────────
const els = {
  minutes:       document.getElementById('timer-minutes'),
  seconds:       document.getElementById('timer-seconds'),
  ring:          document.getElementById('ring-progress-circle'),
  sessionLabel:  document.getElementById('session-label'),
  sessionDots:   document.getElementById('session-dots'),
  btnStartPause: document.getElementById('btn-start-pause'),
  btnReset:      document.getElementById('btn-reset'),
  btnSkip:       document.getElementById('btn-skip'),
  durationPicker:document.getElementById('duration-picker'),
  btnNotify:     document.getElementById('btn-notify-enable'),
  iosHint:       document.getElementById('ios-install-hint'),
  iosHintClose:  document.getElementById('ios-hint-close'),
};

// ── Render ───────────────────────────────────────────────────
// Single function that reads state and updates DOM. Called every tick.
function render() {
  const m = Math.floor(state.remainingSeconds / 60);
  const s = state.remainingSeconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');

  els.minutes.textContent = mm;
  els.seconds.textContent = ss;
  document.title = `${mm}:${ss} — Pomodoro`;

  // SVG ring: drains clockwise as time runs out
  const progress = state.totalSeconds > 0
    ? state.remainingSeconds / state.totalSeconds
    : 0;
  els.ring.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);

  // Controls
  els.btnStartPause.textContent = state.isRunning ? 'Pause' : 'Start';
  els.btnStartPause.setAttribute('aria-label', state.isRunning ? 'Pause timer' : 'Start timer');

  // Session label
  els.sessionLabel.textContent = SESSION_LABELS[state.currentSession];

  // Pomodoro dots (shows progress within a 4-session cycle)
  const completedInCycle = state.pomodoroCount % POMODOROS_BEFORE_LONG;
  els.sessionDots.innerHTML = '';
  for (let i = 0; i < POMODOROS_BEFORE_LONG; i++) {
    const dot = document.createElement('span');
    dot.className = 'session-dot' + (i < completedInCycle ? ' filled' : '');
    els.sessionDots.appendChild(dot);
  }

  // Active duration button
  document.querySelectorAll('.duration-btn').forEach(btn => {
    const active = Number(btn.dataset.minutes) === state.workDuration;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
    // Disable duration changes while timer is running
    btn.disabled = state.isRunning;
  });

  // Colon blink class on body
  document.body.classList.toggle('paused', !state.isRunning);
}

// ── Timer engine ─────────────────────────────────────────────
// Uses wall-clock timestamps to stay accurate when the tab is backgrounded
// or the device is locked (setInterval alone drifts significantly).

function tick() {
  const now = Date.now();
  // elapsed may be >> 1000ms if the tab was throttled or screen was locked
  const elapsed = Math.round((now - state.tickStartTime) / 1000);
  state.tickStartTime = now;
  state.remainingSeconds = Math.max(0, state.remainingSeconds - elapsed);
  render();
  if (state.remainingSeconds === 0) onSessionEnd();
}

function startTimer() {
  if (state.isRunning) return;
  state.isRunning = true;
  state.tickStartTime = Date.now();
  state.intervalId = setInterval(tick, 1000);
  acquireWakeLock();
  render();
}

function pauseTimer() {
  if (!state.isRunning) return;
  state.isRunning = false;
  clearInterval(state.intervalId);
  state.intervalId = null;
  releaseWakeLock();
  render();
}

function resetTimer() {
  pauseTimer();
  state.remainingSeconds = state.totalSeconds;
  render();
}

function skipSession() {
  const wasRunning = state.isRunning;
  pauseTimer();
  onSessionEnd(/* autoStart */ wasRunning);
}

// ── Session sequencer ────────────────────────────────────────

function onSessionEnd(autoStart = false) {
  clearInterval(state.intervalId);
  state.intervalId = null;
  state.isRunning = false;
  releaseWakeLock();

  sendNotification(state.currentSession);

  if (state.currentSession === 'work') {
    state.pomodoroCount++;
    if (state.pomodoroCount % POMODOROS_BEFORE_LONG === 0) {
      transitionTo('long-break');
    } else {
      transitionTo('short-break');
    }
  } else {
    transitionTo('work');
  }

  if (autoStart) startTimer();
}

function transitionTo(session) {
  state.currentSession = session;

  const durations = {
    work:          state.workDuration * 60,
    'short-break': SHORT_BREAK_MIN * 60,
    'long-break':  LONG_BREAK_MIN * 60,
  };

  state.totalSeconds     = durations[session];
  state.remainingSeconds = durations[session];

  // Update the CSS custom property — all session-colored elements inherit it
  document.documentElement.style.setProperty('--session-color', SESSION_COLORS[session]);

  // Update theme-color meta for browser chrome on Android
  document.querySelector('meta[name="theme-color"]').setAttribute(
    'content', SESSION_COLORS[session]
  );

  render();
}

// ── Audio chime ──────────────────────────────────────────────
// Plays a short chime using Web Audio API — no permission needed,
// works even when the app is in the foreground.

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [880, 1100, 1320]; // A5 C#6 E6 — a bright ascending triad
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.4, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.6);
      osc.start(start);
      osc.stop(start + 0.65);
    });
  } catch {
    // AudioContext not available — silent fail
  }
}

// ── Notifications ────────────────────────────────────────────

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('Notifications not supported in this browser');
    return;
  }

  const permission = await Notification.requestPermission();

  if (permission === 'granted') {
    syncNotifyButton();
    playChime();
    sendNotification('test');
  } else if (permission === 'denied') {
    syncNotifyButton();
    showToast('Notifications blocked — enable in your browser settings.');
  }
}

function syncNotifyButton() {
  if (!('Notification' in window)) {
    els.btnNotify.textContent = 'Notifications Unavailable';
    els.btnNotify.disabled = true;
    return;
  }
  const perm = Notification.permission;
  if (perm === 'granted') {
    els.btnNotify.textContent = '🔔 Notifications On';
    els.btnNotify.classList.add('active');
    els.btnNotify.disabled = true;
  } else if (perm === 'denied') {
    els.btnNotify.textContent = 'Notifications Blocked';
    els.btnNotify.disabled = true;
    els.btnNotify.classList.remove('active');
  } else {
    els.btnNotify.textContent = 'Enable Notifications';
    els.btnNotify.disabled = false;
    els.btnNotify.classList.remove('active');
  }
}

async function sendNotification(sessionType) {
  const msg = NOTIFICATION_MESSAGES[sessionType];
  if (!msg) return;

  // Always play audio — works in foreground, no permission needed
  if (sessionType !== 'test') playChime();

  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  try {
    if ('serviceWorker' in navigator) {
      // Use serviceWorker.ready — always resolves to the active registration,
      // unlike .controller which is null on first page load
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(msg.title, {
        body:              msg.body,
        icon:              './icons/icon-192.png',
        badge:             './icons/icon-192.png',
        tag:               'pomodoro-timer',
        renotify:          true,
        requireInteraction: false,
      });
    } else {
      new Notification(msg.title, { body: msg.body, icon: './icons/icon-192.png' });
    }
  } catch {
    // Fallback if SW registration fails
    try { new Notification(msg.title, { body: msg.body }); } catch { /* silent */ }
  }
}

// ── Wake Lock ────────────────────────────────────────────────
// Prevents screen sleep during active focus sessions.

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
  } catch {
    // Silent fail — timer still works, screen may sleep
  }
}

function releaseWakeLock() {
  if (state.wakeLock) {
    state.wakeLock.release();
    state.wakeLock = null;
  }
}

// ── Duration picker ──────────────────────────────────────────

function renderDurationPicker() {
  els.durationPicker.innerHTML = '';
  DURATIONS.forEach(min => {
    const btn = document.createElement('button');
    btn.className = 'duration-btn';
    btn.dataset.minutes = min;
    btn.textContent = min < 1 ? `${min * 60}s` : `${min}m`;
    btn.setAttribute('aria-label', min < 1 ? `Set work interval to ${min * 60} seconds` : `Set work interval to ${min} minutes`);
    btn.setAttribute('aria-pressed', String(min === state.workDuration));

    btn.addEventListener('click', () => {
      if (state.isRunning) return;
      state.workDuration = min;
      savePreferences();
      // Apply new duration immediately if we're in a work session
      if (state.currentSession === 'work') {
        state.totalSeconds     = min * 60;
        state.remainingSeconds = min * 60;
      }
      render();
    });

    els.durationPicker.appendChild(btn);
  });
}

// ── Preferences ──────────────────────────────────────────────

function loadPreferences() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && DURATIONS.includes(Number(saved))) {
    state.workDuration    = Number(saved);
    state.totalSeconds    = state.workDuration * 60;
    state.remainingSeconds = state.workDuration * 60;
  }
}

function savePreferences() {
  localStorage.setItem(STORAGE_KEY, state.workDuration);
}

// ── Toast ────────────────────────────────────────────────────

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  // Force reflow before adding class to trigger transition
  toast.getBoundingClientRect();
  toast.classList.add('visible');
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Service Worker ───────────────────────────────────────────

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    console.log('[PWA] Service worker registered:', reg.scope);
  } catch (err) {
    console.warn('[PWA] Service worker registration failed:', err.message);
  }
}

// ── iOS install hint ─────────────────────────────────────────

function checkIOSInstallHint() {
  // Detect iOS (but not macOS Catalyst which also has 'iphone' in UA)
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
             && !/macintosh/i.test(navigator.userAgent);
  // navigator.standalone is true only when launched from iOS home screen
  const isStandalone =
    (typeof navigator.standalone !== 'undefined' && navigator.standalone === true)
    || window.matchMedia('(display-mode: standalone)').matches;

  if (isIOS && !isStandalone) {
    els.iosHint.hidden = false;
  }
}

// ── Event binding ────────────────────────────────────────────

function bindEvents() {
  els.btnStartPause.addEventListener('click', () => {
    if (state.isRunning) pauseTimer(); else startTimer();
  });

  els.btnReset.addEventListener('click', resetTimer);
  els.btnSkip.addEventListener('click', skipSession);

  els.btnNotify.addEventListener('click', requestNotificationPermission);

  els.iosHintClose?.addEventListener('click', () => {
    els.iosHint.hidden = true;
  });

  // Page Visibility: when user returns to the tab, correct for missed ticks
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.isRunning) {
      tick(); // deducts all time that elapsed while tab was hidden
      if (!state.wakeLock) acquireWakeLock();
    }
  });

  // Re-acquire wake lock after screen unlock (the lock is released on screen lock)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.isRunning && !state.wakeLock) {
      acquireWakeLock();
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'BUTTON') return; // let buttons handle themselves
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.isRunning) pauseTimer(); else startTimer();
    }
    if (e.code === 'KeyR') resetTimer();
  });
}

// ── Init ─────────────────────────────────────────────────────

function init() {
  loadPreferences();
  registerServiceWorker();
  checkIOSInstallHint();
  renderDurationPicker();

  // Set initial session color
  document.documentElement.style.setProperty(
    '--session-color', SESSION_COLORS[state.currentSession]
  );

  syncNotifyButton();
  bindEvents();
  render();
}

document.addEventListener('DOMContentLoaded', init);
