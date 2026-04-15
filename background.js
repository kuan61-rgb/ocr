// background.js — MV3 service worker
// 職責: 註冊右鍵選單與快捷鍵、轉發 OCR 觸發訊息、擷取畫面、呼叫 Gemini API、寫入儲存空間。

const CONTEXT_MENU_ID = 'ocr-pick-word';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';

// ---------- 安裝時建立右鍵選單 ----------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'OCR 取詞',
    contexts: ['page', 'selection', 'image', 'link']
  });
});

// ---------- 觸發來源: 右鍵選單 ----------
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID && tab?.id != null) {
    startOcrInTab(tab.id);
  }
});

// ---------- 觸發來源: 快捷鍵 ----------
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'start-ocr') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) startOcrInTab(tab.id);
});

function startOcrInTab(tabId) {
  chrome.tabs.sendMessage(tabId, { type: 'START_OCR' }).catch((err) => {
    console.warn('[OCR] 無法傳送訊息給 content script:', err);
  });
}

// ---------- Offscreen document 管理 ----------
const OFFSCREEN_PATH = 'offscreen/offscreen.html';
let creatingOffscreen = null;

async function ensureOffscreen() {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [url]
  });
  if (existing.length > 0) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['WORKERS'],
    justification: '在擴充環境內執行 Tesseract.js OCR (使用 Web Worker + WASM)'
  });
  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

// 用 request-id 配對的非同步訊息模式,避免 sendResponse 通道在長任務時關閉
const ocrPending = new Map();

async function runOcrInOffscreen(dataUrl) {
  await ensureOffscreen();
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ocrPending.delete(id);
      reject(new Error('OCR 逾時 (60 秒)'));
    }, 60000);
    ocrPending.set(id, (res) => {
      clearTimeout(timeout);
      if (!res?.ok) return reject(new Error(res?.error || 'OCR 失敗'));
      resolve(res);
    });
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'OCR_RECOGNIZE', id, dataUrl })
      .catch((err) => {
        // 某些版本 sendMessage 沒有 receiver 時會 reject;改為等 OCR_RESULT 回來即可
        console.warn('[OCR] 送訊到 offscreen 失敗 (忽略):', err?.message);
      });
  });
}

// ---------- 訊息中轉 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 來自 offscreen 的訊息不在這裡處理
  if (msg?.target === 'offscreen') return;

  // OCR 結果回拋: offscreen 完成後用獨立訊息通知背景
  if (msg?.type === 'OCR_RESULT') {
    const cb = ocrPending.get(msg.id);
    if (cb) {
      ocrPending.delete(msg.id);
      cb(msg);
    }
    return; // 不需要回應
  }

  if (msg?.type === 'CAPTURE_VISIBLE_TAB') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, dataUrl });
      }
    });
    return true; // async
  }

  if (msg?.type === 'OCR_IMAGE') {
    runOcrInOffscreen(msg.dataUrl)
      .then((res) => sendResponse({ ok: true, text: res.text, raw: res.raw }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  if (msg?.type === 'TRANSLATE_WORD' || msg?.type === 'TRANSLATE_TEXT') {
    handleTranslateAndSave(msg.word ?? msg.text)
      .then((entry) => sendResponse({ ok: true, entry }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  if (msg?.type === 'TEST_GEMINI') {
    pingGemini(msg.apiKey, msg.model)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }
});

// 簡單 ping: 不使用結構化輸出,只是確認 Key + 模型 + 連線可用
async function pingGemini(apiKey, model) {
  const useModel = model || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
  console.log('[OCR] ping model:', useModel);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Hello' }] }]
    })
  });
  const fullText = await res.text().catch(() => '');
  console.log('[OCR] ping response status:', res.status);
  console.log('[OCR] ping response body:', fullText);
  if (!res.ok) {
    throw new Error(`${res.status}: ${fullText.slice(0, 800)}`);
  }
}

// ---------- Gemini 翻譯 + 儲存 ----------
function isSentence(text) {
  // 2 個或以上英文單字就視為句子
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  return tokens.length >= 2;
}

async function handleTranslateAndSave(rawText) {
  const text = (rawText || '').trim();
  if (!text) throw new Error('未辨識到文字');

  const { geminiApiKey, geminiModel } = await chrome.storage.local.get(['geminiApiKey', 'geminiModel']);
  if (!geminiApiKey) throw new Error('尚未設定 Gemini API Key,請至設定頁輸入');

  const { words = [] } = await chrome.storage.local.get('words');

  let entry;
  if (isSentence(text)) {
    const data = await callGeminiSentence(geminiApiKey, text, geminiModel);
    entry = {
      id: crypto.randomUUID(),
      type: 'sentence',
      word: data.original,
      translation: data.translation,
      createdAt: Date.now(),
      pinned: false
    };
    words.push(entry);
  } else {
    const data = await callGemini(geminiApiKey, text, geminiModel);
    const lower = data.word.toLowerCase();
    const existingIdx = words.findIndex((w) => (w.type ?? 'word') === 'word' && w.word.toLowerCase() === lower);
    if (existingIdx >= 0) {
      entry = { ...words[existingIdx], ...data, type: 'word', createdAt: Date.now() };
      words[existingIdx] = entry;
    } else {
      entry = {
        id: crypto.randomUUID(),
        type: 'word',
        ...data,
        createdAt: Date.now(),
        pinned: false
      };
      words.push(entry);
    }
  }
  await chrome.storage.local.set({ words });
  return entry;
}

async function callGeminiSentence(apiKey, text, model) {
  const useModel = model || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const prompt = `You are a professional English-to-Traditional-Chinese translator. The following text was extracted via OCR and may contain minor recognition errors — silently correct obvious typos. Output ONLY a single JSON object (no markdown, no code fence, no extra text) with these exact fields:
{
  "original": "the cleaned English text",
  "translation": "自然流暢的繁體中文翻譯"
}

Text: ${text}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 }
    })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Gemini API 錯誤 ${res.status}: ${txt.slice(0, 300)}`);
  }

  const json = await res.json();
  const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Gemini 回傳格式異常');
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Gemini 回傳的 JSON 無法解析');
    return JSON.parse(match[0]);
  }
}

async function callGemini(apiKey, word, model) {
  const useModel = model || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const prompt = `You are an English dictionary assistant. For the given English word, output ONLY a single JSON object (no markdown, no code fence, no extra text) with these exact fields:
{
  "word": "the english word in lowercase, fix common OCR mistakes",
  "translation": "繁體中文翻譯 (簡短, 1~2 個常見義項)",
  "partOfSpeech": "詞性縮寫 e.g. n. / v. / adj. / adv. / prep.",
  "exampleEn": "a natural English example sentence",
  "exampleZh": "上述例句的繁體中文翻譯"
}

Word: ${word}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3 }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Gemini API 錯誤 ${res.status}: ${txt.slice(0, 300)}`);
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini 回傳格式異常');

  // 嘗試從回傳文字中抽出 JSON (容忍 ```json fence 或前後多餘文字)
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // fallback: 抓第一個 { ... } 區塊
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Gemini 回傳的 JSON 無法解析');
    parsed = JSON.parse(match[0]);
  }
  return parsed;
}
