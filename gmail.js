// ============================================================
// WorkDesk — Gmail Integration
// Listens for drag-and-drop events on the "WorkDesk" label
// ============================================================

console.log("WorkDesk: Gmail integration script loaded.");

function initGmailObserver() {
  console.log("WorkDesk: Initializing robust Gmail observer...");

  // Cache for subjects of rows that just vanished from the screen
  const recentlyRemovedSubjects = new Set();

  // MutationObserver to catch subjects of rows AS they are being removed
  const rowObserver = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.removedNodes) {
        m.removedNodes.forEach(node => {
          if (node.nodeType === 1) { // Element
            const tr = node.nodeName === 'TR' ? node : node.querySelector?.('tr');
            if (tr) {
              const subjEl = tr.querySelector('span.bog');
              if (subjEl && (subjEl.innerText || subjEl.textContent)) {
                const s = (subjEl.innerText || subjEl.textContent).trim();
                recentlyRemovedSubjects.add(s);
                // Expire after 10 seconds to prevent stale deletions
                setTimeout(() => recentlyRemovedSubjects.delete(s), 10000);
              }
            }
          }
        });
      }
    }
  });
  rowObserver.observe(document.body, { childList: true, subtree: true });

  // Global click tracker to remember the subject of the last interacted email row.
  window.addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (tr) {
      const subjEl = tr.querySelector('span.bog');
      if (subjEl && subjEl.innerText) {
        window.wdLastInteractedSubject = subjEl.innerText.trim();
      }
    }
  }, true);

  const observerInterval = setInterval(() => {
    // Bulletproof check for invalidated extension context
    try {
      chrome.runtime.getManifest();
    } catch (e) {
      console.warn("WorkDesk: Extension reloaded. Stopping background observer on this tab. Please refresh Gmail.");
      clearInterval(observerInterval);
      return;
    }

    const isWorkDeskFolder = window.location.hash.toLowerCase().includes('workdesk');
    
    // Look for any alert container or the specific .bAq class Gmail uses for toasts
    const toastContainers = Array.from(document.querySelectorAll('[role="alert"], .bAq, .vh'));
    
    for (const container of toastContainers) {
      // Check if the toast is actually visible on screen
      const rect = container.getBoundingClientRect();
      const style = window.getComputedStyle(container);
      
      if (rect.width === 0 || rect.height === 0 || style.opacity === '0' || style.display === 'none' || style.visibility === 'hidden') {
        delete container.dataset.wdLastKey;
        continue;
      }
      
      const text = (container.innerText || container.textContent || '').trim();
      if (!text) continue;

      const lower = text.toLowerCase();
      
      // Check if it's a relevant action
      const isWorkDeskLabel = lower.includes('workdesk');
      const isRemoval = lower.includes('removed') || lower.includes('archived') || lower.includes('moved') || lower.includes('deleted');

      if (isWorkDeskLabel || (isWorkDeskFolder && isRemoval)) {
        
        // Extract the email subject first to create a unique fingerprint
        let subject = "";
        const titleEl = document.querySelector('h2.hP');
        if (titleEl && titleEl.innerText) {
          subject = titleEl.innerText.trim();
        } else {
          let t = document.title || "";
          t = t.replace(/ - [^ ]+@.* - Gmail/, ''); 
          if (t && t !== "Gmail" && !t.includes("Inbox") && !t.includes("WorkDesk")) {
            subject = t.trim();
          }
        }

        // Fallback to the last interacted row
        if (!subject && window.wdLastInteractedSubject) {
          subject = window.wdLastInteractedSubject;
        }

        const finalSubject = subject || "New email in 'WorkDesk' label";

        // Create a unique key using both the generic toast text AND the specific subject.
        // This allows rapid addition/removal of DIFFERENT emails, while blocking duplicate DOM node processing.
        const duplicateKey = text + "|" + finalSubject;
        if (container.dataset.wdLastKey === duplicateKey) continue;
        container.dataset.wdLastKey = duplicateKey;

        if (isRemoval) {
          // Batch removal via row cache
          if (recentlyRemovedSubjects.size > 0) {
            console.log("WorkDesk: Batch REMOVAL detected:", Array.from(recentlyRemovedSubjects));
            recentlyRemovedSubjects.forEach(s => {
              try { chrome.runtime.sendMessage({ type: 'REMOVE_GMAIL_REMINDER', payload: { title: s } }).catch(() => {}); } catch(e) {}
            });
            recentlyRemovedSubjects.clear();
          } else {
            // Single removal
            const target = subject || window.wdLastInteractedSubject;
            if (target) {
              console.log("WorkDesk: Single REMOVAL detected:", target);
              try { chrome.runtime.sendMessage({ type: 'REMOVE_GMAIL_REMINDER', payload: { title: target } }).catch(() => {}); } catch(e) {}
            }
          }
        } else if (isWorkDeskLabel) {
          // Addition action
          console.log("WorkDesk: ADDITION detected:", finalSubject);
          try {
            chrome.runtime.sendMessage({
              type: 'ADD_GMAIL_REMINDER',
              payload: {
                title: finalSubject,
                url: "https://mail.google.com/mail/u/0/#label/WorkDesk"
              }
            }).catch(() => {});
          } catch(e) {}
        }
        break; 
      }
    }
  }, 1000);
}

// Prevent multiple injections
if (!window.wdGmailLoaded) {
  window.wdGmailLoaded = true;
  initGmailObserver();
}
