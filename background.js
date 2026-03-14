let jobState = {
  running: false,
  step: 'idle',
  progress: 0,
  message: '',
  type: '',
  tabId: null,
};

function updateState(patch) {
  Object.assign(jobState, patch);
}

function resetState() {
  jobState = {
    running: false,
    step: 'idle',
    progress: 0,
    message: '',
    type: '',
    tabId: null,
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getState') {
    sendResponse(jobState);
    return true;
  }

  if (msg.action === 'startDownload') {
    if (jobState.running) {
      sendResponse({ error: 'Đang xử lý một tài liệu khác' });
      return true;
    }
    startDownloadJob(msg.config);
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

async function startDownloadJob(config) {
  const { docId } = config;
  const embedUrl = `https://www.scribd.com/embeds/${docId}/content`;

  resetState();
  updateState({ running: true, step: 'working', progress: 5, message: 'Đang xử lý...' });

  let tabId = null;

  try {
    const tab = await chrome.tabs.create({ url: embedUrl, active: true });
    tabId = tab.id;

    await waitForTabLoad(tabId);
    await sleep(3000);

    updateState({ message: 'Đang xử lý nội dung...' });
    await execScript(tabId, injectedQuickScroll);
    await pollScrollDone(tabId);

    await execScript(tabId, injectedCleanDOM);
    await sleep(500);

    const [pageDims] = await execScript(tabId, injectedGetPageDimensions);
    const dims = pageDims?.result;
    await sleep(500);

    updateState({ message: 'Đang tạo file PDF...' });
    const pdfBase64 = await printToPdf(tabId, dims);

    updateState({ message: 'Đang tải xuống...' });
    const dataUrl = 'data:application/pdf;base64,' + pdfBase64;
    const filename = `scribd_${docId}.pdf`;
    const downloadId = await downloadFile(dataUrl, filename);

    try { await chrome.tabs.remove(tabId); } catch (e) { /* already closed */ }

    const savedPath = await getDownloadPath(downloadId);
    const displayPath = savedPath || filename;

    updateState({
      step: 'done', progress: 100,
      message: `Đã lưu: ${displayPath}`,
      type: 'success', running: false,
    });
  } catch (err) {
    updateState({
      step: 'error',
      message: `Lỗi: ${err.message || err}`,
      type: 'error', running: false,
    });
  }
}

function getDownloadPath(downloadId) {
  return new Promise((resolve) => {
    if (!downloadId) { resolve(null); return; }
    chrome.downloads.search({ id: downloadId }, (items) => {
      if (chrome.runtime.lastError || !items || !items.length) { resolve(null); return; }
      resolve(items[0].filename || null);
    });
  });
}

function printToPdf(tabId, dims) {
  const pxToInch = (px) => px / 96;

  const pdfOpts = {
    printBackground: false,
    preferCSSPageSize: true,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
  };

  if (dims && dims.width && dims.height) {
    pdfOpts.paperWidth = pxToInch(dims.width);
    pdfOpts.paperHeight = pxToInch(dims.height);
    pdfOpts.preferCSSPageSize = false;
  }

  return new Promise((resolve, reject) => {
    const target = { tabId };

    chrome.debugger.attach(target, '1.3', () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      chrome.debugger.sendCommand(target, 'Page.printToPDF', pdfOpts, (result) => {
        chrome.debugger.detach(target, () => {
          if (chrome.runtime.lastError) { /* ignore */ }
        });

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!result || !result.data) {
          reject(new Error('Không nhận được dữ liệu PDF'));
          return;
        }

        resolve(result.data);
      });
    });
  });
}

function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(downloadId);
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = setInterval(() => {
      if (++attempts > 60) { clearInterval(check); reject(new Error('Quá thời gian chờ')); return; }
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) { clearInterval(check); reject(new Error('Mất kết nối')); return; }
        if (tab.status === 'complete') { clearInterval(check); resolve(); }
      });
    }, 500);
  });
}

function execScript(tabId, func, args) {
  return new Promise((resolve, reject) => {
    const opts = { target: { tabId }, func };
    if (args) opts.args = args;
    chrome.scripting.executeScript(opts, (results) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      resolve(results);
    });
  });
}

