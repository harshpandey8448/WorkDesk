// ============================================================
// WorkDesk — Popup Script
// ============================================================

// ─── STATE ───────────────────────────────────────────────────
let reminders = [], tasks = [], notes = '', dnd = false;
let editingReminderId = null;
let pomodoroSettings = { work: 25, shortBreak: 5, longBreak: 15 };
let pomodoroState = {
  mode: 'work', running: false, timeLeft: 25 * 60,
  totalTime: 25 * 60, session: 1, interval: null
};
let activeFilter = 'all', activePriority = 'low';
let userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone; // auto-detect
let workHours = { start: '09:00', end: '18:00' };
let tzClockInterval = null;

// ─── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadStorage();
  renderAll();
  setupTabs();
  setupReminders();
  setupTasks();
  setupPomodoro();
  setupNotes();
  setupDND();
  setupSettings();
  updateDateChip();
  startTzClock();
});

// ─── STORAGE ──────────────────────────────────────────────────
async function loadStorage() {
  const data = await chrome.storage.local.get(['reminders', 'tasks', 'notes', 'pomodoroSettings', 'dnd', 'userTimezone', 'workHours']);
  reminders = data.reminders || [];
  tasks     = data.tasks     || [];
  notes     = data.notes     || '';
  dnd       = data.dnd       || false;
  pomodoroSettings = data.pomodoroSettings || { work: 25, shortBreak: 5, longBreak: 15 };
  userTimezone = data.userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  workHours    = data.workHours    || { start: '09:00', end: '18:00' };
}

async function save(key, value) {
  await chrome.storage.local.set({ [key]: value });
  // Sync the toolbar badge in the background
  try {
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' });
  } catch (e) {}
}

// ─── RENDER ALL ───────────────────────────────────────────────
function renderAll() {
  renderReminders();
  renderTasks();
  updateBadges();
  renderDND();
  // notes textarea
  document.getElementById('notesArea').value = notes;
  updateCharCount();
  // pomodoro settings inputs
  document.getElementById('settingWork').value  = pomodoroSettings.work;
  document.getElementById('settingShort').value = pomodoroSettings.shortBreak;
  document.getElementById('settingLong').value  = pomodoroSettings.longBreak;
  resetPomodoroDisplay();
  // timezone UI
  updateTzChip();
  const tzSel = document.getElementById('timezoneSelect');
  if (tzSel) tzSel.value = userTimezone;
  document.getElementById('workStart').value = workHours.start;
  document.getElementById('workEnd').value   = workHours.end;
}

// ─── DATE CHIP ────────────────────────────────────────────────
function updateDateChip() {
  const now = new Date();
  const opts = { weekday: 'short', month: 'short', day: 'numeric', timeZone: userTimezone };
  document.getElementById('dateChip').textContent = now.toLocaleDateString('en-US', opts);
}

// ─── TZ CHIP ──────────────────────────────────────────────────
function updateTzChip() {
  // Show short abbreviation like PST, IST, EST
  const chip = document.getElementById('tzChip');
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: userTimezone, timeZoneName: 'short'
    }).formatToParts(new Date());
    const tzName = parts.find(p => p.type === 'timeZoneName')?.value || userTimezone;
    chip.textContent = tzName;
    chip.title = userTimezone;
  } catch (e) {
    chip.textContent = '';
  }
}

