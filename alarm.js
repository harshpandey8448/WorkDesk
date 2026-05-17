document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const reminderId = urlParams.get('id');
  const idsParam = urlParams.get('ids');

  const data = await chrome.storage.local.get('reminders');
  const reminders = data.reminders || [];
  const contentArea = document.getElementById('contentArea');

  // Helper to clean up "Follow up on email: " text
  const cleanTitle = (title) => {
    return title.replace(/^Follow up on email:\s*/i, '');
  };

  const mailIcon = `<svg class="item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>`;
  const checkIcon = `<svg class="item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="9 12 11 14 15 10"></polyline></svg>`;

  if (idsParam) {
    const ids = idsParam.split(',');
    const activeReminders = reminders.filter(r => ids.includes(r.id));

    document.getElementById('title').textContent = `${activeReminders.length} Reminders Due`;
    document.getElementById('subtitle').textContent = 'Action Required';
    
    const listHtml = activeReminders.map((r) => {
      const isEmail = r.title.toLowerCase().includes('email:');
      const icon = isEmail ? mailIcon : checkIcon;
      const typeText = isEmail ? 'EMAIL FOLLOW-UP' : 'TASK';
      
      return `
      <div class="reminder-item" id="item-${r.id}">
        ${icon}
        <div class="reminder-text-content" style="flex:1;">
          <span class="reminder-type">${typeText}</span>
          <span class="reminder-text">${cleanTitle(r.title)}</span>
          <div class="item-actions">
            <button class="btn-sm done" data-action="done" data-id="${r.id}">✔ Done Today</button>
            <button class="btn-sm snooze" data-action="snooze-60" data-id="${r.id}">⏳ 1 Hour</button>
            <button class="btn-sm snooze" data-action="snooze-120" data-id="${r.id}">⏳ 2 Hours</button>
          </div>
        </div>
      </div>
    `}).join('');
    
    contentArea.innerHTML = `<div class="reminder-list">${listHtml}</div>`;
    
    // Buttons are already set in HTML, just bind events
    document.getElementById('dismissBtn').addEventListener('click', () => {
      window.close();
    });

    document.getElementById('snoozeBtn').addEventListener('click', () => {
      ids.forEach(id => {
        chrome.runtime.sendMessage({ type: 'SNOOZE_ALARM', payload: { id } });
      });
      setTimeout(() => window.close(), 100);
    });
  } else {
    const reminder = reminders.find(r => r.id === reminderId);

    if (reminder) {
      document.getElementById('title').textContent = 'Reminder Due';
      document.getElementById('subtitle').textContent = 'Action Required';
      
      const isEmail = reminder.title.toLowerCase().includes('email:');
      const icon = isEmail ? mailIcon : checkIcon;
      const typeText = isEmail ? 'EMAIL FOLLOW-UP' : 'TASK';

      contentArea.innerHTML = `
        <div class="reminder-item" id="item-${reminder.id}" style="border:none; box-shadow:none; padding:0; background:transparent;">
          ${icon}
          <div class="reminder-text-content" style="flex:1;">
            <span class="reminder-type">${typeText}</span>
            <span class="reminder-text">${cleanTitle(reminder.title)}</span>
            <div class="item-actions">
              <button class="btn-sm done" data-action="done" data-id="${reminder.id}">✔ Done Today</button>
              <button class="btn-sm snooze" data-action="snooze-60" data-id="${reminder.id}">⏳ 1 Hour</button>
              <button class="btn-sm snooze" data-action="snooze-120" data-id="${reminder.id}">⏳ 2 Hours</button>
            </div>
          </div>
        </div>
        <div style="margin-top: 16px; font-size: 13px; color: var(--text-muted); line-height: 1.5;">
          ${reminder.note && reminder.note.startsWith('http') ? `<a href="${reminder.note}" target="_blank" style="color:var(--accent); text-decoration:none;">Open Link →</a>` : (reminder.note || '')}
        </div>
      `;
    } else {
      document.getElementById('title').textContent = 'Daily Digest';
      document.getElementById('subtitle').textContent = 'Briefing';
      contentArea.innerHTML = `<div class="single-note">Time to check your tasks for today!</div>`;
    }

    document.getElementById('dismissBtn').addEventListener('click', () => {
      window.close();
    });

    document.getElementById('snoozeBtn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'SNOOZE_ALARM', payload: { id: reminderId, delay: 10 } }, () => {
        window.close();
      });
    });
  }

  // Handle per-item actions
  contentArea.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-sm');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;
    
    if (action.startsWith('snooze-')) {
      const delay = parseInt(action.split('-')[1], 10);
      chrome.runtime.sendMessage({ type: 'SNOOZE_ALARM', payload: { id, delay } });
    }

    // "Done Today" naturally does nothing on the backend because the background script 
    // already rescheduled the alarm for tomorrow automatically. We just hide it.

    // Hide the item visually
    const itemEl = document.getElementById(`item-${id}`);
    if (itemEl) {
      itemEl.style.transition = 'all 0.3s ease';
      itemEl.style.opacity = '0';
      itemEl.style.transform = 'scale(0.95)';
      setTimeout(() => {
        itemEl.style.display = 'none';
        itemEl.classList.add('removed');
        
        // Check if any visible items remain
        const remaining = document.querySelectorAll('.reminder-item:not(.removed)');
        if (remaining.length === 0) {
          window.close();
        }
      }, 300);
    }
  });
});
