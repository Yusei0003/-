'use strict';

/* ============================================================
 * 支給ルール（KESEN LARUS BASKETBALL CLUB 交通費等及び謝礼金支給規程）
 * ============================================================ */
const RULES = {
  practice: {
    label: '通常練習（スタッフ）',
    roles: {
      main_coach: { label: 'メインコーチ', amount: 1000 },
      staff: { label: 'スタッフ', amount: 500 },
    },
  },
  weekend: {
    label: '土日祝日活動（スタッフ）',
    table: {
      in: { half: 1000, full: 1500 },
      out: { half: 2000, full: 3000 },
    },
  },
  referee: {
    label: '帯同審判（外部依頼者）',
    table: {
      practice_game: {
        in: { half: 2000, full: 4000 },
        out: { half: 3000, full: 5000 },
      },
      official_game: { flat: 2500 },
    },
  },
  commissioner: {
    label: 'コミッショナー（外部依頼者）',
    table: { in: 1000, out: 2000 },
  },
};

const LOCATION_LABEL = { in: '気仙管内', out: '気仙管外' };
const DURATION_LABEL = { half: '半日（4h以内）', full: '1日（4h超）' };
const STATUS_LABEL = {
  done: '実施',
  cancel_before: '中止（開始前）',
  cancel_after: '中止（現地到着後）',
};

const STORAGE_KEY = 'larus_expense_records_v1';

/* ============================================================
 * 金額計算
 * ============================================================ */
function calcSuggestedAmount(entry) {
  if (entry.status === 'cancel_before') return 0;

  let base = 0;
  if (entry.category === 'practice') {
    base = RULES.practice.roles[entry.role]?.amount ?? 0;
  } else if (entry.category === 'weekend') {
    base = RULES.weekend.table[entry.location]?.[entry.duration] ?? 0;
  } else if (entry.category === 'referee') {
    if (entry.gameType === 'official_game') {
      base = RULES.referee.table.official_game.flat;
    } else {
      base = RULES.referee.table.practice_game[entry.location]?.[entry.duration] ?? 0;
    }
  } else if (entry.category === 'commissioner') {
    base = RULES.commissioner.table[entry.location] ?? 0;
  }

  if (entry.status === 'cancel_after') return 0; // 交通費相当額のみ→要手動入力
  if (entry.category === 'referee' && entry.clubAffiliated) return 0; // 適用除外
  if (entry.mealProvided) return 0; // 代替措置（弁当支給）

  return base;
}

function suggestionNote(entry) {
  const notes = [];
  if (entry.status === 'cancel_before') notes.push('開始前中止のため支給なし');
  if (entry.status === 'cancel_after') notes.push('現地到着後中止：交通費相当額のみ（金額は手動入力してください）');
  if (entry.category === 'referee' && entry.clubAffiliated) notes.push('適用除外（クラブ関係者/保護者）のため支給なし');
  if (entry.mealProvided) notes.push('弁当支給のため金銭支給なし（代表判断で調整可）');
  return notes.join(' / ');
}

/* ============================================================
 * データストア
 * ============================================================ */
function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('failed to load records', e);
    return [];
  }
}

function saveRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

let records = loadRecords();

function addRecord(record) {
  record.id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  records.push(record);
  saveRecords(records);
}

function updateRecord(id, patch) {
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) return;
  records[idx] = { ...records[idx], ...patch };
  saveRecords(records);
}

function deleteRecord(id) {
  records = records.filter((r) => r.id !== id);
  saveRecords(records);
}

function yen(n) {
  return '¥' + Number(n || 0).toLocaleString('ja-JP');
}

function monthKey(dateStr) {
  return (dateStr || '').slice(0, 7); // YYYY-MM
}

function categoryLabel(c) {
  return RULES[c]?.label ?? c;
}

