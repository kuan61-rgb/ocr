# OCR 英文單字學習工具 (Chrome Extension)

用滑鼠在網頁上框選英文單字 → Tesseract.js 本地 OCR 辨識 → Google Gemini 翻譯並產生例句 → 自動建立卡片式單字列表。

---

## 安裝前必須準備的資產

擴充程式碼已寫好,但你還需要手動放入兩類檔案:

### 1) Tesseract.js 函式庫與英文語言檔 → `lib/`

從 [Tesseract.js GitHub Releases](https://github.com/naptha/tesseract.js/releases) 或 [unpkg](https://unpkg.com/tesseract.js@5/) 下載下列檔案,放到 `lib/`:

```
lib/
├── tesseract.min.js          # 主函式庫 (對應 unpkg: tesseract.js@5/dist/tesseract.min.js)
├── worker.min.js             # Web Worker 腳本
├── tesseract-core.wasm.js    # WASM 載入器
├── tesseract-core-simd.wasm.js (可選)
└── eng.traineddata.gz        # 英文語言檔
```

語言檔可從 https://github.com/naptha/tessdata/raw/gh-pages/4.0.0/eng.traineddata.gz 下載。

> 之所以要本地化,是因為 MV3 的 Service Worker 與 CSP 政策不允許從遠端 CDN 動態載入腳本。

### 2) 圖示檔 → `icons/`

放入三張 PNG 圖示 (可先用任意佔位圖):

```
icons/
├── icon16.png
├── icon48.png
└── icon128.png
```

### 3) Gemini API Key

到 [Google AI Studio](https://aistudio.google.com/app/apikey) 免費申請,稍後在擴充的設定頁輸入。

---

## 安裝步驟

1. 開啟 Chrome,進入 `chrome://extensions/`
2. 右上角開啟「**開發人員模式**」
3. 點「**載入未封裝項目**」,選擇本資料夾
4. 載入成功後點擴充圖示 → **設定** → 貼上 Gemini API Key → 儲存 → 測試連線

---

## 使用方式

- **快捷鍵:** `Ctrl + Shift + O` (Mac: `Cmd + Shift + O`),可在 `chrome://extensions/shortcuts` 自訂
- **右鍵選單:** 在任意網頁右鍵 → 「OCR 取詞」
- 啟動後拖曳框選英文單字 → 翻譯氣泡會出現,單字自動加入列表
- 按擴充圖示 → 「📚 開啟單字列表」可瀏覽全部卡片
- 卡片右上角的 📌 可置頂、🗑️ 可刪除

---

## 專案結構

```
ocr/
├── manifest.json
├── background.js              # service worker
├── content/
│   ├── overlay.js             # 框選 + OCR + 翻譯氣泡
│   └── overlay.css
├── lib/                       # ← 需手動放入 Tesseract.js 檔案
├── popup/                     # 工具列彈出面板
├── options/                   # 設定頁 (Gemini API Key)
├── wordlist/                  # 卡片式單字列表
└── icons/                     # ← 需手動放入圖示
```

---

## 疑難排解

- **「Tesseract.js 未載入」** → 檢查 `lib/tesseract.min.js` 是否存在,且 `manifest.json` 的 `content_scripts` 有列出。
- **OCR 辨識空白** → 框選範圍太小或文字太模糊,試著框得寬一點 / 對準清楚的文字。
- **Gemini API 錯誤** → 到設定頁按「測試連線」確認 Key 有效;檢查網路與 API 配額。
- **快捷鍵沒反應** → `chrome://extensions/shortcuts` 確認沒有與其他擴充衝突。