function pollScrollDone(tabId) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const poll = setInterval(() => {
      if (++attempts > 120) { clearInterval(poll); resolve(); return; }
      chrome.scripting.executeScript(
        { target: { tabId }, func: () => window.__scrollStatus || { done: false, progress: 0 } },
        (results) => {
          if (chrome.runtime.lastError) { clearInterval(poll); reject(new Error(chrome.runtime.lastError.message)); return; }
          const s = results?.[0]?.result;
          if (!s) return;
          updateState({ message: `Đang xử lý... ${Math.round(s.progress * 100)}%` });
          if (s.done) { clearInterval(poll); resolve(); }
        }
      );
    }, 500);
  });
}

// ============================================================
// INJECTED FUNCTIONS
// ============================================================

function injectedQuickScroll() {
  window.__scrollStatus = { done: false, progress: 0 };

  const scroller =
    document.querySelector('.document_scroller') ||
    document.scrollingElement ||
    document.documentElement;

  const viewHeight = scroller.clientHeight;
  const step = viewHeight * 0.8;
  let current = 0;

  function tick() {
    const totalHeight = scroller.scrollHeight;
    current += step;
    scroller.scrollTop = current;

    const maxScroll = totalHeight - viewHeight;
    window.__scrollStatus.progress = maxScroll > 0 ? Math.min(current / maxScroll, 1) : 1;

    if (current >= totalHeight) {
      scroller.scrollTop = 0;
      setTimeout(() => {
        window.__scrollStatus = { done: true, progress: 1 };
      }, 500);
    } else {
      setTimeout(tick, 120);
    }
  }

  tick();
}

function injectedCleanDOM() {
  document.querySelectorAll('[class*="document_scroller"]').forEach((el) => {
    el.className = el.className.replace(/\bdocument_scroller\b/g, '').trim();
    el.style.overflow = 'visible';
    el.style.height = 'auto';
  });

  document.querySelectorAll('[class*="toolbar_drop"]').forEach((el) => el.remove());
  ['toolbar_drop'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  document.querySelectorAll('[class*="mobile_overlay"]').forEach((el) => el.remove());
  ['mobile_overlay'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  [
    '.blurred_page', '.between_page_module',
    '.auto__doc_page_webpack_doc_page_blur_promo',
    '.doc_page_blur_promo', '.promo_div',
    '.absorb-container', '.ads_wrapper',
  ].forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => el.remove());
  });

  document.querySelectorAll('[class*="blur"]').forEach((el) => {
    el.style.filter = 'none';
    el.style.webkitFilter = 'none';
  });

  document.querySelectorAll('.text_layer, .page, .outer_page').forEach((el) => {
    el.style.overflow = 'visible';
  });

  const firstPage = document.querySelector('.outer_page') || document.querySelector('.page');
  let pageW = 816, pageH = 1056;
  if (firstPage) {
    const rect = firstPage.getBoundingClientRect();
    if (rect.width > 50 && rect.height > 50) {
      pageW = Math.round(rect.width);
      pageH = Math.round(rect.height);
    }
  }

  const style = document.createElement('style');
  style.textContent = `
    @page {
      size: ${pageW}px ${pageH}px;
      margin: 0;
    }
    @media print {
      body { margin: 0; padding: 0; }
      .outer_page, .page {
        page-break-after: always;
        page-break-inside: avoid;
        margin: 0 !important;
        padding: 0 !important;
        box-shadow: none !important;
        border: none !important;
      }
      .outer_page:last-child, .page:last-child {
        page-break-after: auto;
      }
      /* hide non-content elements when printing */
      header, footer, nav,
      [class*="toolbar"], [class*="overlay"],
      [class*="promo"], [class*="ads"],
      [class*="between_page"] {
        display: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function injectedGetPageDimensions() {
  const page = document.querySelector('.outer_page') || document.querySelector('.page');
  if (!page) return null;
  const rect = page.getBoundingClientRect();
  if (rect.width < 50 || rect.height < 50) return null;
  return { width: Math.round(rect.width), height: Math.round(rect.height) };
}