function describeEntry(entry) {
  const parts = [];
  if (entry.category === 'practice') {
    parts.push(RULES.practice.roles[entry.role]?.label ?? entry.role);
  } else if (entry.category === 'weekend') {
    parts.push(LOCATION_LABEL[entry.location], DURATION_LABEL[entry.duration]);
  } else if (entry.category === 'referee') {
    parts.push(entry.gameType === 'official_game' ? '公式戦' : '練習試合');
    if (entry.gameType !== 'official_game') {
      parts.push(LOCATION_LABEL[entry.location], DURATION_LABEL[entry.duration]);
    }
    if (entry.clubAffiliated) parts.push('クラブ関係者');
  } else if (entry.category === 'commissioner') {
    parts.push(LOCATION_LABEL[entry.location]);
  }
  if (entry.status !== 'done') parts.push(STATUS_LABEL[entry.status]);
  if (entry.mealProvided) parts.push('弁当支給あり');
  return parts.filter(Boolean).join(' / ');
}

/* ============================================================
 * タブ切り替え
 * ============================================================ */
function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'list') renderList();
      if (btn.dataset.tab === 'summary') renderSummary();
    });
  });
}

/* ============================================================
 * 入力フォーム
 * ============================================================ */
function initForm() {
  const form = document.getElementById('entry-form');
  const categorySel = document.getElementById('f-category');
  const dateInput = document.getElementById('f-date');
  dateInput.value = new Date().toISOString().slice(0, 10);

  categorySel.addEventListener('change', updateConditionalFields);
  updateConditionalFields();

  form.addEventListener('input', updateSuggestedAmount);
  form.addEventListener('change', updateSuggestedAmount);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const entry = readForm();
    if (!entry.name.trim()) {
      alert('氏名を入力してください');
      return;
    }
    addRecord(entry);
    updateNameList();
    form.reset();
    dateInput.value = new Date().toISOString().slice(0, 10);
    categorySel.value = 'practice';
    updateConditionalFields();
    updateSuggestedAmount();
    showToast('登録しました');
  });

  updateSuggestedAmount();
}

const CONDITIONAL_GROUP_IDS = [
  'group-role',
  'group-gametype',
  'group-location',
  'group-duration',
  'group-club-affiliated',
];

function updateConditionalFields() {
  const category = document.getElementById('f-category').value;
  CONDITIONAL_GROUP_IDS.forEach((id) => (document.getElementById(id).style.display = 'none'));

  if (category === 'practice') {
    document.getElementById('group-role').style.display = '';
  } else if (category === 'weekend') {
    document.getElementById('group-location').style.display = '';
    document.getElementById('group-duration').style.display = '';
  } else if (category === 'referee') {
    document.getElementById('group-gametype').style.display = '';
    const isPracticeGame = document.getElementById('f-gametype').value !== 'official_game';
    if (isPracticeGame) {
      document.getElementById('group-location').style.display = '';
      document.getElementById('group-duration').style.display = '';
    }
    document.getElementById('group-club-affiliated').style.display = '';
  } else if (category === 'commissioner') {
    document.getElementById('group-location').style.display = '';
  }
}

function readForm() {
  return {
    date: document.getElementById('f-date').value,
    name: document.getElementById('f-name').value,
    category: document.getElementById('f-category').value,
    role: document.getElementById('f-role').value,
    location: document.getElementById('f-location').value,
    duration: document.getElementById('f-duration').value,
    gameType: document.getElementById('f-gametype').value,
    clubAffiliated: document.getElementById('f-club-affiliated').checked,
    status: document.getElementById('f-status').value,
    mealProvided: document.getElementById('f-meal').checked,
    amount: Number(document.getElementById('f-amount').value) || 0,
    note: document.getElementById('f-note').value,
  };
}

function updateSuggestedAmount() {
  const category = document.getElementById('f-category').value;
  if (category === 'referee') {
    const isPracticeGame = document.getElementById('f-gametype').value !== 'official_game';
    document.getElementById('group-location').style.display = isPracticeGame ? '' : 'none';
    document.getElementById('group-duration').style.display = isPracticeGame ? '' : 'none';
  }
  const entry = readForm();
  const suggested = calcSuggestedAmount(entry);
  document.getElementById('f-suggested').textContent = yen(suggested);
  const noteEl = document.getElementById('f-suggested-note');
  noteEl.textContent = suggestionNote(entry);
  const amountInput = document.getElementById('f-amount');
  if (!amountInput.dataset.touched) {
    amountInput.value = suggested;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const amountInput = document.getElementById('f-amount');
  amountInput.addEventListener('input', () => {
    amountInput.dataset.touched = '1';
  });
  document.getElementById('f-use-suggested').addEventListener('click', () => {
    const entry = readForm();
    amountInput.value = calcSuggestedAmount(entry);
    delete amountInput.dataset.touched;
  });
});

