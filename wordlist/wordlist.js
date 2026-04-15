const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const countEl = document.getElementById('count');

async function loadAndRender() {
  const { words = [] } = await chrome.storage.local.get('words');
  render(words);
}

function sortWords(words) {
  return [...words].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

function render(words) {
  countEl.textContent = String(words.length);
  grid.innerHTML = '';

  if (!words.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const sorted = sortWords(words);
  for (const w of sorted) {
    grid.appendChild(buildCard(w));
  }
}

function buildCard(w) {
  const isSentence = w.type === 'sentence';
  const card = document.createElement('article');
  card.className = 'card' + (w.pinned ? ' pinned' : '') + (isSentence ? ' sentence' : '');

  const header = document.createElement('div');
  header.className = 'card-header';

  const word = document.createElement('span');
  word.className = isSentence ? 'sentence-text' : 'word';
  word.textContent = w.word;
  header.appendChild(word);

  if (!isSentence && w.partOfSpeech) {
    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = w.partOfSpeech;
    header.appendChild(pos);
  }
  if (isSentence) {
    const tag = document.createElement('span');
    tag.className = 'pos';
    tag.textContent = '句';
    header.appendChild(tag);
  }
  card.appendChild(header);

  if (w.translation) {
    const tr = document.createElement('div');
    tr.className = 'translation';
    tr.textContent = w.translation;
    card.appendChild(tr);
  }

  if (w.exampleEn || w.exampleZh) {
    const ex = document.createElement('div');
    ex.className = 'example';
    if (w.exampleEn) {
      const en = document.createElement('div');
      en.className = 'en';
      en.textContent = w.exampleEn;
      ex.appendChild(en);
    }
    if (w.exampleZh) {
      const zh = document.createElement('div');
      zh.className = 'zh';
      zh.textContent = w.exampleZh;
      ex.appendChild(zh);
    }
    card.appendChild(ex);
  }

  // 動作按鈕
  const actions = document.createElement('div');
  actions.className = 'actions';

  const pinBtn = document.createElement('button');
  pinBtn.className = 'icon-btn' + (w.pinned ? ' pinned' : '');
  pinBtn.title = w.pinned ? '取消置頂' : '置頂';
  pinBtn.textContent = '📌';
  pinBtn.addEventListener('click', () => togglePin(w.id));
  actions.appendChild(pinBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn';
  delBtn.title = '刪除';
  delBtn.textContent = '🗑️';
  delBtn.addEventListener('click', () => deleteWord(w.id, isSentence ? (w.word.slice(0, 30) + (w.word.length > 30 ? '…' : '')) : w.word));
  actions.appendChild(delBtn);

  card.appendChild(actions);
  return card;
}

async function togglePin(id) {
  const { words = [] } = await chrome.storage.local.get('words');
  const idx = words.findIndex((w) => w.id === id);
  if (idx < 0) return;
  words[idx] = { ...words[idx], pinned: !words[idx].pinned };
  await chrome.storage.local.set({ words });
}

async function deleteWord(id, word) {
  if (!confirm(`確定要刪除「${word}」嗎?`)) return;
  const { words = [] } = await chrome.storage.local.get('words');
  const next = words.filter((w) => w.id !== id);
  await chrome.storage.local.set({ words: next });
}

// 即時同步: storage 變動時重新渲染
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.words) {
    render(changes.words.newValue || []);
  }
});

loadAndRender();
