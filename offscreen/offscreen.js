// offscreen.js — 在擴充自己的環境裡執行 Tesseract.js,避開網頁 CSP 限制。

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('eng', 1, {
      workerPath: chrome.runtime.getURL('lib/worker.min.js'),
      corePath: chrome.runtime.getURL('lib/'),
      langPath: chrome.runtime.getURL('lib/'),
      // 在 offscreen document 內,直接用 chrome-extension URL
      workerBlobURL: false
    });
  }
  return workerPromise;
}

console.log('[offscreen] loaded');

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'offscreen') return;

  if (msg.type === 'OCR_RECOGNIZE') {
    console.log('[offscreen] OCR_RECOGNIZE id=', msg.id);
    (async () => {
      try {
        const worker = await getWorker();
        const { data } = await worker.recognize(msg.dataUrl);
        const raw = (data?.text || '').trim();
        const match = raw.match(/[A-Za-z][A-Za-z'-]*/);
        chrome.runtime.sendMessage({
          type: 'OCR_RESULT',
          id: msg.id,
          ok: true,
          text: match ? match[0] : '',
          raw
        });
      } catch (err) {
        console.error('[offscreen] OCR error:', err);
        chrome.runtime.sendMessage({
          type: 'OCR_RESULT',
          id: msg.id,
          ok: false,
          error: err?.message || String(err)
        });
      }
    })();
    // 不返回 true: 我們不用 sendResponse,改用獨立訊息回拋
  }
});