function updateNameList() {
  const names = [...new Set(records.map((r) => r.name).filter(Boolean))].sort();
  const datalist = document.getElementById('name-list');
  datalist.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}">`).join('');
}

/* ============================================================
 * 一覧（スプレッドシート風）
 * ============================================================ */
function renderList() {
  const monthFilter = document.getElementById('list-month-filter').value;
  const nameFilter = document.getElementById('list-name-filter').value.trim();

  const filtered = records
    .filter((r) => !monthFilter || monthKey(r.date) === monthFilter)
    .filter((r) => !nameFilter || r.name.includes(nameFilter))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const tbody = document.getElementById('list-tbody');
  tbody.innerHTML = '';

  let total = 0;
  filtered.forEach((r) => {
    total += Number(r.amount) || 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(categoryLabel(r.category))}</td>
      <td>${escapeHtml(describeEntry(r))}</td>
      <td class="num"><input type="number" class="amount-edit" value="${r.amount}" data-id="${r.id}" step="1"></td>
      <td>${escapeHtml(r.note || '')}</td>
      <td><button class="btn-danger" data-del="${r.id}">削除</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('list-total').textContent = yen(total);
  document.getElementById('list-count').textContent = filtered.length + ' 件';

  tbody.querySelectorAll('.amount-edit').forEach((input) => {
    input.addEventListener('change', () => {
      updateRecord(input.dataset.id, { amount: Number(input.value) || 0 });
      renderList();
    });
  });
  tbody.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (confirm('この記録を削除しますか？')) {
        deleteRecord(btn.dataset.del);
        renderList();
      }
    });
  });

  populateMonthOptions('list-month-filter', monthFilter);
}

function populateMonthOptions(selectId, current) {
  const months = [...new Set(records.map((r) => monthKey(r.date)).filter(Boolean))].sort().reverse();
  const sel = document.getElementById(selectId);
  const keep = current || sel.value;
  sel.innerHTML = '<option value="">すべての月</option>' + months.map((m) => `<option value="${m}">${m}</option>`).join('');
  sel.value = keep;
}

function initList() {
  document.getElementById('list-month-filter').addEventListener('change', renderList);
  document.getElementById('list-name-filter').addEventListener('input', renderList);
}

/* ============================================================
 * 月次集計
 * ============================================================ */
function renderSummary() {
  const monthSel = document.getElementById('summary-month');
  populateMonthOptions('summary-month', monthSel.value);
  const month = monthSel.value || monthKey(new Date().toISOString());

  const filtered = records.filter((r) => monthKey(r.date) === month);
  const byName = new Map();
  filtered.forEach((r) => {
    byName.set(r.name, (byName.get(r.name) || 0) + (Number(r.amount) || 0));
  });

  const tbody = document.getElementById('summary-tbody');
  tbody.innerHTML = '';
  let total = 0;
  [...byName.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'ja'))
    .forEach(([name, amount]) => {
      total += amount;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(name)}</td><td class="num">${yen(amount)}</td>`;
      tbody.appendChild(tr);
    });

  document.getElementById('summary-total').textContent = yen(total);
  document.getElementById('summary-count').textContent = byName.size + ' 名';

  const payDate = nextPaymentDate(month);
  document.getElementById('summary-paydate').textContent = payDate;
}

function nextPaymentDate(monthKeyStr) {
  if (!monthKeyStr) return '-';
  const [y, m] = monthKeyStr.split('-').map(Number);
  let py = y, pm = m + 1;
  if (pm > 12) { pm = 1; py += 1; }
  return `${py}年${pm}月25日`;
}

function initSummary() {
  document.getElementById('summary-month').addEventListener('change', renderSummary);
}

/* ============================================================
 * ユーティリティ
 * ============================================================ */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ============================================================
 * 初期化
 * ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initForm();
  initList();
  initSummary();
  updateNameList();
  renderList();
  renderSummary();
});
