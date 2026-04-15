const input = document.getElementById('api-key');
const modelSelect = document.getElementById('model');
const saveBtn = document.getElementById('save');
const testBtn = document.getElementById('test');
const statusEl = document.getElementById('status');

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

// 載入既有設定
chrome.storage.local.get(['geminiApiKey', 'geminiModel']).then(({ geminiApiKey, geminiModel }) => {
  if (geminiApiKey) input.value = geminiApiKey;
  modelSelect.value = geminiModel || DEFAULT_MODEL;
});

function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
}

saveBtn.addEventListener('click', async () => {
  const key = input.value.trim();
  if (!key) {
    setStatus('請輸入 API Key', 'error');
    return;
  }
  await chrome.storage.local.set({
    geminiApiKey: key,
    geminiModel: modelSelect.value || DEFAULT_MODEL
  });
  setStatus('✓ 已儲存', 'success');
});

testBtn.addEventListener('click', () => {
  const key = input.value.trim();
  if (!key) {
    setStatus('請先輸入 API Key', 'error');
    return;
  }
  setStatus('測試中…');
  chrome.runtime.sendMessage(
    { type: 'TEST_GEMINI', apiKey: key, model: modelSelect.value || DEFAULT_MODEL },
    (res) => {
      if (chrome.runtime.lastError) {
        setStatus(`錯誤: ${chrome.runtime.lastError.message}`, 'error');
        return;
      }
      if (res?.ok) setStatus('✓ 連線成功!', 'success');
      else setStatus(`✗ 失敗: ${res?.error || '未知錯誤'}`, 'error');
    }
  );
});
