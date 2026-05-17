// ============================================================
// WorkDesk — Background Service Worker
// Handles: alarms, notifications, badge updates
// ============================================================

const ALARM_PREFIX = 'workdesk_reminder_';

// ─── Alarm Listener ──────────────────────────────────────────
// Cache for atomic deduplication to prevent race conditions from multiple Gmail tabs
const recentlyAddedSubjects = new Set();
let pendingFires = [];
let fireTimeout = null;

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;

  const reminderId = alarm.name.replace(ALARM_PREFIX, '').replace('_snooze', '');
  pendingFires.push(reminderId);

  if (fireTimeout) clearTimeout(fireTimeout);

  fireTimeout = setTimeout(async () => {
    const idsToFire = [...new Set(pendingFires)];
    pendingFires = [];

    const data = await chrome.storage.local.get(['reminders', 'dnd']);
    let reminders = data.reminders || [];
    const dnd = data.dnd || false;

    const alarmsToFire = reminders.filter(r => idsToFire.includes(r.id));
    if (alarmsToFire.length === 0) return;

    // Mark as fired or update fireAt for recurring
    reminders = reminders.map(r => {
      if (!idsToFire.includes(r.id)) return r;
      
      if (r.repeat === 'daily') {
        const nextFire = new Date(r.fireAt);
        nextFire.setDate(nextFire.getDate() + 1);
        chrome.alarms.create(`${ALARM_PREFIX}${r.id}`, { when: nextFire.getTime() });
        return { ...r, fireAt: nextFire.getTime() };
      } else if (r.repeat === 'weekly') {
        const nextFire = new Date(r.fireAt);
        nextFire.setDate(nextFire.getDate() + 7);
        chrome.alarms.create(`${ALARM_PREFIX}${r.id}`, { when: nextFire.getTime() });
        return { ...r, fireAt: nextFire.getTime() };
      } else {
        return { ...r, status: 'fired' };
      }
    });

    await chrome.storage.local.set({ reminders });
    updateBadge();

    if (dnd) return;

    if (alarmsToFire.length === 1) {
      const r = alarmsToFire[0];
      chrome.notifications.create(`notif_${r.id}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: `⏰ ${r.title.replace(/^Follow up on email:\s*/i, '')}`,
        message: r.note || 'You have a reminder from WorkDesk.',
        priority: 2,
        requireInteraction: true,
        buttons: [{ title: 'Snooze 10 min' }, { title: 'Dismiss' }]
      });

      try {
        chrome.windows.create({
          url: `alarm.html?id=${r.id}`,
          type: 'popup',
          width: 400,
          height: 380,
          focused: true
        });
      } catch (e) { console.error(e); }
    } else {
      const ids = alarmsToFire.map(r => r.id).join(',');
      chrome.notifications.create(`notif_bundled_${Date.now()}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: `⏰ ${alarmsToFire.length} Reminders Due!`,
        message: `You have ${alarmsToFire.length} follow-ups scheduled right now.`,
        priority: 2,
        requireInteraction: true,
        buttons: [{ title: 'Snooze All 10 min' }, { title: 'Dismiss All' }]
      });

      try {
        chrome.windows.create({
          url: `alarm.html?ids=${ids}`,
          type: 'popup',
          width: 400,
          height: 420,
          focused: true
        });
      } catch (e) { console.error(e); }
    }
  }, 1000);
});

