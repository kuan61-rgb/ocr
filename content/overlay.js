// content/overlay.js
// 監聽來自 background 的 START_OCR 訊息,顯示框選遮罩,擷取畫面,呼叫 Tesseract.js 辨識,
// 再請 background 呼叫 Gemini 翻譯,最後在頁面上顯示翻譯氣泡。

(() => {
  if (window.__ocrContentLoaded) return;
  window.__ocrContentLoaded = true;

  let active = false;
  let overlayEl = null;
  let selectionEl = null;
  let hintEl = null;
  let startX = 0;
  let startY = 0;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'START_OCR') beginSelection();
  });

  // ---------- 框選 UI ----------
  function beginSelection() {
    if (active) return;
    active = true;

    overlayEl = document.createElement('div');
    overlayEl.className = 'ocr-overlay ocr-root';

    hintEl = document.createElement('div');
    hintEl.className = 'ocr-hint';
    hintEl.textContent = '拖曳框選英文單字或句子 — 按 Esc 取消';

    document.documentElement.appendChild(overlayEl);
    document.documentElement.appendChild(hintEl);

    overlayEl.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function endSelection() {
    active = false;
    overlayEl?.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseup', onMouseUp, true);
    document.removeEventListener('keydown', onKeyDown, true);
    overlayEl?.remove();
    selectionEl?.remove();
    hintEl?.remove();
    overlayEl = null;
    selectionEl = null;
    hintEl = null;
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      endSelection();
    }
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    selectionEl = document.createElement('div');
    selectionEl.className = 'ocr-selection ocr-root';
    selectionEl.style.left = `${startX}px`;
    selectionEl.style.top = `${startY}px`;
    selectionEl.style.width = '0px';
    selectionEl.style.height = '0px';
    document.documentElement.appendChild(selectionEl);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
  }

  function onMouseMove(e) {
    if (!selectionEl) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    selectionEl.style.left = `${x}px`;
    selectionEl.style.top = `${y}px`;
    selectionEl.style.width = `${w}px`;
    selectionEl.style.height = `${h}px`;
  }

  async function onMouseUp(e) {
    if (!selectionEl) return;
    const rect = {
      x: Math.min(e.clientX, startX),
      y: Math.min(e.clientY, startY),
      w: Math.abs(e.clientX - startX),
      h: Math.abs(e.clientY - startY)
    };

    // 清掉框選 UI,但保留位置以顯示氣泡
    const bubbleAnchor = { x: rect.x + rect.w, y: rect.y + rect.h };
    endSelection();

    if (rect.w < 4 || rect.h < 4) return; // 太小就忽略

    const bubble = showBubble(bubbleAnchor.x, bubbleAnchor.y, '辨識中…', { loading: true });

    try {
      const dataUrl = await captureVisibleTab();
      const croppedDataUrl = await cropImage(dataUrl, rect);
      const text = await runOcr(croppedDataUrl);
      if (!text) {
        updateBubble(bubble, { error: '未辨識到任何文字' });
        return;
      }
      const preview = text.length > 40 ? text.slice(0, 40) + '…' : text;
      updateBubble(bubble, { loadingText: `辨識結果: ${preview} — 翻譯中…` });
      const entry = await translateText(text);
      updateBubble(bubble, { entry });
    } catch (err) {
      console.error('[OCR] 失敗:', err);
      updateBubble(bubble, { error: err?.message || String(err) });
    }
  }

  // ---------- 與 background 溝通 ----------
  function captureVisibleTab() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res?.ok) return reject(new Error(res?.error || '截圖失敗'));
        resolve(res.dataUrl);
      });
    });
  }

  function translateText(text) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'TRANSLATE_TEXT', text }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res?.ok) return reject(new Error(res?.error || '翻譯失敗'));
        resolve(res.entry);
      });
    });
  }

  // ---------- 截圖裁切 ----------
  function cropImage(dataUrl, rect) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const dpr = window.devicePixelRatio || 1;
        const sx = rect.x * dpr;
        const sy = rect.y * dpr;
        const sw = rect.w * dpr;
        const sh = rect.h * dpr;

        const canvas = document.createElement('canvas');
        const scale = 2; // 放大提升辨識率
        canvas.width = sw * scale;
        canvas.height = sh * scale;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        // 回傳 dataURL,方便透過訊息傳給 background → offscreen
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('截圖載入失敗'));
      img.src = dataUrl;
    });
  }

  // ---------- OCR (透過 background → offscreen) ----------
  function runOcr(dataUrl) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'OCR_IMAGE', dataUrl }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res?.ok) return reject(new Error(res?.error || 'OCR 失敗'));
        resolve(res.text || '');
      });
    });
  }

  // ---------- 翻譯氣泡 ----------
  function showBubble(x, y, text, opts = {}) {
    const bubble = document.createElement('div');
    bubble.className = 'ocr-bubble ocr-root';
    if (opts.loading) bubble.classList.add('ocr-loading');
    bubble.style.left = `${Math.min(x + 8, window.innerWidth - 380)}px`;
    bubble.style.top = `${Math.min(y + 8, window.innerHeight - 200)}px`;
    bubble.textContent = text;

    const close = document.createElement('button');
    close.className = 'ocr-bubble-close';
    close.textContent = '×';
    close.addEventListener('click', () => bubble.remove());
    bubble.appendChild(close);

    document.documentElement.appendChild(bubble);
    return bubble;
  }

  function updateBubble(bubble, { entry, error, loadingText } = {}) {
    bubble.classList.remove('ocr-loading');
    bubble.textContent = '';

    const close = document.createElement('button');
    close.className = 'ocr-bubble-close';
    close.textContent = '×';
    close.addEventListener('click', () => bubble.remove());
    bubble.appendChild(close);

    if (loadingText) {
      bubble.classList.add('ocr-loading');
      bubble.appendChild(document.createTextNode(loadingText));
      return;
    }
    if (error) {
      const e = document.createElement('div');
      e.className = 'ocr-bubble-error';
      e.textContent = `錯誤: ${error}`;
      bubble.appendChild(e);
      return;
    }
    if (entry) {
      const isSentence = entry.type === 'sentence';

      const w = document.createElement('div');
      w.className = isSentence ? 'ocr-bubble-sentence' : 'ocr-bubble-word';
      w.textContent = entry.word;
      bubble.appendChild(w);

      if (!isSentence && entry.partOfSpeech) {
        const p = document.createElement('div');
        p.className = 'ocr-bubble-pos';
        p.textContent = entry.partOfSpeech;
        bubble.appendChild(p);
      }

      const t = document.createElement('div');
      t.className = 'ocr-bubble-trans';
      t.textContent = entry.translation || '';
      bubble.appendChild(t);

      const s = document.createElement('div');
      s.className = 'ocr-bubble-status';
      s.textContent = isSentence ? '✓ 已加入列表（句子）' : '✓ 已加入單字列表';
      bubble.appendChild(s);

      const hideDelay = isSentence ? 12000 : 6000;
      setTimeout(() => bubble.remove(), hideDelay);
    }
  }
})();