// ─── TABS ─────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ═══════════════════════════════════════════════════════════════
//  REMINDERS
// ═══════════════════════════════════════════════════════════════
function setupReminders() {
  // When selector
  const whenSelect = document.getElementById('reminderWhen');
  const customGroup = document.getElementById('customDateGroup');
  const dateInput = document.getElementById('reminderCustomDate');
  const timeInput = document.getElementById('reminderCustomTime');
  
  function prefillCustom() {
    if (!dateInput.value || !timeInput.value) {
      const d = new Date();
      d.setHours(d.getHours() + 1);
      const yr = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const dy = String(d.getDate()).padStart(2, '0');
      const hr = String(d.getHours()).padStart(2, '0');
      const mn = String(d.getMinutes()).padStart(2, '0');
      dateInput.value = `${yr}-${mo}-${dy}`;
      timeInput.value = `${hr}:${mn}`;
    }
  }

  whenSelect.addEventListener('change', function () {
    customGroup.style.display = this.value === 'custom' ? 'flex' : 'none';
    if (this.value === 'custom') prefillCustom();
  });
  
  // Initialize state based on current selection
  customGroup.style.display = whenSelect.value === 'custom' ? 'flex' : 'none';
  if (whenSelect.value === 'custom') prefillCustom();

  // Priority buttons
  document.querySelectorAll('.priority-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activePriority = btn.dataset.priority;
    });
  });

  // Add reminder
  document.getElementById('addReminderBtn').addEventListener('click', addReminder);
  document.getElementById('reminderTitle').addEventListener('keydown', e => {
    if (e.key === 'Enter') addReminder();
  });

  // Clear fired
  document.getElementById('clearFiredBtn').addEventListener('click', async () => {
    reminders = reminders.filter(r => r.status !== 'fired');
    await save('reminders', reminders);
    renderReminders();
    updateBadges();
    showToast('Cleared fired reminders', 'success');
  });
}

function resolveFireAt(whenVal, customVal) {
  const tz = userTimezone;
  const now = new Date();

  switch (whenVal) {
    case '1h':  return now.getTime() + 60 * 60 * 1000;
    case '2h':  return now.getTime() + 2 * 60 * 60 * 1000;
    case '4h':  return now.getTime() + 4 * 60 * 60 * 1000;

    case 'eod': {
      const [eh, em] = workHours.end.split(':').map(Number);
      return getTzTimestamp(tz, 0, eh, em); // today at work-end time
    }
    case 'tomorrow9': {
      return getTzTimestamp(tz, 1, 9, 0);
    }
    case 'tomorrow1': {
      return getTzTimestamp(tz, 1, 13, 0);
    }
    case 'nextweek': {
      // Next Monday
      const nowInTz = new Date(now.toLocaleString('en-US', { timeZone: tz }));
      const daysUntilMon = ((8 - nowInTz.getDay()) % 7) || 7;
      return getTzTimestamp(tz, daysUntilMon, 9, 0);
    }
    case 'custom':
    default:
      return customVal ? getCustomTzTimestamp(tz, customVal) : null;
  }
}

/**
 * Get a UTC timestamp for `daysFromNow` days at hour:minute in `tz`.
 * Uses Intl to correctly handle DST and offset changes.
 */
function getTzTimestamp(tz, daysFromNow, hour, minute) {
  // Get today's date parts in the target timezone
  const nowParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const p = {};
  nowParts.forEach(({ type, value }) => { p[type] = parseInt(value); });

  // Build a rough UTC estimate for target date + time
  const targetDate = new Date(Date.UTC(p.year, p.month - 1, p.day + daysFromNow, hour, minute, 0));

  // Iteratively correct for timezone offset (handles DST)
  return correctForTimezone(targetDate.getTime(), tz, hour, minute);
}

/**
 * Convert a datetime-local string ("2026-05-14T09:00") interpreted in `tz` to UTC ms.
 */
function getCustomTzTimestamp(tz, localStr) {
  // Parse the local string naively as UTC, then correct
  const [datePart, timePart] = localStr.split('T');
  const [yr, mo, dy] = datePart.split('-').map(Number);
  const [hr, mn]     = (timePart || '00:00').split(':').map(Number);
  const roughUTC = Date.UTC(yr, mo - 1, dy, hr, mn, 0);
  return correctForTimezone(roughUTC, tz, hr, mn);
}

/**
 * Correct a rough UTC estimate so it lands on the exact hour:minute in `tz`.
 * Runs 2 iterations — enough to handle any DST gap.
 */
function correctForTimezone(roughUTC, tz, targetHour, targetMinute) {
  let estimate = roughUTC;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false
  });
  for (let i = 0; i < 2; i++) {
    const parts = {};
    fmt.formatToParts(new Date(estimate)).forEach(({ type, value }) => {
      parts[type] = parseInt(value);
    });
    const actualH = parts.hour === 24 ? 0 : parts.hour;
    const actualM = parts.minute;
    const diffMs = ((targetHour - actualH) * 60 + (targetMinute - actualM)) * 60 * 1000;
    estimate += diffMs;
  }
  return estimate;
}