// ─── Notification Button Clicks ──────────────────────────────
chrome.notifications.onButtonClicked.addListener(async (notifId, buttonIdx) => {
  const reminderId = notifId.replace('notif_', '');

  if (buttonIdx === 0) {
    // Snooze 10 minutes
    chrome.alarms.create(`${ALARM_PREFIX}${reminderId}_snooze`, {
      delayInMinutes: 10
    });
    chrome.notifications.create(`snooze_notif_${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'WorkDesk — Snoozed',
      message: 'Reminder snoozed for 10 minutes.'
    });
  }

  chrome.notifications.clear(notifId);
});

// ─── Badge Management ─────────────────────────────────────────
async function updateBadge() {
  const data = await chrome.storage.local.get(['reminders', 'tasks']);
  const reminders = data.reminders || [];
  const tasks = data.tasks || [];

  const pendingReminders = reminders.filter(r => r.status === 'active').length;
  const pendingTasks = tasks.filter(t => !t.done && isOverdue(t.dueDate)).length;
  const total = pendingReminders + pendingTasks;

  if (total > 0) {
    chrome.action.setBadgeText({ text: String(total) });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

function isOverdue(dueDate) {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

// ─── Install / Startup ────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  // Init default storage
  const existing = await chrome.storage.local.get(['reminders', 'tasks', 'notes', 'pomodoroSettings', 'dnd']);
  if (!existing.reminders) await chrome.storage.local.set({ reminders: [] });
  if (!existing.tasks) await chrome.storage.local.set({ tasks: [] });
  if (!existing.notes) await chrome.storage.local.set({ notes: '' });
  if (!existing.dnd) await chrome.storage.local.set({ dnd: false });
  if (!existing.pomodoroSettings) {
    await chrome.storage.local.set({
      pomodoroSettings: { work: 25, shortBreak: 5, longBreak: 15 }
    });
  }

  // Morning digest alarm — fires every day at 9am
  chrome.alarms.create('workdesk_morning_digest', {
    when: getNextNineAM(),
    periodInMinutes: 24 * 60
  });

  updateBadge();
});

chrome.runtime.onStartup.addListener(() => updateBadge());

// ─── Helpers ─────────────────────────────────────────────────
function getNextNineAM() {
  const now = new Date();
  const nineAM = new Date();
  nineAM.setHours(9, 0, 0, 0);
  if (nineAM <= now) nineAM.setDate(nineAM.getDate() + 1);
  return nineAM.getTime();
}

// ─── Message Bridge (from popup) ─────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SET_ALARM') {
    const { id, fireAt } = msg.payload;
    chrome.alarms.create(`${ALARM_PREFIX}${id}`, { when: fireAt });
    sendResponse({ ok: true });
  }
  if (msg.type === 'CANCEL_ALARM') {
    chrome.alarms.clear(`${ALARM_PREFIX}${msg.payload.id}`);
    sendResponse({ ok: true });
  }
  if (msg.type === 'UPDATE_BADGE') {
    updateBadge();
    sendResponse({ ok: true });
  }
  if (msg.type === 'ADD_GMAIL_REMINDER') {
    const { title, url } = msg.payload;

    // Atomic deduplication: instantly block identical requests arriving at the same millisecond
    if (recentlyAddedSubjects.has(title)) {
      console.log("WorkDesk: Blocked duplicate ADD request for:", title);
      sendResponse({ ok: false, reason: "duplicate" });
      return true;
    }
    recentlyAddedSubjects.add(title);
    setTimeout(() => recentlyAddedSubjects.delete(title), 15000);

    chrome.storage.local.get(['reminders', 'dnd'], (data) => {
      const reminders = data.reminders || [];
      const dnd = data.dnd || false;
      
      const now = new Date();
      now.setDate(now.getDate() + 1);
      now.setHours(8, 30, 0, 0);
      const fireAt = now.getTime();
      
      const reminder = {
        id: 'r_' + Date.now(),
        title: `Follow up on email: ${title}`,
        note: url,
        priority: 'high',
        repeat: 'daily',
        fireAt: fireAt,
        status: 'active',
        createdAt: Date.now()
      };
      
      reminders.unshift(reminder);
      chrome.storage.local.set({ reminders }, () => {
        chrome.alarms.create(`${ALARM_PREFIX}${reminder.id}`, { when: fireAt });
        updateBadge();
        
        if (!dnd) {
          chrome.notifications.create('gmail_drop_' + Date.now(), {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'WorkDesk Reminder Added',
            message: `Scheduled for tomorrow 8:30 AM: ${title}`,
            priority: 2,
            requireInteraction: true
          });
        }
      });
    });
    sendResponse({ ok: true });
  }
  if (msg.type === 'REMOVE_GMAIL_REMINDER') {
    const { title } = msg.payload;
    
    // Atomic deduplication for removals to prevent multiple notifications from ghost scripts
    if (recentlyAddedSubjects.has("REM_" + title)) {
      sendResponse({ ok: false, reason: "duplicate" });
      return true;
    }
    recentlyAddedSubjects.add("REM_" + title);
    setTimeout(() => recentlyAddedSubjects.delete("REM_" + title), 15000);

    chrome.storage.local.get(['reminders'], (data) => {
      const reminders = data.reminders || [];
      const cleanPayload = title.toLowerCase().trim();
      
      const toRemove = reminders.filter(r => {
        const cleanDB = r.title.replace(/^Follow up on email:\s*/i, '').toLowerCase().trim();
        return cleanDB.includes(cleanPayload) || cleanPayload.includes(cleanDB);
      });
      
      if (toRemove.length > 0) {
        const updated = reminders.filter(r => !toRemove.includes(r));
        
        chrome.storage.local.set({ reminders: updated }, () => {
          toRemove.forEach(r => {
            chrome.alarms.clear(`${ALARM_PREFIX}${r.id}`);
          });
          updateBadge();
          
          chrome.notifications.create('gmail_remove_' + Date.now(), {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'WorkDesk Reminder Removed',
            message: `Auto-deleted: ${title}`,
            priority: 1
          });
        });
      }
    });
    sendResponse({ ok: true });
  }
  if (msg.type === 'SNOOZE_ALARM') {
    const reminderId = msg.payload.id;
    const delay = msg.payload.delay || 10;
    chrome.alarms.create(`${ALARM_PREFIX}${reminderId}_snooze`, {
      delayInMinutes: delay
    });
    chrome.notifications.create(`snooze_notif_${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'WorkDesk — Snoozed',
      message: 'Reminder snoozed for 10 minutes.'
    });
    sendResponse({ ok: true });
  }
  return true;
});
