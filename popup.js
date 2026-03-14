(() => {
  const SCRIBD_PATTERN = /scribd\.com\/(document|doc|presentation|book)\/(\d+)/i;
  const $ = (sel) => document.querySelector(sel);

  function extractDocId(url) {
    const match = url.match(SCRIBD_PATTERN);
    return match ? match[2] : null;
  }

  $('#scribd-url').addEventListener('input', () => {
    $('#btn-start').disabled = !extractDocId($('#scribd-url').value.trim());
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab && tab.url) {
      const docId = extractDocId(tab.url);
      if (docId) {
        const banner = $('#detect-banner');
        banner.classList.add('visible');
        banner.addEventListener('click', () => {
          $('#scribd-url').value = tab.url;
          $('#scribd-url').dispatchEvent(new Event('input'));
          banner.classList.remove('visible');
        });
      }
    }
  });

  function showNoti(type, text) {
    const noti = $('#noti');
    const icon = $('#noti-icon');
    noti.className = `noti visible ${type}`;

    if (type === 'working') {
      icon.innerHTML = '<div class="spinner"></div>';
    } else if (type === 'success') {
      icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
    } else {
      icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    }

    $('#noti-text').textContent = text;
  }

  function hideNoti() {
    $('#noti').className = 'noti';
  }

  function renderState(state) {
    if (state.step === 'idle') {
      hideNoti();
      $('#btn-start').disabled = !extractDocId($('#scribd-url').value.trim());
      return;
    }

    if (state.type === 'error') {
      showNoti('error', state.message);
    } else if (state.step === 'done') {
      showNoti('success', state.message);
    } else if (state.running) {
      showNoti('working', state.message);
    }

    $('#btn-start').disabled = state.running;
  }

  let pollTimer = null;

  function startPolling() {
    pollNow();
    pollTimer = setInterval(pollNow, 800);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function pollNow() {
    chrome.runtime.sendMessage({ action: 'getState' }, (state) => {
      if (chrome.runtime.lastError || !state) return;
      renderState(state);
      if (!state.running && state.step !== 'idle') stopPolling();
    });
  }

  startPolling();

  $('#btn-start').addEventListener('click', () => {
    const url = $('#scribd-url').value.trim();
    const docId = extractDocId(url);
    if (!docId) return;

    $('#btn-start').disabled = true;
    showNoti('working', 'Đang xử lý...');

    chrome.runtime.sendMessage(
      { action: 'startDownload', config: { docId } },
      (resp) => {
        if (chrome.runtime.lastError) {
          showNoti('error', 'Lỗi kết nối background');
          $('#btn-start').disabled = false;
          return;
        }
        if (resp && resp.error) {
          showNoti('error', resp.error);
          $('#btn-start').disabled = false;
          return;
        }
        startPolling();
      }
    );
  });
})();