async function addReminder() {
  const title = document.getElementById('reminderTitle').value.trim();
  if (!title) { showToast('Please enter a reminder title', 'error'); return; }

  const whenVal  = document.getElementById('reminderWhen').value;
  const customDateVal = document.getElementById('reminderCustomDate').value;
  const customTimeVal = document.getElementById('reminderCustomTime').value;
  const customVal = (customDateVal && customTimeVal) ? `${customDateVal}T${customTimeVal}` : null;
  const fireAt   = resolveFireAt(whenVal, customVal);
  if (!fireAt || fireAt <= Date.now()) {
    showToast('Please set a future date/time', 'error'); return;
  }

  const note = document.getElementById('reminderNote').value.trim();
  const priority = activePriority;
  const repeat = document.getElementById('reminderRepeat').value;

  if (editingReminderId) {
    // Update existing
    reminders = reminders.map(r => {
      if (r.id === editingReminderId) {
        return { ...r, title, note, priority, repeat, fireAt, status: 'active' };
      }
      return r;
    });
    chrome.runtime.sendMessage({ type: 'CANCEL_ALARM', payload: { id: editingReminderId } });
    chrome.runtime.sendMessage({ type: 'SET_ALARM', payload: { id: editingReminderId, fireAt } });
    showToast('✅ Reminder updated!', 'success');
  } else {
    // Create new
    const reminder = {
      id:       'r_' + Date.now(),
      title,
      note,
      priority,
      repeat,
      fireAt,
      status:   'active',
      createdAt: Date.now()
    };
    reminders.unshift(reminder);
    chrome.runtime.sendMessage({ type: 'SET_ALARM', payload: { id: reminder.id, fireAt } });
    showToast('⏰ Reminder set!', 'success');
  }

  await save('reminders', reminders);

  // Reset form
  editingReminderId = null;
  document.getElementById('addReminderBtn').innerHTML = '+ Set Reminder';
  document.getElementById('reminderTitle').value = '';
  document.getElementById('reminderNote').value  = '';
  document.getElementById('reminderCustomDate').value = '';
  document.getElementById('reminderCustomTime').value = '';
  document.getElementById('reminderWhen').value = 'custom';
  document.getElementById('customDateGroup').style.display = 'none';

  renderReminders();
  updateBadges();
}

function renderReminders() {
  const list  = document.getElementById('reminderList');
  const empty = document.getElementById('reminderEmpty');
  const active = reminders.filter(r => r.status !== 'fired');
  const fired  = reminders.filter(r => r.status === 'fired');
  const all = [...active, ...fired];

  if (all.length === 0) {
    empty.style.display = 'block';
    list.querySelectorAll('.reminder-item').forEach(el => el.remove());
    return;
  }
  empty.style.display = 'none';

  list.querySelectorAll('.reminder-item').forEach(el => el.remove());
  all.forEach(r => list.appendChild(createReminderEl(r)));
}

function createReminderEl(r) {
  const el = document.createElement('div');
  el.className = `reminder-item priority-${r.priority}${r.status === 'fired' ? ' fired' : ''}`;
  el.dataset.id = r.id;

  const timeStr = formatDateTime(r.fireAt);
  const repeatLabel = r.repeat !== 'none' ? `<span class="reminder-repeat">🔁 ${r.repeat}</span>` : '';
  const noteHtml = r.note ? `<div class="reminder-note">${escHtml(r.note)}</div>` : '';
  const statusHtml = r.status === 'fired'
    ? `<span class="reminder-status fired">Fired</span>`
    : `<span class="reminder-status">Active</span>`;

  el.innerHTML = `
    <div class="reminder-body">
      <div class="reminder-title">${escHtml(r.title)}</div>
      <div class="reminder-meta">
        <span class="reminder-time">🕐 ${timeStr}</span>
        ${repeatLabel}
        ${statusHtml}
      </div>
      ${noteHtml}
    </div>
    <div class="reminder-actions">
      <button class="item-action-btn edit-reminder-btn" title="Edit">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
      </button>
      <button class="item-action-btn note-reminder-btn" title="Add/Edit Note">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
      </button>
      <button class="item-action-btn del-reminder-btn" title="Delete">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>`;

  el.querySelector('.edit-reminder-btn').addEventListener('click', () => editReminder(r.id));
  el.querySelector('.note-reminder-btn').addEventListener('click', () => {
    editReminder(r.id);
    // Focus the note field so they can start typing immediately
    setTimeout(() => document.getElementById('reminderNote').focus(), 100);
  });
  el.querySelector('.del-reminder-btn').addEventListener('click', () => deleteReminder(r.id));
  return el;
}

