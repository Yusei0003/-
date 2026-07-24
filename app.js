'use strict';

/* ============================================================
 * 支給ルール（KESEN LARUS BASKETBALL CLUB 交通費等及び謝礼金支給規程 第3条・第4条）
 * ============================================================ */
const STAFF_NAMES = ['脇坂健吾', '小山裕介', '熊谷大輔', '今野和倫', '和田悠晟'];

const RULES = {
  practice: {
    label: '通常練習',
    roles: {
      staff: { label: 'スタッフ', amount: 500 },
      main_coach: { label: 'メインコーチ', amount: 1000 },
    },
  },
  weekend: {
    label: '土日祝日活動',
    table: {
      in: { half: 1000, full: 1500 },
      out: { half: 2000, full: 3000 },
    },
  },
};

const LOCATION_LABEL = { in: '気仙管内', out: '気仙管外' };
const DURATION_LABEL = { half: '半日（4h以内）', full: '1日（4h超）' };

const STORAGE_KEY = 'larus_expense_records_v3';

/* ============================================================
 * 金額計算
 * ============================================================ */
function calcUnitAmount(category, { role, location, duration }) {
  if (category === 'practice') return RULES.practice.roles[role]?.amount ?? RULES.practice.roles.staff.amount;
  if (category === 'weekend') return RULES.weekend.table[location]?.[duration] ?? 0;
  return 0;
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
}

function persist() {
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
  if (entry.category === 'weekend') {
    return [LOCATION_LABEL[entry.location], DURATION_LABEL[entry.duration]].filter(Boolean).join(' / ');
  }
  if (entry.category === 'practice') {
    return RULES.practice.roles[entry.role]?.label ?? '';
  }
  return '';
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
 * 入力フォーム（出席チェックリスト方式）
 * ============================================================ */
function initForm() {
  const form = document.getElementById('entry-form');
  const categorySel = document.getElementById('f-category');
  const dateInput = document.getElementById('f-date');
  dateInput.value = new Date().toISOString().slice(0, 10);

  renderStaffCheckboxes();

  categorySel.addEventListener('change', () => {
    updateConditionalFields();
    updateRoleSelectVisibility();
    updateUnitAmount();
  });
  document.getElementById('f-location').addEventListener('change', updateUnitAmount);
  document.getElementById('f-duration').addEventListener('change', updateUnitAmount);

  document.getElementById('f-select-all').addEventListener('click', () => {
    const boxes = document.querySelectorAll('.staff-checkbox');
    const allChecked = [...boxes].every((b) => b.checked);
    boxes.forEach((b) => (b.checked = !allChecked));
    updateSelectedCount();
  });

  updateConditionalFields();
  updateRoleSelectVisibility();
  updateUnitAmount();
  updateSelectedCount();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const checkedBoxes = [...document.querySelectorAll('.staff-checkbox:checked')];
    if (checkedBoxes.length === 0) {
      alert('対象者を1名以上選択してください');
      return;
    }
    const category = categorySel.value;
    const location = document.getElementById('f-location').value;
    const duration = document.getElementById('f-duration').value;
    const note = document.getElementById('f-note').value;
    const date = dateInput.value;

    checkedBoxes.forEach((cb) => {
      const name = cb.value;
      const roleSelect = document.getElementById(cb.dataset.roleId);
      const role = roleSelect ? roleSelect.value : undefined;
      const amount = calcUnitAmount(category, { role, location, duration });
      addRecord({ date, name, category, role, location, duration, amount, note });
    });
    persist();

    document.querySelectorAll('.staff-checkbox').forEach((b) => (b.checked = false));
    document.querySelectorAll('.staff-role').forEach((s) => (s.value = 'staff'));
    document.getElementById('f-note').value = '';
    updateSelectedCount();
    showToast(`${checkedBoxes.length}名分を登録しました`);
  });
}

function renderStaffCheckboxes() {
  const wrap = document.getElementById('staff-checkboxes');
  wrap.innerHTML = STAFF_NAMES.map((name, i) => {
    const roleId = `staff-role-${i}`;
    return `
    <div class="staff-chip">
      <label class="staff-chip-main">
        <input type="checkbox" class="staff-checkbox" value="${escapeHtml(name)}" id="staff-cb-${i}" data-role-id="${roleId}">
        <span>${escapeHtml(name)}</span>
      </label>
      <select class="staff-role" id="${roleId}">
        <option value="staff">スタッフ（500円）</option>
        <option value="main_coach">メインコーチ（1,000円）</option>
      </select>
    </div>`;
  }).join('');
  wrap.querySelectorAll('.staff-checkbox').forEach((cb) => cb.addEventListener('change', updateSelectedCount));
}

function updateRoleSelectVisibility() {
  const category = document.getElementById('f-category').value;
  const show = category === 'practice';
  document.querySelectorAll('.staff-role').forEach((s) => (s.style.display = show ? '' : 'none'));
}

function updateSelectedCount() {
  const count = document.querySelectorAll('.staff-checkbox:checked').length;
  document.getElementById('f-select-count').textContent = count;
}

function updateConditionalFields() {
  const category = document.getElementById('f-category').value;
  const show = category === 'weekend';
  document.getElementById('group-location').style.display = show ? '' : 'none';
  document.getElementById('group-duration').style.display = show ? '' : 'none';
}

function updateUnitAmount() {
  const category = document.getElementById('f-category').value;
  const box = document.getElementById('f-unit-amount');
  if (category === 'practice') {
    box.textContent = `スタッフ ${yen(RULES.practice.roles.staff.amount)} / メインコーチ ${yen(RULES.practice.roles.main_coach.amount)}`;
    return;
  }
  const location = document.getElementById('f-location').value;
  const duration = document.getElementById('f-duration').value;
  const amount = calcUnitAmount(category, { location, duration });
  box.textContent = yen(amount) + ' / 人';
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

  populateMonthOptions('list-month-filter', monthFilter, true);
}

function populateMonthOptions(selectId, current, includeAllOption) {
  const thisMonth = monthKey(new Date().toISOString());
  const months = [...new Set([...records.map((r) => monthKey(r.date)), thisMonth].filter(Boolean))].sort().reverse();
  const sel = document.getElementById(selectId);
  const keep = current || sel.value;
  const allOption = includeAllOption ? '<option value="">すべての月</option>' : '';
  sel.innerHTML = allOption + months.map((m) => `<option value="${m}">${m}</option>`).join('');
  sel.value = keep || (includeAllOption ? '' : thisMonth);
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
  populateMonthOptions('summary-month', monthSel.value, false);
  const month = monthSel.value;

  const filtered = records.filter((r) => monthKey(r.date) === month);
  const byName = new Map(STAFF_NAMES.map((n) => [n, 0]));
  filtered.forEach((r) => {
    byName.set(r.name, (byName.get(r.name) || 0) + (Number(r.amount) || 0));
  });

  const tbody = document.getElementById('summary-tbody');
  tbody.innerHTML = '';
  let total = 0;
  STAFF_NAMES.forEach((name) => {
    const amount = byName.get(name) || 0;
    total += amount;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(name)}</td><td class="num">${yen(amount)}</td>`;
    tbody.appendChild(tr);
  });

  document.getElementById('summary-total').textContent = yen(total);
  document.getElementById('summary-count').textContent = STAFF_NAMES.length + ' 名';

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
  renderList();
  renderSummary();
});
