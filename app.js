// ==========================================
// 1. УТИЛИТЫ И ХРАНИЛИЩЕ INDEXEDDB
// ==========================================
let lastLocalWriteTime = 0;
let lastKnownCloudTimestamp = Number(localStorage.getItem('grass_last_cloud_ts') || 0);
let isFilePickerOpen = false;

const IDB_NAME = 'AlenaGrassDB';
const IDB_STORE = 'app_store';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function openIDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject('No IndexedDB');
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, val) {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('IDB write fallback:', e);
  }
}

async function idbGet(key) {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
}

function safeSetLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn('LocalStorage quota exceeded, using IndexedDB & Cloud Sync');
  }
}

// ==========================================
// 2. ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК
// ==========================================
const tabBtnCalc = document.getElementById('tabBtnCalc');
const tabBtnProjects = document.getElementById('tabBtnProjects');
const tabBtnDiary = document.getElementById('tabBtnDiary');
const tabContentCalc = document.getElementById('tabContentCalc');
const tabContentProjects = document.getElementById('tabContentProjects');
const tabContentDiary = document.getElementById('tabContentDiary');

function activateTab(btn, content) {
  [tabBtnCalc, tabBtnProjects, tabBtnDiary].forEach(b => b.classList.remove('active'));
  [tabContentCalc, tabContentProjects, tabContentDiary].forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  content.classList.add('active');
}

tabBtnCalc.addEventListener('click', () => activateTab(tabBtnCalc, tabContentCalc));
tabBtnProjects.addEventListener('click', () => activateTab(tabBtnProjects, tabContentProjects));
tabBtnDiary.addEventListener('click', () => activateTab(tabBtnDiary, tabContentDiary));

// ==========================================
// 3. КАЛЬКУЛЯТОР И WEB SHARE API
// ==========================================
const heightInput = document.getElementById('heightInput');
const bustInput = document.getElementById('bustInput');
const hipsInput = document.getElementById('hipsInput');
const searchInput = document.getElementById('searchInput');

const kHeightVal = document.getElementById('kHeightVal');
const kSizeVal = document.getElementById('kSizeVal');
const fullnessGroupVal = document.getElementById('fullnessGroupVal');
const cardsContainer = document.getElementById('measureCardsContainer');
const tableBody = document.getElementById('tableBody');
const toast = document.getElementById('toast');

const viewCardsBtn = document.getElementById('viewCardsBtn');
const viewTableBtn = document.getElementById('viewTableBtn');
const measureCardsContainer = document.getElementById('measureCardsContainer');
const measureTableContainer = document.getElementById('measureTableContainer');

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}

function calculate(skipSave = false) {
  const h = parseFloat(heightInput.value) || 163;
  const og = parseFloat(bustInput.value) || 84;
  const ob = parseFloat(hipsInput.value) || 94;

  const kH = (h - 164) / 6;
  const kB = (og - 88) / 4;
  const fullnessExact = ((ob - og) - (-2)) / 4;
  
  let fullnessGroupIndex = Math.round(fullnessExact);
  if (fullnessGroupIndex < 0) fullnessGroupIndex = 0;
  if (fullnessGroupIndex > 5) fullnessGroupIndex = 5;

  kHeightVal.textContent = (kH >= 0 ? '+' : '') + kH.toFixed(2);
  kSizeVal.textContent = (kB >= 0 ? '+' : '') + kB.toFixed(2);
  fullnessGroupVal.textContent = `${fullnessGroupIndex}-я группа (${fullnessExact.toFixed(1)})`;

  renderCalculatorViews(kH, kB, og, fullnessGroupIndex);
  if (!skipSave) saveCalcState();
}