function editReminder(id) {
  const r = reminders.find(x => x.id === id);
  if (!r) return;
  
  editingReminderId = id;
  document.getElementById('reminderTitle').value = r.title;
  document.getElementById('reminderNote').value = r.note || '';
  
  // Set custom date/time
  const d = new Date(r.fireAt);
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  const hr = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  
  document.getElementById('reminderCustomDate').value = `${yr}-${mo}-${dy}`;
  document.getElementById('reminderCustomTime').value = `${hr}:${mn}`;
  
  document.getElementById('reminderWhen').value = 'custom';
  document.getElementById('customDateGroup').style.display = 'flex';
  
  // Set priority
  document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.priority-btn[data-priority="${r.priority}"]`).classList.add('active');
  activePriority = r.priority;
  
  document.getElementById('reminderRepeat').value = r.repeat;
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.getElementById('addReminderBtn').innerHTML = 'Update Reminder';
}

async function deleteReminder(id) {
  chrome.runtime.sendMessage({ type: 'CANCEL_ALARM', payload: { id } });
  reminders = reminders.filter(r => r.id !== id);
  await save('reminders', reminders);
  renderReminders();
  updateBadges();
  showToast('Reminder deleted');
}

// ═══════════════════════════════════════════════════════════════
//  TASKS
// ═══════════════════════════════════════════════════════════════
function setupTasks() {
  document.getElementById('addTaskBtn').addEventListener('click', addTask);
  document.getElementById('taskTitle').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTask();
  });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderTasks();
    });
  });
}

async function addTask() {
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) { showToast('Please enter a task description', 'error'); return; }

  const task = {
    id:       't_' + Date.now(),
    title,
    dueDate:  document.getElementById('taskDueDate').value || null,
    category: document.getElementById('taskCategory').value,
    done:     false,
    createdAt: Date.now()
  };

  tasks.unshift(task);
  await save('tasks', tasks);
  document.getElementById('taskTitle').value = '';
  document.getElementById('taskDueDate').value = '';
  renderTasks();
  updateBadges();
  chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' });
  showToast('✅ Task added!', 'success');
}

function getFilteredTasks() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  switch (activeFilter) {
    case 'pending': return tasks.filter(t => !t.done);
    case 'done':    return tasks.filter(t => t.done);
    case 'overdue': return tasks.filter(t => !t.done && t.dueDate && new Date(t.dueDate) < now);
    default:        return tasks;
  }
}

function renderTasks() {
  const list  = document.getElementById('taskList');
  const empty = document.getElementById('taskEmpty');
  const filtered = getFilteredTasks();

  // Progress
  const total = tasks.length, done = tasks.filter(t => t.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  document.getElementById('taskProgressText').textContent = `${done} of ${total} completed`;
  document.getElementById('taskProgressPct').textContent  = pct + '%';
  document.getElementById('taskProgressFill').style.width = pct + '%';

  list.querySelectorAll('.task-item').forEach(el => el.remove());

  if (filtered.length === 0) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  filtered.forEach(t => list.appendChild(createTaskEl(t)));
}

function createTaskEl(t) {
  const el = document.createElement('div');
  const now = new Date(); now.setHours(0,0,0,0);
  const isOverdue = !t.done && t.dueDate && new Date(t.dueDate) < now;
  el.className = `task-item${t.done ? ' done' : ''}${isOverdue ? ' overdue' : ''}`;
  el.dataset.id = t.id;

  const dueStr = t.dueDate
    ? `<span class="task-due${isOverdue ? ' overdue-text' : ''}">${isOverdue ? '⚠️ ' : '📅 '}${formatDate(t.dueDate)}</span>`
    : '';
  const catClass = t.category !== 'general' ? t.category : '';

  el.innerHTML = `
    <div class="task-check${t.done ? ' checked' : ''}" data-id="${t.id}"></div>
    <div class="task-body">
      <div class="task-title">${escHtml(t.title)}</div>
      <div class="task-meta">
        ${dueStr}
        <span class="task-cat ${catClass}">${t.category}</span>
      </div>
    </div>
    <div class="reminder-actions">
      <button class="item-action-btn del-task-btn" title="Delete">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>`;

  el.querySelector('.task-check').addEventListener('click', () => toggleTask(t.id));
  el.querySelector('.del-task-btn').addEventListener('click', () => deleteTask(t.id));
  return el;
}

async function toggleTask(id) {
  tasks = tasks.map(t => t.id === id ? { ...t, done: !t.done } : t);
  await save('tasks', tasks);
  renderTasks();
  updateBadges();
  chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' });
}

async function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  await save('tasks', tasks);
  renderTasks();
  updateBadges();
  showToast('Task deleted');
}

// ═══════════════════════════════════════════════════════════════
//  POMODORO
// ═══════════════════════════════════════════════════════════════
function setupPomodoro() {
  document.getElementById('timerToggle').addEventListener('click', togglePomodoro);
  document.getElementById('timerReset').addEventListener('click', resetPomodoro);
  document.getElementById('timerSkip').addEventListener('click', skipPomodoro);
  document.getElementById('saveSettingsBtn').addEventListener('click', savePomodoroSettings);

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => switchMode(btn.dataset.mode));
  });
}

function switchMode(mode) {
  if (pomodoroState.interval) clearInterval(pomodoroState.interval);
  pomodoroState.running = false;
  pomodoroState.mode = mode;

  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('mode' + { work: 'Work', short: 'Short', long: 'Long' }[mode]).classList.add('active');

  const minutes = mode === 'work' ? pomodoroSettings.work : mode === 'short' ? pomodoroSettings.shortBreak : pomodoroSettings.longBreak;
  pomodoroState.timeLeft = pomodoroState.totalTime = minutes * 60;

  updatePlayIcon(false);
  updateTimerDisplay();
  updateRing();

  const labels = { work: 'Focus Time', short: 'Short Break', long: 'Long Break' };
  document.getElementById('timerModeLabel').textContent = labels[mode];
  const colors = { work: '#4f8ef7', short: '#22c55e', long: '#a855f7' };
  document.querySelector('.ring-progress').style.stroke = colors[mode];
}

function togglePomodoro() {
  if (pomodoroState.running) {
    clearInterval(pomodoroState.interval);
    pomodoroState.running = false;
    updatePlayIcon(false);
  } else {
    pomodoroState.running = true;
    updatePlayIcon(true);
    pomodoroState.interval = setInterval(() => {
      pomodoroState.timeLeft--;
      updateTimerDisplay();
      updateRing();
      if (pomodoroState.timeLeft <= 0) {
        clearInterval(pomodoroState.interval);
        pomodoroState.running = false;
        onPomodoroComplete();
      }
    }, 1000);
  }
}

function resetPomodoro() {
  clearInterval(pomodoroState.interval);
  pomodoroState.running = false;
  const minutes = pomodoroState.mode === 'work' ? pomodoroSettings.work :
    pomodoroState.mode === 'short' ? pomodoroSettings.shortBreak : pomodoroSettings.longBreak;
  pomodoroState.timeLeft = pomodoroState.totalTime = minutes * 60;
  updatePlayIcon(false);
  updateTimerDisplay();
  updateRing();
}

function skipPomodoro() {
  clearInterval(pomodoroState.interval);
  pomodoroState.running = false;
  onPomodoroComplete();
}

function onPomodoroComplete() {
  updatePlayIcon(false);
  if (pomodoroState.mode === 'work') {
    pomodoroState.session++;
    if (pomodoroState.session > 4) pomodoroState.session = 1;
    updateSessionDots();
    const breakMode = pomodoroState.session % 4 === 0 ? 'long' : 'short';
    switchMode(breakMode);
    if (!dnd) chrome.notifications.create('pomodoro_break_' + Date.now(), {
      type: 'basic', iconUrl: 'icons/icon128.png',
      title: '🍅 Focus session complete!',
      message: breakMode === 'long' ? 'Time for a long break!' : 'Take a short break!'
    });
  } else {
    switchMode('work');
    if (!dnd) chrome.notifications.create('pomodoro_work_' + Date.now(), {
      type: 'basic', iconUrl: 'icons/icon128.png',
      title: '💪 Break over!',
      message: 'Time to focus again!'
    });
  }
}

function updatePlayIcon(playing) {
  document.getElementById('playPauseIcon').innerHTML = playing
    ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
    : '<polygon points="5 3 19 12 5 21 5 3"/>';
}

function updateTimerDisplay() {
  const m = Math.floor(pomodoroState.timeLeft / 60).toString().padStart(2, '0');
  const s = (pomodoroState.timeLeft % 60).toString().padStart(2, '0');
  document.getElementById('timerDisplay').textContent = `${m}:${s}`;
}

function updateRing() {
  const circumference = 534;
  const pct = pomodoroState.timeLeft / pomodoroState.totalTime;
  document.getElementById('ringProgress').style.strokeDashoffset = circumference * (1 - pct);
}

function resetPomodoroDisplay() {
  switchMode('work');
  updateSessionDots();
}

function updateSessionDots() {
  document.querySelectorAll('.dot').forEach((d, i) => {
    d.className = 'dot';
    if (i + 1 < pomodoroState.session) d.classList.add('done');
    else if (i + 1 === pomodoroState.session) d.classList.add('active');
  });
  document.getElementById('sessionLabel').textContent = `Session ${pomodoroState.session} of 4`;
}

async function savePomodoroSettings() {
  pomodoroSettings = {
    work:       parseInt(document.getElementById('settingWork').value)  || 25,
    shortBreak: parseInt(document.getElementById('settingShort').value) || 5,
    longBreak:  parseInt(document.getElementById('settingLong').value)  || 15
  };
  await save('pomodoroSettings', pomodoroSettings);
  resetPomodoro();
  showToast('Settings saved!', 'success');
}

// ═══════════════════════════════════════════════════════════════
//  NOTES
// ═══════════════════════════════════════════════════════════════
function setupNotes() {
  const area = document.getElementById('notesArea');
  let saveTimer;

  area.addEventListener('input', () => {
    notes = area.value;
    updateCharCount();
    document.getElementById('saveIndicator').textContent = '';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await save('notes', notes);
      document.getElementById('saveIndicator').textContent = '✓ Saved';
      setTimeout(() => { document.getElementById('saveIndicator').textContent = ''; }, 2000);
    }, 800);
  });

  document.getElementById('copyNoteBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(notes).then(() => showToast('Copied to clipboard!', 'success'));
  });

  document.getElementById('clearNoteBtn').addEventListener('click', async () => {
    if (!confirm('Clear all notes?')) return;
    notes = '';
    area.value = '';
    await save('notes', notes);
    updateCharCount();
    showToast('Notes cleared');
  });

  const templates = {
    meeting: `📋 MEETING NOTES\nDate: ${new Date().toLocaleDateString()}\nAttendees: \n\nAgenda:\n- \n\nAction Items:\n- \n\nDecisions:\n- `,
    standup: `🌅 DAILY STANDUP — ${new Date().toLocaleDateString()}\n\nYesterday:\n- \n\nToday:\n- \n\nBlockers:\n- `,
    followup: `📞 FOLLOW-UP NOTES\nDate: ${new Date().toLocaleDateString()}\nContact: \nCompany: \n\nDiscussed:\n- \n\nNext Steps:\n- `,
    review: `📊 REVIEW NOTES\nDate: ${new Date().toLocaleDateString()}\nTopic: \n\nKey Points:\n- \n\nRecommendations:\n- `
  };

  document.querySelectorAll('.template-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tpl = templates[btn.dataset.template];
      if (area.value && !confirm('Replace current notes with template?')) return;
      area.value = tpl;
      notes = tpl;
      save('notes', notes);
      updateCharCount();
      showToast('Template loaded!', 'success');
    });
  });
}

function updateCharCount() {
  document.getElementById('charCount').textContent = `${notes.length} character${notes.length !== 1 ? 's' : ''}`;
}

// ═══════════════════════════════════════════════════════════════
//  SETTINGS (TIMEZONE + WORKING HOURS)
// ═══════════════════════════════════════════════════════════════
function setupSettings() {
  // Populate the select with the saved/detected timezone
  const sel = document.getElementById('timezoneSelect');
  sel.value = userTimezone;

  // Live preview when user changes the dropdown (before saving)
  sel.addEventListener('change', () => tickTzClock(sel.value));

  // Save timezone
  document.getElementById('saveTzBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const oldHtml = btn.innerHTML;
    userTimezone = sel.value;
    await save('userTimezone', userTimezone);
    updateTzChip();
    updateDateChip();
    renderReminders(); // refresh displayed times
    
    // Feedback
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;"><polyline points="20 6 9 17 4 12"></polyline></svg> Saved!';
    btn.classList.add('btn-success');
    showToast('🌍 Timezone saved!', 'success');
    
    setTimeout(() => {
      btn.innerHTML = oldHtml;
      btn.classList.remove('btn-success');
    }, 2000);
  });

  // Clicking the header TZ chip jumps to Settings tab
  document.getElementById('tzChip').addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-settings').classList.add('active');
    document.getElementById('panel-settings').classList.add('active');
  });

  // Save working hours
  document.getElementById('saveWorkHoursBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const oldHtml = btn.innerHTML;
    workHours = {
      start: document.getElementById('workStart').value || '09:00',
      end:   document.getElementById('workEnd').value   || '18:00'
    };
    await save('workHours', workHours);

    // Feedback
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;"><polyline points="20 6 9 17 4 12"></polyline></svg> Saved!';
    btn.classList.add('btn-success');
    showToast('🕘 Working hours saved!', 'success');

    setTimeout(() => {
      btn.innerHTML = oldHtml;
      btn.classList.remove('btn-success');
    }, 2000);
  });
}

// ─── Live TZ Clock ────────────────────────────────────────────
function startTzClock() {
  tickTzClock(userTimezone);
  setInterval(() => tickTzClock(
    document.getElementById('timezoneSelect')?.value || userTimezone
  ), 1000);
}

function tickTzClock(tz) {
  const clockEl = document.getElementById('tzLiveClock');
  const dateEl  = document.getElementById('tzLiveDate');
  if (!clockEl) return;
  try {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
    const dateStr = now.toLocaleDateString('en-US', {
      timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
    clockEl.textContent = timeStr;
    dateEl.textContent  = dateStr;
  } catch (e) {
    clockEl.textContent = '--:--';
  }
}


function setupDND() {
  document.getElementById('dndBtn').addEventListener('click', async () => {
    dnd = !dnd;
    await save('dnd', dnd);
    renderDND();
    showToast(dnd ? '🔕 Do Not Disturb ON' : '🔔 Notifications resumed');
  });
}

function renderDND() {
  document.getElementById('dndBanner').style.display = dnd ? 'block' : 'none';
  document.getElementById('dndBtn').classList.toggle('active', dnd);
}

// ═══════════════════════════════════════════════════════════════
//  BADGES
// ═══════════════════════════════════════════════════════════════
function updateBadges() {
  const activeReminders = reminders.filter(r => r.status === 'active').length;
  const el = document.getElementById('reminderBadge');
  if (activeReminders > 0) { el.textContent = activeReminders; el.style.display = 'inline'; }
  else el.style.display = 'none';

  const now = new Date(); now.setHours(0,0,0,0);
  const overdueTasks = tasks.filter(t => !t.done && t.dueDate && new Date(t.dueDate) < now).length;
  const tb = document.getElementById('taskBadge');
  if (overdueTasks > 0) { tb.textContent = overdueTasks; tb.style.display = 'inline'; }
  else tb.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  setTimeout(() => { t.className = 'toast'; }, 2500);
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('en-US', {
    timeZone: userTimezone,
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