function renderCalculatorViews(kH, kB, og, groupIndex) {
  const filter = searchInput.value.toLowerCase().trim();
  cardsContainer.innerHTML = '';
  tableBody.innerHTML = '';

  window.measurementsData.forEach(item => {
    if (filter && !item.code.toLowerCase().includes(filter) && !item.name.toLowerCase().includes(filter)) {
      return;
    }

    const baseVal = item.bases[groupIndex];
    let shiftSize = 0;
    let deltaSizeLabel = '';

    if (item.dynamicB) {
      shiftSize = item.calcShiftB(og, kB, groupIndex);
      const step = item.stepB(og, groupIndex);
      deltaSizeLabel = (step > 0 ? '+' : '') + step.toFixed(1);
    } else {
      shiftSize = item.dB * kB;
      deltaSizeLabel = (item.dB > 0 ? '+' : '') + item.dB.toFixed(1);
    }

    const shiftHeight = item.dH * kH;
    const res = baseVal + shiftHeight + shiftSize;
    const resStr = res.toFixed(2);

    let fullGirthStr = '';
    if (item.code.startsWith('С')) {
      const fullCode = 'О' + item.code.slice(1);
      const fullVal = (res * 2).toFixed(2);
      fullGirthStr = `<div style="font-size:0.7rem; color:var(--accent); margin-top:2px;">Полный (${fullCode}): <strong>${fullVal} см</strong></div>`;
    }

    const row = document.createElement('div');
    row.className = 'measure-row';
    row.innerHTML = `
      <div class="measure-main">
        <div class="measure-code-badge">${item.code}</div>
        <div class="measure-info">
          <div class="measure-name">${item.name}</div>
          <div class="measure-details">
            <span>База: ${baseVal.toFixed(1)}</span>
            <span>ΔР: ${item.dH > 0 ? '+' : ''}${item.dH.toFixed(1)}</span>
            <span>ΔОГ: ${deltaSizeLabel}</span>
          </div>
          ${fullGirthStr}
        </div>
      </div>
      <div class="measure-res-box">
        <span class="measure-res-val">${resStr}</span><span class="measure-res-unit">см</span>
      </div>
    `;
    cardsContainer.appendChild(row);

    let displayName = item.name;
    if (item.code.startsWith('С')) {
      displayName += ` (Полный О${item.code.slice(1)}: ${(res * 2).toFixed(2)} см)`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong style="color:var(--accent);">${item.code}</strong></td>
      <td>${displayName}</td>
      <td style="text-align: right;">${baseVal.toFixed(1)}</td>
      <td style="text-align: right;">${item.dH > 0 ? '+' : ''}${item.dH.toFixed(1)}</td>
      <td style="text-align: right;">${deltaSizeLabel}</td>
      <td style="text-align: right; font-weight: 700; color: #fff;">${resStr}</td>
    `;
    tableBody.appendChild(tr);
  });
}

viewCardsBtn.addEventListener('click', () => {
  viewCardsBtn.classList.add('active');
  viewTableBtn.classList.remove('active');
  measureCardsContainer.style.display = 'flex';
  measureTableContainer.style.display = 'none';
});

viewTableBtn.addEventListener('click', () => {
  viewTableBtn.classList.add('active');
  viewCardsBtn.classList.remove('active');
  measureCardsContainer.style.display = 'none';
  measureTableContainer.style.display = 'block';
});

function saveCalcState() {
  safeSetLocalStorage('grass_calc_h_v3_1', heightInput.value);
  safeSetLocalStorage('grass_calc_og_v3_1', bustInput.value);
  safeSetLocalStorage('grass_calc_ob_v3_1', hipsInput.value);
  markDirtyAndPush('calc', false);
}

function loadCalcState() {
  if (localStorage.getItem('grass_calc_h_v3_1')) heightInput.value = localStorage.getItem('grass_calc_h_v3_1');
  if (localStorage.getItem('grass_calc_og_v3_1')) bustInput.value = localStorage.getItem('grass_calc_og_v3_1');
  if (localStorage.getItem('grass_calc_ob_v3_1')) hipsInput.value = localStorage.getItem('grass_calc_ob_v3_1');
}

[heightInput, bustInput, hipsInput].forEach(inp => {
  inp.addEventListener('input', () => {
    lastLocalWriteTime = Date.now();
    calculate(false);
  });
});

searchInput.addEventListener('input', () => calculate(true));

document.getElementById('resetBtn').addEventListener('click', () => {
  lastLocalWriteTime = Date.now();
  heightInput.value = 163;
  bustInput.value = 84;
  hipsInput.value = 94;
  searchInput.value = '';
  calculate(false);
  showToast('Сброшено на 163-84-94');
});

function getCalculationTextString() {
  const snap = getCalculationSnapshot();
  let text = `📐 ALËNA GRASS РАСЧЕТ\nПараметры: Рост ${snap.h} см, ОГ ${snap.og} см, ОБ ${snap.ob} см (${snap.fullnessGroup}-я гр.)\n\n`;
  snap.results.forEach(r => {
    const fullExtra = r.code.startsWith('С') ? ` [Полный О${r.code.slice(1)}: ${(parseFloat(r.val) * 2).toFixed(2)} см]` : '';
    text += `${r.code} (${r.name}): ${r.val} см${fullExtra}\n`;
  });
  return text;
}

document.getElementById('copyBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(getCalculationTextString()).then(() => {
    showToast('Все 23 мерки скопированы!');
  }).catch(() => {
    showToast('Ошибка копирования');
  });
});

const shareCalcBtn = document.getElementById('shareCalcBtn');
if (shareCalcBtn) {
  shareCalcBtn.addEventListener('click', async () => {
    const textData = getCalculationTextString();
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'ALËNA GRASS — Расчет мерок',
          text: textData
        });
        return;
      } catch (err) {
        if (err.name !== 'AbortError') console.warn('Share error:', err);
      }
    }
    navigator.clipboard.writeText(textData).then(() => {
      showToast('Скопировано в буфер');
    });
  });
}

// ==========================================
// 3.1 ПЕЧАТЬ И PDF (@media print)
// ==========================================
const printArea = document.getElementById('printArea');

function triggerNativePrint(htmlContent) {
  printArea.innerHTML = htmlContent;
  setTimeout(() => window.print(), 150);
}

function printCalculationSheet(customTitle, snapData) {
  const snap = snapData || getCalculationSnapshot();
  const title = escapeHtml(customTitle || `Карта размерных признаков (${snap.h}-${snap.og}-${snap.ob})`);
  const dateStr = new Date().toLocaleDateString('ru-RU');

  const rowsHtml = snap.results.map(item => {
    const valNum = parseFloat(item.val);
    const fullStr = item.code.startsWith('С') ? `<strong>${(valNum * 2).toFixed(2)} см</strong> (О${item.code.slice(1)})` : '—';
    return `
      <tr>
        <td><strong>${item.code}</strong></td>
        <td>${item.name}</td>
        <td style="text-align:right; font-weight:700;">${item.val} см</td>
        <td style="text-align:right; color:#0369a1;">${fullStr}</td>
      </tr>
    `;
  }).join('');

  const html = `
    <div class="print-top-bar">
      <div>
        <h1>📐 ALËNA GRASS — ${title}</h1>
        <div class="print-sub">Индивидуальный расчет размерных признаков по методике Grasser</div>
      </div>
      <div style="font-size:10pt; color:#475569;">Дата: ${dateStr}</div>
    </div>
    <div class="print-params-grid">
      <div><strong>Рост (Р):</strong> ${snap.h} см</div>
      <div><strong>Обхват груди (ОГ):</strong> ${snap.og} см</div>
      <div><strong>Обхват бедер (ОБ):</strong> ${snap.ob} см</div>
      <div><strong>Полнотная группа:</strong> ${snap.fullnessGroup}-я группа</div>
    </div>
    <table class="print-table">
      <thead>
        <tr>
          <th style="width:65px;">Код</th>
          <th>Наименование размерного признака</th>
          <th style="width:110px; text-align:right;">Рассчитано</th>
          <th style="width:140px; text-align:right;">Полный обхват (×2)</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  triggerNativePrint(html);
}

document.getElementById('printCalcBtn').addEventListener('click', () => {
  printCalculationSheet(null, getCalculationSnapshot());
});

function printProjectPDF(pIdx) {
  const proj = projectsState[pIdx];
  if (!proj) return;
  const statusMap = { active: '🔵 В работе', fitting: '🟡 На примерке', done: '🟢 Готово', archive: '⚪ Архив' };
  const attStatusMap = { work: '🟡 Макет / В работе', defect: '🔴 Дефект посадки', approved: '🟢 В раскрой (Удачно)' };

  const attemptsHtml = (proj.attempts || []).map((att, aIdx) => {
    const stLabel = attStatusMap[att.status || 'work'] || '🟡 В работе';
    const imgsHtml = (att.photos || []).map(src => `<img src="${src}">`).join('');
    return `
      <div class="print-attempt-block">
        <div class="print-attempt-header">
          <span>Попытка моделирования №${aIdx + 1}</span>
          <span>${stLabel}</span>
        </div>
        <div class="print-attempt-notes">${att.text ? escapeHtml(att.text) : '<em>Заметки отсутствуют</em>'}</div>
        ${imgsHtml ? `<div class="print-photos-row">${imgsHtml}</div>` : ''}
      </div>
    `;
  }).join('');

  const html = `
    <div class="print-top-bar">
      <div>
        <h1>${proj.emoji || '👗'} Проект: ${escapeHtml(proj.name)}</h1>
        <div class="print-sub">Паспорт моделирования и история примерок • ALËNA GRASS</div>
      </div>
      <div style="font-size:11pt; font-weight:700;">${statusMap[proj.status || 'active']}</div>
    </div>
    ${attemptsHtml || '<p>Нет добавленных попыток моделирования.</p>'}
  `;
  triggerNativePrint(html);
}

// ==========================================
// 3.2 СОХРАНЕННЫЕ РАСЧЕТЫ
// ==========================================
const SAVED_CALCS_STORAGE_KEY = 'alena_grass_saved_calcs_v1';
let savedCalcsState = [];

const savedCalcsList = document.getElementById('savedCalcsList');
const savedCountBadge = document.getElementById('savedCountBadge');
const saveCalcModal = document.getElementById('saveCalcModal');
const openSaveModalBtn = document.getElementById('openSaveModalBtn');
const closeSaveModalBtn = document.getElementById('closeSaveModalBtn');
const cancelSaveCalcBtn = document.getElementById('cancelSaveCalcBtn');
const confirmSaveCalcBtn = document.getElementById('confirmSaveCalcBtn');
const calcNameInput = document.getElementById('calcNameInput');
const savePreviewParams = document.getElementById('savePreviewParams');

function loadSavedCalcsState() {
  try {
    const data = localStorage.getItem(SAVED_CALCS_STORAGE_KEY);
    if (data) savedCalcsState = JSON.parse(data);
  } catch (e) { console.error(e); }
}

function saveSavedCalcsState() {
  lastLocalWriteTime = Date.now();
  safeSetLocalStorage(SAVED_CALCS_STORAGE_KEY, JSON.stringify(savedCalcsState));
  markDirtyAndPush('savedCalcsState', true);
}

function getCalculationSnapshot() {
  const h = parseFloat(heightInput.value) || 163;
  const og = parseFloat(bustInput.value) || 84;
  const ob = parseFloat(hipsInput.value) || 94;

  const kH = (h - 164) / 6;
  const kB = (og - 88) / 4;
  const fullnessExact = ((ob - og) - (-2)) / 4;
  let groupIndex = Math.round(fullnessExact);
  if (groupIndex < 0) groupIndex = 0;
  if (groupIndex > 5) groupIndex = 5;

  const results = window.measurementsData.map(item => {
    const baseVal = item.bases[groupIndex];
    const shiftSize = item.dynamicB ? item.calcShiftB(og, kB, groupIndex) : item.dB * kB;
    const res = (baseVal + item.dH * kH + shiftSize).toFixed(2);
    return { code: item.code, name: item.name, val: res };
  });

  return { h, og, ob, kH: (kH >= 0 ? '+' : '') + kH.toFixed(2), kB: (kB >= 0 ? '+' : '') + kB.toFixed(2), fullnessGroup: groupIndex, fullnessExact: fullnessExact.toFixed(1), results };
}

function renderSavedCalcs() {
  savedCalcsList.innerHTML = '';
  savedCountBadge.textContent = savedCalcsState.length;

  if (savedCalcsState.length === 0) {
    savedCalcsList.innerHTML = `
      <div style="text-align:center; padding:16px 10px; color:var(--text-muted); font-size:0.8rem; background:var(--row-alt); border-radius:8px; border:1px dashed var(--card-border);">
        У вас пока нет сохраненных расчетов.
      </div>
    `;
    return;
  }

  savedCalcsState.forEach((item, index) => {
    const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--row-alt); border:1px solid rgba(255,255,255,0.05); border-radius:10px; padding:12px; display:flex; flex-direction:column; gap:8px;';

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div>
          <div style="font-weight:700; font-size:0.92rem; color:#fff; word-break:break-word;">${escapeHtml(item.name)}</div>
          <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">🕒 ${dateStr}</div>
        </div>
        <div style="font-size:0.75rem; background:rgba(56,189,248,0.12); color:var(--accent); padding:2px 8px; border-radius:6px; font-weight:700; white-space:nowrap;">
          ${item.fullnessGroup}-я гр.
        </div>
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; font-size:0.75rem; color:#cbd5e1;">
        <span style="background:rgba(0,0,0,0.3); padding:3px 8px; border-radius:5px;">Рост: <strong>${item.h}</strong> см</span>
        <span style="background:rgba(0,0,0,0.3); padding:3px 8px; border-radius:5px;">ОГ: <strong>${item.og}</strong> см</span>
        <span style="background:rgba(0,0,0,0.3); padding:3px 8px; border-radius:5px;">ОБ: <strong>${item.ob}</strong> см</span>
      </div>
      <div style="display:flex; gap:6px; margin-top:4px; justify-content:flex-end; flex-wrap:wrap;">
        <button type="button" class="btn btn-primary" data-saved-action="load" data-index="${index}" style="padding:5px 10px; font-size:0.74rem; flex:0 0 auto;">⚡ Загрузить</button>
        <button type="button" class="btn" data-saved-action="print" data-index="${index}" style="padding:5px 10px; font-size:0.74rem; flex:0 0 auto;" title="Печать / PDF">🖨 PDF</button>
        <button type="button" class="btn" data-saved-action="copy" data-index="${index}" style="padding:5px 10px; font-size:0.74rem; flex:0 0 auto;">📋 Копия</button>
        <button type="button" class="btn" data-saved-action="delete" data-index="${index}" style="padding:5px 8px; font-size:0.74rem; color:#f87171; flex:0 0 auto;" title="Удалить">🗑</button>
      </div>
    `;
    savedCalcsList.appendChild(card);
  });
}

savedCalcsList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-saved-action]');
  if (!btn) return;
  const action = btn.dataset.savedAction;
  const idx = parseInt(btn.dataset.index, 10);
  const item = savedCalcsState[idx];
  if (!item) return;

  if (action === 'load') {
    lastLocalWriteTime = Date.now();
    heightInput.value = item.h;
    bustInput.value = item.og;
    hipsInput.value = item.ob;
    calculate(false);
    showToast(`Расчет «${item.name}» загружен!`);
    heightInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (action === 'print') {
    printCalculationSheet(item.name, item);
  } else if (action === 'copy') {
    let text = `ALËNA GRASS РАСЧЕТ: ${item.name}\nПараметры: Рост ${item.h} см, ОГ ${item.og} см, ОБ ${item.ob} см (${item.fullnessGroup}-я гр.)\n\n`;
    if (item.results) item.results.forEach(r => { text += `${r.code} (${r.name}): ${r.val} см\n`; });
    navigator.clipboard.writeText(text).then(() => showToast(`Мерки «${item.name}» скопированы!`));
  } else if (action === 'delete') {
    if (confirm(`Удалить сохраненный расчет «${item.name}»?`)) {
      savedCalcsState.splice(idx, 1);
      saveSavedCalcsState();
      renderSavedCalcs();
      showToast('Расчет удален');
    }
  }
});

openSaveModalBtn.addEventListener('click', () => {
  savePreviewParams.textContent = `${heightInput.value || 163}-${bustInput.value || 84}-${hipsInput.value || 94}`;
  calcNameInput.value = '';
  saveCalcModal.style.display = 'flex';
  setTimeout(() => calcNameInput.focus(), 50);
});

closeSaveModalBtn.addEventListener('click', () => { saveCalcModal.style.display = 'none'; });
cancelSaveCalcBtn.addEventListener('click', () => { saveCalcModal.style.display = 'none'; });
saveCalcModal.addEventListener('click', (e) => { if (e.target === saveCalcModal) saveCalcModal.style.display = 'none'; });

confirmSaveCalcBtn.addEventListener('click', () => {
  const name = calcNameInput.value.trim() || `Расчет от ${new Date().toLocaleDateString('ru-RU')}`;
  const snap = getCalculationSnapshot();
  savedCalcsState.unshift({ id: 'calc_' + Date.now(), name, createdAt: new Date().toISOString(), ...snap });
  saveSavedCalcsState();
  renderSavedCalcs();
  saveCalcModal.style.display = 'none';
  showToast(`Расчет «${name}» сохранен!`);
});

// ==========================================
// 3.3 МОДЕЛИРОВАНИЕ + ЗАГРУЗКА И СЖАТИЕ ФОТО (ИСПРАВЛЕНО)
// ==========================================
const PROJECTS_STORAGE_KEY = 'alena_grass_projects_folders_v1';
let projectsState = [];
let textSaveDebounce = null;
const projectsListContainer = document.getElementById('projectsList');

async function loadProjectsState() {
  try {
    const idbData = await idbGet(PROJECTS_STORAGE_KEY);
    if (idbData && Array.isArray(idbData)) {
      projectsState = idbData;
      return;
    }
    const saved = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (saved) {
      projectsState = JSON.parse(saved);
      idbSet(PROJECTS_STORAGE_KEY, projectsState);
    }
  } catch (e) { console.error(e); }
}

function saveProjectsState(immediatePush = false) {
  lastLocalWriteTime = Date.now();
  idbSet(PROJECTS_STORAGE_KEY, projectsState);
  safeSetLocalStorage(PROJECTS_STORAGE_KEY, JSON.stringify(projectsState));
  markDirtyAndPush('projectsState', immediatePush);
}

function saveProjectsStateDebounced() {
  lastLocalWriteTime = Date.now();
  clearTimeout(textSaveDebounce);
  textSaveDebounce = setTimeout(() => saveProjectsState(false), 600);
}

// Сжатие фото в легкий формат WebP (с резервным откатом на JPEG)
function compressImageFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target.result;
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const maxDim = 900;
          let w = img.naturalWidth || img.width || 800;
          let h = img.naturalHeight || img.height || 800;
          if (w > maxDim || h > maxDim) {
            if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
            else { w = Math.round(w * maxDim / h); h = maxDim; }
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          let compressed = canvas.toDataURL('image/webp', 0.75);
          if (!compressed || !compressed.startsWith('data:image/webp')) {
            compressed = canvas.toDataURL('image/jpeg', 0.72);
          }
          resolve(compressed && compressed.length > 100 ? compressed : dataUrl);
        } catch (err) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function handlePhotoFilesUpload(filesList, pIdx, aIdx, inputElement) {
  isFilePickerOpen = false;
  lastLocalWriteTime = Date.now();
  const files = Array.from(filesList || []);
  if (files.length === 0) return;

  showToast('Обработка фото...');
  if (!projectsState[pIdx].attempts[aIdx].photos) {
    projectsState[pIdx].attempts[aIdx].photos = [];
  }

  let addedCount = 0;
  for (const file of files) {
    const resultDataUrl = await compressImageFile(file);
    if (resultDataUrl) {
      projectsState[pIdx].attempts[aIdx].photos.push(resultDataUrl);
      addedCount++;
    }
  }

  if (inputElement) inputElement.value = '';
  if (addedCount > 0) {
    updateSingleProjectDOM(pIdx);
    saveProjectsState(true);
    showToast(`Добавлено фото: ${addedCount} шт.`);
  } else {
    showToast('Не удалось прочитать файл');
  }
}

window.uploadAttemptPhoto = function(e, pIdx, aIdx) {
  handlePhotoFilesUpload(e.target.files, pIdx, aIdx, e.target);
};

window.markFilePickerOpen = function() {
  isFilePickerOpen = true;
  lastLocalWriteTime = Date.now();
};

function buildProjectCardElement(proj, pIdx) {
  const projStatus = proj.status || 'active';
  const card = document.createElement('div');
  card.className = `project-folder-card status-${projStatus}`;
  card.id = `projectCard_${pIdx}`;

  let attemptsHtml = '';
  (proj.attempts || []).forEach((att, aIdx) => {
    const attStatus = att.status || 'work';
    const stBadgeClass = attStatus === 'approved' ? 'st-approved' : (attStatus === 'defect' ? 'st-defect' : 'st-work');

    const photosHtml = (att.photos || []).map((img, imgIdx) => `
      <div class="photo-thumb-wrapper">
        <img src="${img}" class="photo-thumb" loading="lazy" decoding="async" data-proj-action="open-photo" data-pidx="${pIdx}" data-aidx="${aIdx}" data-imgidx="${imgIdx}" title="Нажмите для открытия и рисования">
        <button type="button" class="photo-delete-btn" data-proj-action="delete-photo" data-pidx="${pIdx}" data-aidx="${aIdx}" data-imgidx="${imgIdx}" title="Удалить фото">✕</button>
      </div>
    `).join('');

    const fileInputId = `fileInput_p${pIdx}_a${aIdx}`;

    attemptsHtml += `
      <div class="attempt-card att-status-${attStatus}" id="attemptCard_${pIdx}_${aIdx}">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:8px;">
          <span style="font-size:0.78rem; color:var(--accent); font-weight:700;">Попытка №${aIdx + 1}</span>
          <div style="display:flex; align-items:center; gap:8px;">
            <select class="status-select-badge ${stBadgeClass}" data-proj-change="att-status" data-pidx="${pIdx}" data-aidx="${aIdx}">
              <option value="work" ${attStatus === 'work' ? 'selected' : ''}>🟡 Макет / В работе</option>
              <option value="defect" ${attStatus === 'defect' ? 'selected' : ''}>🔴 Дефект посадки</option>
              <option value="approved" ${attStatus === 'approved' ? 'selected' : ''}>🟢 В раскрой (Удачно)</option>
            </select>
            <span style="cursor:pointer; color:#f87171; font-size:0.75rem; font-weight:700;" data-proj-action="delete-attempt" data-pidx="${pIdx}" data-aidx="${aIdx}" title="Удалить попытку">✕</span>
          </div>
        </div>
        <textarea class="modeling-textarea" placeholder="Описание моделирования, корректировки лекал, заметки..." data-proj-input="att-text" data-pidx="${pIdx}" data-aidx="${aIdx}">${escapeHtml(att.text || '')}</textarea>
        <div class="photo-upload-container">
          <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px;">
            <span style="font-size:0.72rem; color:var(--text-muted);">📷 Фотографии (${(att.photos || []).length}):</span>
            <input type="file" id="${fileInputId}" accept="image/*" multiple data-proj-file="upload" data-pidx="${pIdx}" data-aidx="${aIdx}" style="display:none;">
            <button type="button" class="btn" data-proj-action="trigger-file" data-target="${fileInputId}" style="flex:0 0 auto; width:auto; padding:6px 12px; font-size:0.74rem; color:#38bdf8; border-color:rgba(56,189,248,0.4);">
              + Загрузить фото
            </button>
          </div>
          <div class="photo-preview-grid">${photosHtml}</div>
        </div>
      </div>
    `;
  });

  const projBadgeClass = projStatus === 'done' ? 'st-approved' : (projStatus === 'fitting' ? 'st-work' : (projStatus === 'archive' ? 'st-archive' : 'st-active'));

  card.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
      <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:180px;">
        <select class="modeling-select" data-proj-change="proj-emoji" data-pidx="${pIdx}">
          <option value="👗" ${proj.emoji === '👗' ? 'selected' : ''}>👗</option>
          <option value="🧥" ${proj.emoji === '🧥' ? 'selected' : ''}>🧥</option>
          <option value="👚" ${proj.emoji === '👚' ? 'selected' : ''}>👚</option>
          <option value="👖" ${proj.emoji === '👖' ? 'selected' : ''}>👖</option>
          <option value="✂️" ${proj.emoji === '✂️' ? 'selected' : ''}>✂️</option>
          <option value="🧵" ${proj.emoji === '🧵' ? 'selected' : ''}>🧵</option>
        </select>
        <input type="text" class="modeling-input" value="${escapeHtml(proj.name)}" placeholder="Название проекта..." data-proj-input="proj-name" data-pidx="${pIdx}">
      </div>
      <div style="display:flex; gap:4px; align-items:center; flex-shrink:0;">
        <select class="status-select-badge ${projBadgeClass}" data-proj-change="proj-status" data-pidx="${pIdx}" title="Статус проекта">
          <option value="active" ${projStatus === 'active' ? 'selected' : ''}>🔵 В работе</option>
          <option value="fitting" ${projStatus === 'fitting' ? 'selected' : ''}>🟡 Примерка</option>
          <option value="done" ${projStatus === 'done' ? 'selected' : ''}>🟢 Готово</option>
          <option value="archive" ${projStatus === 'archive' ? 'selected' : ''}>⚪ Архив</option>
        </select>
        <button type="button" class="btn" data-proj-action="print-proj" data-pidx="${pIdx}" style="padding:4px 7px; font-size:0.72rem; flex:0 0 auto;" title="Экспорт проекта в PDF / Печать">🖨</button>
        <button type="button" class="btn" data-proj-action="move-up" data-pidx="${pIdx}" style="padding:4px 7px; font-size:0.72rem; flex:0 0 auto;" title="Переместить выше">▲</button>
        <button type="button" class="btn" data-proj-action="move-down" data-pidx="${pIdx}" style="padding:4px 7px; font-size:0.72rem; flex:0 0 auto;" title="Переместить ниже">▼</button>
        <button type="button" class="btn" data-proj-action="delete-proj" data-pidx="${pIdx}" style="color:#f87171; padding:4px 7px; font-size:0.72rem; flex:0 0 auto;" title="Удалить папку">🗑</button>
      </div>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
      <span style="font-size:0.72rem; color:var(--text-muted);">Попыток: ${(proj.attempts || []).length}</span>
      <button type="button" class="btn" data-proj-action="toggle-body" data-pidx="${pIdx}" id="toggleBtn_${pIdx}" style="font-size:0.72rem; padding:4px 10px; flex:0 0 auto; width:auto;">
        ${proj.isOpen ? '▲ Свернуть' : '▼ Свернуть'}
      </button>
    </div>
    <div class="project-attempts-box" id="projBody_${pIdx}" style="display:${proj.isOpen ? 'flex' : 'none'};">
      ${attemptsHtml}
      <button type="button" class="btn btn-primary" data-proj-action="add-attempt" data-pidx="${pIdx}" style="margin-top:2px; font-size:0.76rem; padding:8px;">+ Добавить попытку моделирования</button>
    </div>
  `;
  return card;
}

function updateSingleProjectDOM(pIdx) {
  const existing = document.getElementById(`projectCard_${pIdx}`);
  if (!existing || !projectsState[pIdx]) {
    renderProjects();
    return;
  }
  const updatedCard = buildProjectCardElement(projectsState[pIdx], pIdx);
  existing.replaceWith(updatedCard);
}

function renderProjects() {
  projectsListContainer.innerHTML = '';
  if (projectsState.length === 0) {
    projectsListContainer.innerHTML = `
      <div style="text-align:center; padding:18px 12px; color:var(--text-muted); font-size:0.82rem; background:var(--row-alt); border-radius:10px; border:1px dashed var(--card-border);">
        У вас пока нет папок проектов. Нажмите «+ Новый проект», чтобы создать папку и вести попытки моделирования.
      </div>
    `;
    return;
  }

  projectsState.forEach((proj, pIdx) => {
    projectsListContainer.appendChild(buildProjectCardElement(proj, pIdx));
  });
}

projectsListContainer.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-proj-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.projAction;
  const pIdx = parseInt(actionEl.dataset.pidx, 10);
  const aIdx = parseInt(actionEl.dataset.aidx, 10);
  const imgIdx = parseInt(actionEl.dataset.imgidx, 10);

  if (action === 'trigger-file') {
    isFilePickerOpen = true;
    lastLocalWriteTime = Date.now();
    const input = document.getElementById(actionEl.dataset.target);
    if (input) input.click();
  } else if (action === 'toggle-body') {
    projectsState[pIdx].isOpen = !projectsState[pIdx].isOpen;
    const el = document.getElementById(`projBody_${pIdx}`);
    const btn = document.getElementById(`toggleBtn_${pIdx}`);
    if (el) el.style.display = projectsState[pIdx].isOpen ? 'flex' : 'none';
    if (btn) btn.textContent = projectsState[pIdx].isOpen ? '▲ Свернуть' : '▼ Свернуть';
    saveProjectsState(false);
  } else if (action === 'add-attempt') {
    if (!projectsState[pIdx].attempts) projectsState[pIdx].attempts = [];
    projectsState[pIdx].attempts.push({ text: "", status: "work", photos: [] });
    saveProjectsState(true);
    updateSingleProjectDOM(pIdx);
  } else if (action === 'delete-attempt') {
    if (confirm(`Удалить попытку №${aIdx + 1}?`)) {
      projectsState[pIdx].attempts.splice(aIdx, 1);
      saveProjectsState(true);
      updateSingleProjectDOM(pIdx);
    }
  } else if (action === 'delete-photo') {
    if (confirm('Удалить это изображение?')) {
      projectsState[pIdx].attempts[aIdx].photos.splice(imgIdx, 1);
      saveProjectsState(true);
      updateSingleProjectDOM(pIdx);
    }
  } else if (action === 'open-photo') {
    openPhotoModal(pIdx, aIdx, imgIdx);
  } else if (action === 'print-proj') {
    printProjectPDF(pIdx);
  } else if (action === 'move-up' || action === 'move-down') {
    const dir = action === 'move-up' ? -1 : 1;
    const target = pIdx + dir;
    if (target < 0 || target >= projectsState.length) return;
    const temp = projectsState[pIdx];
    projectsState[pIdx] = projectsState[target];
    projectsState[target] = temp;
    saveProjectsState(true);
    renderProjects();
  } else if (action === 'delete-proj') {
    if (confirm(`Удалить проект «${projectsState[pIdx].name}» со всеми попытками?`)) {
      projectsState.splice(pIdx, 1);
      saveProjectsState(true);
      renderProjects();
    }
  }
});

projectsListContainer.addEventListener('input', (e) => {
  const inputType = e.target.dataset.projInput;
  if (!inputType) return;
  const pIdx = parseInt(e.target.dataset.pidx, 10);
  if (inputType === 'proj-name') {
    projectsState[pIdx].name = e.target.value;
    saveProjectsStateDebounced();
  } else if (inputType === 'att-text') {
    const aIdx = parseInt(e.target.dataset.aidx, 10);
    projectsState[pIdx].attempts[aIdx].text = e.target.value;
    saveProjectsStateDebounced();
  }
});

projectsListContainer.addEventListener('change', async (e) => {
  const changeType = e.target.dataset.projChange;
  if (changeType) {
    const pIdx = parseInt(e.target.dataset.pidx, 10);
    if (changeType === 'proj-emoji') {
      projectsState[pIdx].emoji = e.target.value;
      saveProjectsState(false);
    } else if (changeType === 'proj-status') {
      projectsState[pIdx].status = e.target.value;
      saveProjectsState(true);
      updateSingleProjectDOM(pIdx);
    } else if (changeType === 'att-status') {
      const aIdx = parseInt(e.target.dataset.aidx, 10);
      projectsState[pIdx].attempts[aIdx].status = e.target.value;
      saveProjectsState(true);
      updateSingleProjectDOM(pIdx);
    }
    return;
  }

  if (e.target.dataset.projFile === 'upload') {
    const pIdx = parseInt(e.target.dataset.pidx, 10);
    const aIdx = parseInt(e.target.dataset.aidx, 10);
    await handlePhotoFilesUpload(e.target.files, pIdx, aIdx, e.target);
  }
});

document.getElementById('addProjectBtn').addEventListener('click', () => {
  projectsState.push({ name: "Новый проект", emoji: "👗", status: "active", isOpen: true, attempts: [{ text: "", status: "work", photos: [] }] });
  saveProjectsState(true);
  renderProjects();
  showToast('Папка проекта создана!');
});

// ==========================================
// 3.4 ПРОСМОТРЩИК ФОТО С CANVAS РИСОВАНИЕМ
// ==========================================
const photoModal = document.getElementById('photoModal');
const photoModalViewport = document.getElementById('photoModalViewport');
const modalImage = document.getElementById('modalImage');
const drawCanvas = document.getElementById('drawCanvas');
const drawToolbar = document.getElementById('drawToolbar');
const photoCounterBadge = document.getElementById('photoCounterBadge');
const prevPhotoBtn = document.getElementById('prevPhotoBtn');
const nextPhotoBtn = document.getElementById('nextPhotoBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomResetBtn = document.getElementById('zoomResetBtn');
const toggleDrawBtn = document.getElementById('toggleDrawBtn');
const drawColorRed = document.getElementById('drawColorRed');
const drawColorBlue = document.getElementById('drawColorBlue');
const drawColorYellow = document.getElementById('drawColorYellow');
const clearCanvasBtn = document.getElementById('clearCanvasBtn');
const saveCanvasBtn = document.getElementById('saveCanvasBtn');
const downloadPhotoBtn = document.getElementById('downloadPhotoBtn');
const closePhotoModalBtn = document.getElementById('closePhotoModalBtn');
const zoomLevelText = document.getElementById('zoomLevelText');

let currentZoom = 1;
let panX = 0, panY = 0;
let isPanning = false;
let startPanX = 0, startPanY = 0;
let swipeStartX = null;
let initialPinchDistance = null;
let initialPinchZoom = 1;
let activePhotoMeta = { pIdx: 0, aIdx: 0, imgIdx: 0 };

let isDrawingMode = false;
let isUserDrawing = false;
let drawCtx = null;
let currentDrawColor = '#ef4444';

function updatePhotoTransform() {
  const transformStr = `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${currentZoom})`;
  modalImage.style.transform = transformStr;
  if (drawCanvas) {
    drawCanvas.style.transform = transformStr;
  }
  zoomLevelText.textContent = `${Math.round(currentZoom * 100)}%`;
}

function resizeCanvasToImage() {
  if (!drawCanvas || !modalImage.naturalWidth) return;
  const renderedWidth = modalImage.clientWidth || modalImage.width;
  const renderedHeight = modalImage.clientHeight || modalImage.height;
  if (!renderedWidth || !renderedHeight) return;

  drawCanvas.width = modalImage.naturalWidth;
  drawCanvas.height = modalImage.naturalHeight;
  drawCanvas.style.width = renderedWidth + 'px';
  drawCanvas.style.height = renderedHeight + 'px';

  drawCtx = drawCanvas.getContext('2d');
  drawCtx.strokeStyle = currentDrawColor;
  drawCtx.lineWidth = Math.max(3, Math.round(modalImage.naturalWidth / 220));
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';
}

function updateGalleryView() {
  const photos = (projectsState[activePhotoMeta.pIdx] && projectsState[activePhotoMeta.pIdx].attempts[activePhotoMeta.aIdx] && projectsState[activePhotoMeta.pIdx].attempts[activePhotoMeta.aIdx].photos) || [];
  if (!photos.length) return;
  const total = photos.length;
  activePhotoMeta.imgIdx = (activePhotoMeta.imgIdx + total) % total;
  
  if (isDrawingMode) toggleDrawingMode(false);

  currentZoom = 1;
  panX = 0;
  panY = 0;
  updatePhotoTransform();

  modalImage.onload = () => {
    requestAnimationFrame(() => {
      resizeCanvasToImage();
      updatePhotoTransform();
    });
  };
  modalImage.src = photos[activePhotoMeta.imgIdx];
  photoCounterBadge.textContent = `${activePhotoMeta.imgIdx + 1} / ${total}`;
  prevPhotoBtn.style.display = total > 1 ? 'flex' : 'none';
  nextPhotoBtn.style.display = total > 1 ? 'flex' : 'none';
}
function openPhotoModal(pIdx, aIdx, imgIdx) {
  activePhotoMeta = { pIdx, aIdx, imgIdx };
  // Сначала делаем модальное окно видимым, чтобы браузер знал реальные размеры экрана и картинки
  photoModal.style.display = 'flex';
  updateGalleryView();
}

function closePhotoViewer() {
  if (isDrawingMode) toggleDrawingMode(false);
  photoModal.style.display = 'none';
  modalImage.src = '';
}

function toggleDrawingMode(forceState) {
  if (!drawCanvas || !drawToolbar || !toggleDrawBtn) return;
  isDrawingMode = forceState !== undefined ? forceState : !isDrawingMode;
  if (isDrawingMode) {
    drawCanvas.classList.add('active-drawing');
    drawToolbar.style.display = 'flex';
    toggleDrawBtn.style.background = 'var(--accent)';
    toggleDrawBtn.style.color = '#0f172a';
    currentZoom = 1; panX = 0; panY = 0;
    updatePhotoTransform();
    resizeCanvasToImage();
  } else {
    drawCanvas.classList.remove('active-drawing');
    drawToolbar.style.display = 'none';
    toggleDrawBtn.style.background = 'var(--input-bg)';
    toggleDrawBtn.style.color = '#fff';
    if (drawCtx) drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  }
}

if (toggleDrawBtn) {
  toggleDrawBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDrawingMode();
  });
}

if (drawColorRed) drawColorRed.addEventListener('click', () => { currentDrawColor = '#ef4444'; if (drawCtx) drawCtx.strokeStyle = currentDrawColor; });
if (drawColorBlue) drawColorBlue.addEventListener('click', () => { currentDrawColor = '#38bdf8'; if (drawCtx) drawCtx.strokeStyle = currentDrawColor; });
if (drawColorYellow) drawColorYellow.addEventListener('click', () => { currentDrawColor = '#f59e0b'; if (drawCtx) drawCtx.strokeStyle = currentDrawColor; });

if (clearCanvasBtn) {
  clearCanvasBtn.addEventListener('click', () => {
    if (drawCtx) drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  });
}

if (saveCanvasBtn) {
  saveCanvasBtn.addEventListener('click', () => {
    if (!drawCtx) return;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = modalImage.naturalWidth;
    tempCanvas.height = modalImage.naturalHeight;
    const tCtx = tempCanvas.getContext('2d');
    tCtx.drawImage(modalImage, 0, 0);
    tCtx.drawImage(drawCanvas, 0, 0);
    let updatedDataUrl = tempCanvas.toDataURL('image/webp', 0.8);
    if (!updatedDataUrl || !updatedDataUrl.startsWith('data:image/webp')) {
      updatedDataUrl = tempCanvas.toDataURL('image/jpeg', 0.75);
    }

    if (projectsState[activePhotoMeta.pIdx] && projectsState[activePhotoMeta.pIdx].attempts[activePhotoMeta.aIdx]) {
      projectsState[activePhotoMeta.pIdx].attempts[activePhotoMeta.aIdx].photos[activePhotoMeta.imgIdx] = updatedDataUrl;
      saveProjectsState(true);
      updateSingleProjectDOM(activePhotoMeta.pIdx);
      modalImage.src = updatedDataUrl;
      toggleDrawingMode(false);
      showToast('Пометки успешно сохранены на фото!');
    }
  });
}

function getCanvasCoords(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const scaleX = drawCanvas.width / rect.width;
  const scaleY = drawCanvas.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

if (drawCanvas) {
  drawCanvas.addEventListener('mousedown', (e) => {
    if (!isDrawingMode) return;
    isUserDrawing = true;
    const pos = getCanvasCoords(e);
    drawCtx.beginPath();
    drawCtx.moveTo(pos.x, pos.y);
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDrawingMode || !isUserDrawing) return;
    const pos = getCanvasCoords(e);
    drawCtx.lineTo(pos.x, pos.y);
    drawCtx.stroke();
  });

  window.addEventListener('mouseup', () => { isUserDrawing = false; });

  drawCanvas.addEventListener('touchstart', (e) => {
    if (!isDrawingMode || e.touches.length !== 1) return;
    e.preventDefault();
    isUserDrawing = true;
    const pos = getCanvasCoords(e);
    drawCtx.beginPath();
    drawCtx.moveTo(pos.x, pos.y);
  }, { passive: false });

  drawCanvas.addEventListener('touchmove', (e) => {
    if (!isDrawingMode || !isUserDrawing || e.touches.length !== 1) return;
    e.preventDefault();
    const pos = getCanvasCoords(e);
    drawCtx.lineTo(pos.x, pos.y);
    drawCtx.stroke();
  }, { passive: false });

  drawCanvas.addEventListener('touchend', () => { isUserDrawing = false; });
}

prevPhotoBtn.addEventListener('click', (e) => { e.stopPropagation(); activePhotoMeta.imgIdx--; updateGalleryView(); });
nextPhotoBtn.addEventListener('click', (e) => { e.stopPropagation(); activePhotoMeta.imgIdx++; updateGalleryView(); });

window.addEventListener('keydown', (e) => {
  if (photoModal.style.display !== 'flex') return;
  if (e.key === 'ArrowLeft') { activePhotoMeta.imgIdx--; updateGalleryView(); }
  else if (e.key === 'ArrowRight') { activePhotoMeta.imgIdx++; updateGalleryView(); }
  else if (e.key === 'Escape') closePhotoViewer();
});

zoomInBtn.addEventListener('click', (e) => { e.stopPropagation(); currentZoom = Math.min(6, currentZoom + 0.4); updatePhotoTransform(); });
zoomOutBtn.addEventListener('click', (e) => { e.stopPropagation(); currentZoom = Math.max(0.5, currentZoom - 0.4); if (currentZoom <= 1) { panX = 0; panY = 0; } updatePhotoTransform(); });
zoomResetBtn.addEventListener('click', (e) => { e.stopPropagation(); currentZoom = 1; panX = 0; panY = 0; updatePhotoTransform(); });

downloadPhotoBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!modalImage.src) return;
  const projName = (projectsState[activePhotoMeta.pIdx] && projectsState[activePhotoMeta.pIdx].name) || 'project';
  const safeName = projName.replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_');
  const ext = modalImage.src.startsWith('data:image/webp') ? 'webp' : 'jpg';
  const a = document.createElement('a');
  a.href = modalImage.src;
  a.download = `${safeName}_попытка_${activePhotoMeta.aIdx + 1}_фото_${activePhotoMeta.imgIdx + 1}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('Фото сохранено на устройство!');
});

closePhotoModalBtn.addEventListener('click', (e) => { e.stopPropagation(); closePhotoViewer(); });
photoModalViewport.addEventListener('click', (e) => { if (e.target === photoModalViewport) closePhotoViewer(); });

modalImage.addEventListener('dblclick', (e) => {
  e.stopPropagation();
  if (isDrawingMode) return;
  if (currentZoom > 1) { currentZoom = 1; panX = 0; panY = 0; }
  else { currentZoom = 2.5; }
  updatePhotoTransform();
});

photoModalViewport.addEventListener('wheel', (e) => {
  if (isDrawingMode) return;
  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.25 : -0.25;
  currentZoom = Math.min(6, Math.max(0.5, currentZoom + delta));
  if (currentZoom <= 1) { panX = 0; panY = 0; }
  updatePhotoTransform();
}, { passive: false });

modalImage.addEventListener('mousedown', (e) => {
  if (isDrawingMode || currentZoom <= 1) return;
  e.preventDefault();
  isPanning = true;
  startPanX = e.clientX - panX;
  startPanY = e.clientY - panY;
});

window.addEventListener('mousemove', (e) => {
  if (!isPanning || isDrawingMode) return;
  panX = e.clientX - startPanX;
  panY = e.clientY - startPanY;
  updatePhotoTransform();
});

window.addEventListener('mouseup', () => { isPanning = false; });

function getTouchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

photoModalViewport.addEventListener('touchstart', (e) => {
  if (isDrawingMode) return;
  if (e.touches.length === 2) {
    e.preventDefault();
    isPanning = false; swipeStartX = null;
    initialPinchDistance = getTouchDistance(e.touches);
    initialPinchZoom = currentZoom;
  } else if (e.touches.length === 1) {
    if (currentZoom > 1) {
      isPanning = true;
      startPanX = e.touches[0].clientX - panX;
      startPanY = e.touches[0].clientY - panY;
    } else {
      swipeStartX = e.touches[0].clientX;
    }
  }
}, { passive: false });

photoModalViewport.addEventListener('touchmove', (e) => {
  if (isDrawingMode) return;
  if (e.touches.length === 2 && initialPinchDistance) {
    e.preventDefault();
    const newDist = getTouchDistance(e.touches);
    const scaleFactor = newDist / initialPinchDistance;
    currentZoom = Math.min(6, Math.max(0.5, initialPinchZoom * scaleFactor));
    if (currentZoom <= 1) { panX = 0; panY = 0; }
    updatePhotoTransform();
  } else if (e.touches.length === 1 && isPanning && currentZoom > 1) {
    e.preventDefault();
    panX = e.touches[0].clientX - startPanX;
    panY = e.touches[0].clientY - startPanY;
    updatePhotoTransform();
  }
}, { passive: false });

photoModalViewport.addEventListener('touchend', (e) => {
  if (isDrawingMode) return;
  if (e.touches.length === 0 && swipeStartX !== null && currentZoom <= 1) {
    const endX = e.changedTouches[0].clientX;
    const diffX = endX - swipeStartX;
    if (Math.abs(diffX) > 60) {
      if (diffX < 0) activePhotoMeta.imgIdx++;
      else activePhotoMeta.imgIdx--;
      updateGalleryView();
    }
    swipeStartX = null;
  }
  if (e.touches.length < 2) initialPinchDistance = null;
  if (e.touches.length === 0) isPanning = false;
});

// ==========================================
// 4. ДНЕВНИК КУРСА
// ==========================================
const courseBlocksContainer = document.getElementById('courseBlocksContainer');
const searchDiaryInput = document.getElementById('searchDiaryInput');
const overallProgressBar = document.getElementById('overallProgressBar');
const overallPercentText = document.getElementById('overallPercentText');
const overallCountText = document.getElementById('overallCountText');
const navProgressBadge = document.getElementById('navProgressBadge');

const LESSONS_STORAGE_KEY = 'alena_grass_lessons_status_v1';
const COLLAPSED_STORAGE_KEY = 'alena_grass_collapsed_blocks_v1';
let lessonsState = {};
let collapsedState = {};

function loadDiaryState() {
  try {
    const savedLessons = localStorage.getItem(LESSONS_STORAGE_KEY);
    if (savedLessons) lessonsState = JSON.parse(savedLessons);
    const savedCollapsed = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (savedCollapsed) collapsedState = JSON.parse(savedCollapsed);
  } catch (e) { console.error(e); }
}

function saveDiaryState() {
  lastLocalWriteTime = Date.now();
  safeSetLocalStorage(LESSONS_STORAGE_KEY, JSON.stringify(lessonsState));
  safeSetLocalStorage(COLLAPSED_STORAGE_KEY, JSON.stringify(collapsedState));
  markDirtyAndPush('lessonsState', false);
  markDirtyAndPush('collapsedState', false);
}

function calculateDeadlineBadge(deadlineStr, isBlockDone) {
  if (isBlockDone) return { text: '✔ Завершен', class: 'done' };
  if (!deadlineStr) return { text: 'В процессе', class: 'normal' };
  const today = new Date(); today.setHours(0,0,0,0);
  const targetDate = new Date(deadlineStr); targetDate.setHours(0,0,0,0);
  const diffDays = Math.ceil((targetDate - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { text: `⚠️ Просрочен (${Math.abs(diffDays)} дн.)`, class: 'urgent' };
  if (diffDays === 0) return { text: '🔥 Дедлайн сегодня!', class: 'urgent' };
  if (diffDays <= 3) return { text: `⏳ Осталось ${diffDays} дн.!`, class: 'warning' };
  return { text: `⏳ ${diffDays} дн. до дедлайна`, class: 'normal' };
}

function renderDiary() {
  const filter = searchDiaryInput.value.toLowerCase().trim();
  courseBlocksContainer.innerHTML = '';
  let totalCount = 0, completedCount = 0;

  window.courseBlocksData.forEach(block => {
    const totalInBlock = block.lessons.length;
    let doneInBlock = 0;
    block.lessons.forEach((_, idx) => { if (lessonsState[`b${block.id}_l${idx}`]) doneInBlock++; });

    totalCount += totalInBlock;
    completedCount += doneInBlock;

    const isBlockCompleted = (doneInBlock === totalInBlock && totalInBlock > 0);
    const blockMatches = !filter || block.title.toLowerCase().includes(filter) || (block.note && block.note.toLowerCase().includes(filter)) || block.lessons.some(l => l.toLowerCase().includes(filter));
    if (!blockMatches) return;

    const isCollapsed = collapsedState[block.id] !== undefined ? collapsedState[block.id] : isBlockCompleted;
    const blockCard = document.createElement('div');
    blockCard.className = `block-card ${isBlockCompleted ? 'completed' : ''} ${isCollapsed ? 'collapsed' : ''}`;
    const badgeInfo = calculateDeadlineBadge(block.deadline, isBlockCompleted);

    blockCard.innerHTML = `
      <div class="block-header" data-diary-action="toggle-block" data-blockid="${block.id}">
        <div class="block-title-area">
          <input type="checkbox" class="block-checkbox" data-diary-action="check-block" data-blockid="${block.id}" ${isBlockCompleted ? 'checked' : ''}>
          <div>
            <div class="block-title-text">БЛОК ${block.id}. ${block.title}</div>
            <div class="block-meta"><span>📅 ${block.dates} (${block.duration})</span><span>• ${doneInBlock}/${totalInBlock}</span></div>
          </div>
        </div>
        <div class="block-status-area">
          <span class="deadline-badge ${badgeInfo.class}">${badgeInfo.text}</span>
          <span class="chevron-icon">▼</span>
        </div>
      </div>
      <div class="block-body">
        ${block.note ? `<div class="block-note-banner">📌 <strong>Важно:</strong> ${block.note}</div>` : ''}
        <div class="lessons-list">
          ${block.lessons.map((lessonText, idx) => {
            const k = `b${block.id}_l${idx}`;
            const done = !!lessonsState[k];
            const isTest = lessonText.toLowerCase().includes('тест');
            return `
              <div class="lesson-item ${done ? 'done' : ''}" data-diary-action="toggle-lesson" data-key="${k}">
                <input type="checkbox" class="lesson-checkbox" ${done ? 'checked' : ''}>
                <span class="lesson-title">${lessonText}</span>
                ${isTest ? '<span class="test-badge">ТЕСТ</span>' : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    courseBlocksContainer.appendChild(blockCard);
  });

  const overallPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  overallProgressBar.style.width = `${overallPercent}%`;
  overallPercentText.textContent = `${overallPercent}%`;
  overallCountText.textContent = `${completedCount} / ${totalCount} уроков`;
  navProgressBadge.textContent = `${overallPercent}%`;
}

courseBlocksContainer.addEventListener('click', (e) => {
  const checkBlock = e.target.closest('[data-diary-action="check-block"]');
  if (checkBlock) {
    e.stopPropagation();
    const blockId = parseInt(checkBlock.dataset.blockid, 10);
    const block = window.courseBlocksData.find(b => b.id === blockId);
    if (block) {
      const targetState = checkBlock.checked;
      block.lessons.forEach((_, idx) => { lessonsState[`b${block.id}_l${idx}`] = targetState; });
      saveDiaryState();
      renderDiary();
    }
    return;
  }

  const lessonItem = e.target.closest('[data-diary-action="toggle-lesson"]');
  if (lessonItem) {
    const key = lessonItem.dataset.key;
    lessonsState[key] = !lessonsState[key];
    saveDiaryState();
    renderDiary();
    return;
  }

  const blockHeader = e.target.closest('[data-diary-action="toggle-block"]');
  if (blockHeader) {
    const blockId = parseInt(blockHeader.dataset.blockid, 10);
    const card = blockHeader.closest('.block-card');
    card.classList.toggle('collapsed');
    collapsedState[blockId] = card.classList.contains('collapsed');
    saveDiaryState();
  }
});

searchDiaryInput.addEventListener('input', renderDiary);
document.getElementById('collapseAllBtn').addEventListener('click', () => { window.courseBlocksData.forEach(b => collapsedState[b.id] = true); saveDiaryState(); renderDiary(); });
document.getElementById('expandAllBtn').addEventListener('click', () => { window.courseBlocksData.forEach(b => collapsedState[b.id] = false); saveDiaryState(); renderDiary(); });
document.getElementById('resetDiaryBtn').addEventListener('click', () => { if(confirm('Сбросить прогресс уроков?')) { lessonsState={}; collapsedState={}; saveDiaryState(); renderDiary(); } });

// ==========================================
// 5. УМНАЯ СИНХРОНИЗАЦИЯ FIREBASE + JSZip БЭКАПЫ
// ==========================================
const FIREBASE_BASE_URL = 'https://alena-grass-default-rtdb.europe-west1.firebasedatabase.app/user_data';
const FIREBASE_SYNC_ENDPOINT = `${FIREBASE_BASE_URL}.json`;
const FIREBASE_TS_ENDPOINT = `${FIREBASE_BASE_URL}/updatedAt.json`;

const syncBadge = document.getElementById('syncBadge');
const syncDot = document.getElementById('syncDot');
const syncStatusLabel = document.getElementById('syncStatusLabel');
const syncSettingsModal = document.getElementById('syncSettingsModal');
const closeSyncSettingsBtn = document.getElementById('closeSyncSettingsBtn');
const modalSyncStatus = document.getElementById('modalSyncStatus');
const modalLastSyncTime = document.getElementById('modalLastSyncTime');
const modalForcePullBtn = document.getElementById('modalForcePullBtn');
const modalForcePushBtn = document.getElementById('modalForcePushBtn');
const exportBackupFileBtn = document.getElementById('exportBackupFileBtn');
const exportZipBtn = document.getElementById('exportZipBtn');
const importBackupFileBtn = document.getElementById('importBackupFileBtn');
const modalBackupFileInput = document.getElementById('modalBackupFileInput');

let isSyncInProgress = false;
let pushDebounceTimer = null;
const dirtyBranches = new Set();

function setVisualStatus(state, timeText) {
  const nowTime = timeText || new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (state === 'synced') {
    syncDot.style.background = '#10b981';
    syncDot.style.boxShadow = '0 0 8px #10b981';
    syncStatusLabel.textContent = nowTime;
    syncStatusLabel.style.color = '#10b981';
    if (modalSyncStatus) { modalSyncStatus.textContent = '🟢 Синхронизировано'; modalSyncStatus.style.color = '#10b981'; }
  } else if (state === 'syncing') {
    syncDot.style.background = '#f59e0b';
    syncDot.style.boxShadow = '0 0 8px #f59e0b';
    syncStatusLabel.textContent = '...';
    syncStatusLabel.style.color = '#f59e0b';
  } else if (state === 'error') {
    syncDot.style.background = '#f87171';
    syncDot.style.boxShadow = '0 0 6px #f87171';
    syncStatusLabel.textContent = 'Офлайн';
    syncStatusLabel.style.color = '#f87171';
  }
  if (modalLastSyncTime) modalLastSyncTime.textContent = 'Время: ' + new Date().toLocaleTimeString('ru-RU');
}

function markDirtyAndPush(branch, isImmediate = false) {
  dirtyBranches.add(branch);
  pushToCloud(isImmediate);
}

async function pushToCloud(isImmediate = false, forceFull = false) {
  clearTimeout(pushDebounceTimer);
  lastLocalWriteTime = Date.now();
  const execPush = async () => {
    if (isSyncInProgress) return;
    isSyncInProgress = true;
    setVisualStatus('syncing');
    try {
      const nowTs = Date.now();
      const payload = { app: 'ALENA_GRASS', updatedAt: nowTs };
      if (forceFull || dirtyBranches.size === 0) {
        payload.calc = { h: heightInput.value, og: bustInput.value, ob: hipsInput.value };
        payload.lessonsState = lessonsState;
        payload.collapsedState = collapsedState;
        payload.savedCalcsState = savedCalcsState;
        payload.projectsState = projectsState;
      } else {
        if (dirtyBranches.has('calc')) payload.calc = { h: heightInput.value, og: bustInput.value, ob: hipsInput.value };
        if (dirtyBranches.has('lessonsState')) payload.lessonsState = lessonsState;
        if (dirtyBranches.has('collapsedState')) payload.collapsedState = collapsedState;
        if (dirtyBranches.has('savedCalcsState')) payload.savedCalcsState = savedCalcsState;
        if (dirtyBranches.has('projectsState')) payload.projectsState = projectsState;
      }
      dirtyBranches.clear();

      const res = await fetch(FIREBASE_SYNC_ENDPOINT, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        lastKnownCloudTimestamp = nowTs;
        safeSetLocalStorage('grass_last_cloud_ts', String(nowTs));
        const timeStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        setVisualStatus('synced', timeStr);
      } else {
        setVisualStatus('error');
      }
    } catch (e) {
      setVisualStatus('error');
    } finally {
      isSyncInProgress = false;
    }
  };
  if (isImmediate) await execPush();
  else pushDebounceTimer = setTimeout(execPush, 350);
}

async function pullFromCloud(forceFullPull = false) {
  if (isSyncInProgress || isFilePickerOpen) return;
  if (!forceFullPull && (Date.now() - lastLocalWriteTime < 6000)) return;

  isSyncInProgress = true;
  try {
    if (!forceFullPull && lastKnownCloudTimestamp > 0) {
      const tsRes = await fetch(`${FIREBASE_TS_ENDPOINT}?t=${Date.now()}`, { cache: 'no-store' });
      if (tsRes.ok) {
        const remoteTs = await tsRes.json();
        if (remoteTs && Number(remoteTs) <= lastKnownCloudTimestamp) {
          const timeStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
          setVisualStatus('synced', timeStr);
          isSyncInProgress = false;
          return;
        }
      }
    }

    setVisualStatus('syncing');
    const res = await fetch(`${FIREBASE_SYNC_ENDPOINT}?t=${Date.now()}`, { method: 'GET', cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object') {
        if (!forceFullPull && (Date.now() - lastLocalWriteTime < 6000)) {
          isSyncInProgress = false;
          return;
        }
        if (data.updatedAt) {
          lastKnownCloudTimestamp = Number(data.updatedAt);
          safeSetLocalStorage('grass_last_cloud_ts', String(lastKnownCloudTimestamp));
        }
        if (data.lessonsState) { lessonsState = data.lessonsState; safeSetLocalStorage(LESSONS_STORAGE_KEY, JSON.stringify(lessonsState)); }
        if (data.collapsedState) { collapsedState = data.collapsedState; safeSetLocalStorage(COLLAPSED_STORAGE_KEY, JSON.stringify(collapsedState)); }
        renderDiary();
        if (data.savedCalcsState) { savedCalcsState = data.savedCalcsState; safeSetLocalStorage(SAVED_CALCS_STORAGE_KEY, JSON.stringify(savedCalcsState)); renderSavedCalcs(); }
        if (data.projectsState || data.projects) {
          projectsState = data.projectsState || data.projects;
          idbSet(PROJECTS_STORAGE_KEY, projectsState);
          safeSetLocalStorage(PROJECTS_STORAGE_KEY, JSON.stringify(projectsState));
          renderProjects();
        }
        if (data.calc) {
          if (data.calc.h) heightInput.value = data.calc.h;
          if (data.calc.og) bustInput.value = data.calc.og;
          if (data.calc.ob) hipsInput.value = data.calc.ob;
          calculate(true);
        }
        const timeStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        setVisualStatus('synced', timeStr);
        if (forceFullPull) showToast('Данные успешно загружены!');
      }
    } else { setVisualStatus('error'); }
  } catch (e) { setVisualStatus('error'); } finally { isSyncInProgress = false; }
}

syncBadge.addEventListener('click', () => { syncSettingsModal.style.display = 'flex'; });
closeSyncSettingsBtn.addEventListener('click', () => { syncSettingsModal.style.display = 'none'; });
syncSettingsModal.addEventListener('click', (e) => { if (e.target === syncSettingsModal) syncSettingsModal.style.display = 'none'; });
modalForcePullBtn.addEventListener('click', () => pullFromCloud(true));
modalForcePushBtn.addEventListener('click', async () => { await pushToCloud(true, true); showToast('Отправлено в облако!'); });

if (exportZipBtn) {
  exportZipBtn.addEventListener('click', async () => {
    if (!window.JSZip) {
      alert('Библиотека JSZip не загружена');
      return;
    }
    showToast('Формирование ZIP архива...');
    const zip = new JSZip();
    const payload = { app: 'ALENA_GRASS', updatedAt: Date.now(), calc: { h: heightInput.value, og: bustInput.value, ob: hipsInput.value }, lessonsState, collapsedState, savedCalcsState, projectsState };
    
    zip.file("data.json", JSON.stringify(payload, null, 2));
    
    const imgFolder = zip.folder("photos");
    projectsState.forEach((proj, pIdx) => {
      const projFolderName = `${pIdx + 1}_${(proj.name || 'project').replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_')}`;
      const pFolder = imgFolder.folder(projFolderName);
      (proj.attempts || []).forEach((att, aIdx) => {
        (att.photos || []).forEach((imgDataUrl, imgIdx) => {
          if (imgDataUrl && imgDataUrl.includes('base64,')) {
            const base64Data = imgDataUrl.split('base64,')[1];
            const ext = imgDataUrl.includes('image/webp') ? 'webp' : 'jpg';
            pFolder.file(`attempt_${aIdx + 1}_photo_${imgIdx + 1}.${ext}`, base64Data, { base64: true });
          }
        });
      });
    });

    try {
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `alena_grass_archive_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('ZIP архив успешно создан!');
    } catch (err) {
      alert('Ошибка создания ZIP: ' + err.message);
    }
  });
}

exportBackupFileBtn.addEventListener('click', () => {
  const payload = { app: 'ALENA_GRASS', updatedAt: Date.now(), calc: { h: heightInput.value, og: bustInput.value, ob: hipsInput.value }, lessonsState, collapsedState, savedCalcsState, projectsState };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `alena_grass_backup_${new Date().toISOString().slice(0, 10)}.json`; a.click();
  URL.revokeObjectURL(url);
  showToast('Резервная копия сохранена!');
});

importBackupFileBtn.addEventListener('click', () => modalBackupFileInput.click());
modalBackupFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  if (file.name.endsWith('.zip')) {
    if (!window.JSZip) { alert('JSZip не загружен'); return; }
    showToast('Чтение ZIP архива...');
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const zip = new JSZip();
        const zipContent = await zip.loadAsync(event.target.result);
        if (zipContent.files["data.json"]) {
          const jsonStr = await zipContent.files["data.json"].async("text");
          const imported = JSON.parse(jsonStr);
          applyImportedData(imported);
          showToast('ZIP архив успешно восстановлен!');
          syncSettingsModal.style.display = 'none';
        } else {
          alert('В архиве не найден файл data.json');
        }
      } catch (err) {
        alert('Ошибка распаковки ZIP: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const imported = JSON.parse(event.target.result);
      if (imported) {
        applyImportedData(imported);
        showToast('Резервная копия восстановлена!');
        syncSettingsModal.style.display = 'none';
      }
    } catch (err) { alert('Ошибка чтения файла'); }
  };
  reader.readAsText(file);
});

function applyImportedData(imported) {
  if (imported.lessonsState) lessonsState = imported.lessonsState;
  if (imported.collapsedState) collapsedState = imported.collapsedState;
  if (imported.savedCalcsState) savedCalcsState = imported.savedCalcsState;
  if (imported.projectsState || imported.projects) projectsState = imported.projectsState || imported.projects;
  if (imported.calc) {
    if (imported.calc.h) heightInput.value = imported.calc.h;
    if (dataCalcCheck(imported.calc.og)) bustInput.value = imported.calc.og;
    if (dataCalcCheck(imported.calc.ob)) hipsInput.value = imported.calc.ob;
  }
  saveDiaryState(); saveSavedCalcsState(); saveProjectsState(true); saveCalcState();
  renderDiary(); renderSavedCalcs(); renderProjects(); calculate(true);
  pushToCloud(true, true);
}

function dataCalcCheck(val) {
  return val !== undefined && val !== null;
}

// Автоматическая фоновая отправка при восстановлении интернета (Offline-first)
window.addEventListener('online', () => {
  if (dirtyBranches.size > 0) {
    pushToCloud(true, false);
  } else {
    pullFromCloud(false);
  }
});

// ==========================================
// 6. ИНИЦИАЛИЗАЦИЯ
// ==========================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

(async function initApp() {
  loadCalcState();
  calculate(true);
  loadSavedCalcsState();
  renderSavedCalcs();
  await loadProjectsState();
  renderProjects();
  loadDiaryState();
  renderDiary();
  setTimeout(() => pullFromCloud(false), 250);
})();

setInterval(() => {
  if (document.visibilityState === 'visible' && !isSyncInProgress && !isFilePickerOpen) {
    pullFromCloud(false);
  }
}, 25000);
