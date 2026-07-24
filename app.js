'use strict';

/* ============================================================
 * 支給ルール（KESEN LARUS BASKETBALL CLUB 交通費等及び謝礼金支給規程 第3条・第4条）
 * ============================================================ */
const STAFF_NAMES = ['脇坂健吾', '小山裕介', '熊谷大輔', '今野和倫', '和田悠晟'];
const DEFAULT_ROLE = { 脇坂健吾: 'main_coach' };

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
const CONTACTS_KEY = 'larus_receipt_contacts_v1';

/* 交通費受領書の明細行（KESEN LARUS所定様式の並び順） */
const RECEIPT_ROWS = [
  { label: '練習(メイン)', unit: 1000, match: (r) => r.category === 'practice' && r.role === 'main_coach' },
  { label: '練習(サブ)', unit: 500, match: (r) => r.category === 'practice' && r.role !== 'main_coach' },
  { label: '土日(半日・内)', unit: 1000, match: (r) => r.category === 'weekend' && r.location === 'in' && r.duration === 'half' },
  { label: '土日(全日・内)', unit: 1500, match: (r) => r.category === 'weekend' && r.location === 'in' && r.duration === 'full' },
  { label: '土日(半日・外)', unit: 2000, match: (r) => r.category === 'weekend' && r.location === 'out' && r.duration === 'half' },
  { label: '土日(全日・外)', unit: 3000, match: (r) => r.category === 'weekend' && r.location === 'out' && r.duration === 'full' },
];

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

function loadContacts() {
  try {
    const raw = localStorage.getItem(CONTACTS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { addresses: parsed.addresses || {}, phones: parsed.phones || {} };
  } catch (e) {
    console.error('failed to load contacts', e);
    return { addresses: {}, phones: {} };
  }
}

function saveContacts(contacts) {
  localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
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
 * 入力フォーム（対象者・区分・役割を選び、参加日をカレンダーで一括選択）
 * ============================================================ */
let calYear, calMonth; // 1-indexed month
let selectedDates = new Set();

function initForm() {
  const form = document.getElementById('entry-form');
  const nameSel = document.getElementById('f-name');
  const categorySel = document.getElementById('f-category');

  nameSel.innerHTML = STAFF_NAMES.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');

  nameSel.addEventListener('change', () => {
    applyDefaultRole();
    updateUnitAmount();
  });
  categorySel.addEventListener('change', () => {
    updateConditionalFields();
    updateUnitAmount();
  });
  document.getElementById('f-role').addEventListener('change', updateUnitAmount);
  document.getElementById('f-location').addEventListener('change', updateUnitAmount);
  document.getElementById('f-duration').addEventListener('change', updateUnitAmount);

  initCalendar();
  applyDefaultRole();
  updateConditionalFields();
  updateUnitAmount();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (selectedDates.size === 0) {
      alert('参加した日を1日以上選択してください');
      return;
    }
    const name = nameSel.value;
    const category = categorySel.value;
    const role = category === 'practice' ? document.getElementById('f-role').value : undefined;
    const location = category === 'weekend' ? document.getElementById('f-location').value : undefined;
    const duration = category === 'weekend' ? document.getElementById('f-duration').value : undefined;
    const note = document.getElementById('f-note').value;
    const amount = calcUnitAmount(category, { role, location, duration });

    const dates = [...selectedDates].sort();
    dates.forEach((date) => {
      addRecord({ date, name, category, role, location, duration, amount, note });
    });
    persist();

    selectedDates.clear();
    renderCalendar();
    document.getElementById('f-note').value = '';
    showToast(`${dates.length}日分を登録しました`);
  });
}

function applyDefaultRole() {
  const name = document.getElementById('f-name').value;
  document.getElementById('f-role').value = DEFAULT_ROLE[name] ?? 'staff';
}

function updateConditionalFields() {
  const category = document.getElementById('f-category').value;
  document.getElementById('group-role').style.display = category === 'practice' ? '' : 'none';
  document.getElementById('group-location').style.display = category === 'weekend' ? '' : 'none';
  document.getElementById('group-duration').style.display = category === 'weekend' ? '' : 'none';
}

function updateUnitAmount() {
  const category = document.getElementById('f-category').value;
  const role = document.getElementById('f-role').value;
  const location = document.getElementById('f-location').value;
  const duration = document.getElementById('f-duration').value;
  const amount = calcUnitAmount(category, { role, location, duration });
  document.getElementById('f-unit-amount').textContent = yen(amount) + ' / 日';
}

/* ============================================================
 * カレンダー（参加日の複数選択）
 * ============================================================ */
function initCalendar() {
  const today = new Date();
  calYear = today.getFullYear();
  calMonth = today.getMonth() + 1;

  document.getElementById('cal-prev').addEventListener('click', () => shiftCalendarMonth(-1));
  document.getElementById('cal-next').addEventListener('click', () => shiftCalendarMonth(1));
  document.getElementById('cal-clear').addEventListener('click', () => {
    selectedDates.clear();
    renderCalendar();
  });

  renderCalendar();
}

function shiftCalendarMonth(delta) {
  calMonth += delta;
  if (calMonth < 1) {
    calMonth = 12;
    calYear -= 1;
  } else if (calMonth > 12) {
    calMonth = 1;
    calYear += 1;
  }
  renderCalendar();
}

function renderCalendar() {
  document.getElementById('cal-label').textContent = `${calYear}年${calMonth}月`;
  document.getElementById('f-select-count').textContent = selectedDates.size;

  const grid = document.getElementById('cal-grid');
  const firstWeekday = new Date(calYear, calMonth - 1, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();

  let html = '';
  for (let i = 0; i < firstWeekday; i++) {
    html += '<span class="cal-day cal-day-empty"></span>';
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const selected = selectedDates.has(dateStr);
    html += `<button type="button" class="cal-day${selected ? ' selected' : ''}" data-date="${dateStr}">${d}</button>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.cal-day:not(.cal-day-empty)').forEach((btn) => {
    btn.addEventListener('click', () => {
      const date = btn.dataset.date;
      if (selectedDates.has(date)) {
        selectedDates.delete(date);
        btn.classList.remove('selected');
      } else {
        selectedDates.add(date);
        btn.classList.add('selected');
      }
      document.getElementById('f-select-count').textContent = selectedDates.size;
    });
  });
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
function computeActivityStats(month) {
  const filtered = records.filter((r) => monthKey(r.date) === month);
  const activeDays = new Set(filtered.map((r) => r.date));
  const daysByName = new Map(STAFF_NAMES.map((n) => [n, new Set()]));
  filtered.forEach((r) => {
    daysByName.get(r.name)?.add(r.date);
  });
  return { activeDays, daysByName };
}

function renderSummary() {
  const monthSel = document.getElementById('summary-month');
  populateMonthOptions('summary-month', monthSel.value, false);
  const month = monthSel.value;

  const filtered = records.filter((r) => monthKey(r.date) === month);
  const byName = new Map(STAFF_NAMES.map((n) => [n, 0]));
  filtered.forEach((r) => {
    byName.set(r.name, (byName.get(r.name) || 0) + (Number(r.amount) || 0));
  });

  const { activeDays, daysByName } = computeActivityStats(month);
  const activeDayCount = activeDays.size;

  const tbody = document.getElementById('summary-tbody');
  tbody.innerHTML = '';
  let total = 0;
  STAFF_NAMES.forEach((name) => {
    const amount = byName.get(name) || 0;
    total += amount;
    const participatedDays = daysByName.get(name)?.size || 0;
    const rateText = activeDayCount === 0
      ? '-'
      : `${participatedDays}/${activeDayCount}日（${Math.round((participatedDays / activeDayCount) * 100)}%）`;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(name)}</td><td class="num">${yen(amount)}</td><td class="num">${rateText}</td>`;
    tbody.appendChild(tr);
  });

  document.getElementById('summary-total').textContent = yen(total);
  document.getElementById('summary-count').textContent = STAFF_NAMES.length + ' 名';
  document.getElementById('summary-active-days').textContent = activeDayCount;

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
  initContactSettings();
  document.getElementById('btn-receipt-pdf').addEventListener('click', handleReceiptPdfClick);
  document.getElementById('btn-sashikomi-export').addEventListener('click', handleSashikomiExportClick);
}

/* ============================================================
 * 連絡先設定（この端末のlocalStorageにのみ保存。リポジトリには含めない）
 * ============================================================ */
function initContactSettings() {
  const contacts = loadContacts();

  const body = document.getElementById('contact-settings-body');
  body.innerHTML = STAFF_NAMES.map(
    (name, i) => `
    <fieldset class="contact-person">
      <legend>${escapeHtml(name)}</legend>
      <label class="field-group">
        住所
        <input type="text" id="c-address-${i}" data-name="${escapeHtml(name)}" data-field="address" placeholder="例）陸前高田市高田町字中和野14-1">
      </label>
      <label class="field-group">
        電話番号
        <input type="text" id="c-phone-${i}" data-name="${escapeHtml(name)}" data-field="phone" placeholder="080-0000-0000">
      </label>
    </fieldset>`
  ).join('');

  body.querySelectorAll('input').forEach((input) => {
    const name = input.dataset.name;
    const field = input.dataset.field;
    const store = field === 'address' ? contacts.addresses : contacts.phones;
    input.value = store[name] || '';
    input.addEventListener('input', () => {
      const c = loadContacts();
      const target = field === 'address' ? c.addresses : c.phones;
      target[name] = input.value;
      saveContacts(c);
    });
  });
}

/* ============================================================
 * 領収書（交通費受領書）PDF出力
 * ============================================================ */
function formatDisplayName(name) {
  return name.length === 4 ? name.slice(0, 2) + '　' + name.slice(2) : name;
}

function formatEraMonth(monthKeyStr) {
  const [y, m] = monthKeyStr.split('-').map(Number);
  const reiwaYear = y - 2018;
  return `R${reiwaYear}.${m}`;
}

function numFmt(n) {
  return Number(n || 0).toLocaleString('ja-JP');
}

function buildReceiptData(name, month) {
  const monthRecords = records.filter((r) => r.name === name && monthKey(r.date) === month);
  const rows = RECEIPT_ROWS.map((rowDef) => {
    const matches = monthRecords.filter(rowDef.match);
    const count = matches.length;
    const amount = matches.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    return { label: rowDef.label, unit: rowDef.unit, count, amount };
  });
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return { name, rows, total };
}

function renderReceiptPrintArea(month, contacts, names) {
  const area = document.getElementById('receipt-print-area');
  const eraMonth = formatEraMonth(month);

  area.innerHTML = names
    .map((name) => {
      const data = buildReceiptData(name, month);
      const phone = contacts.phones[name] || '';
      const address = contacts.addresses[name] || '';
      const rowCells = (row) => `
          <td class="rc-item-label">${escapeHtml(row.label)}</td>
          <td class="rc-num">${numFmt(row.unit)}</td>
          <td class="rc-op">×</td>
          <td class="rc-num">${row.count} 回</td>
          <td class="rc-op">=</td>
          <td class="rc-num rc-row-amount">${numFmt(row.amount)} 円</td>`;
      const restRowsHtml = data.rows
        .slice(1)
        .map((row) => `<tr>${rowCells(row)}</tr>`)
        .join('');

      return `
      <div class="receipt-page">
        <div class="receipt-logo">KESEN LARUS<span class="receipt-logo-sub">BASKETBALL CLUB</span></div>
        <div class="receipt-title-bar">
          <span>${escapeHtml(eraMonth)} 月分</span><span>交通費受領書</span>
        </div>
        <table class="receipt-info-table">
          <tr>
            <th>名前</th>
            <td class="receipt-name-cell">${escapeHtml(formatDisplayName(name))}<span class="receipt-seal">印</span></td>
            <th>連絡先</th>
            <td>${escapeHtml(phone)}</td>
          </tr>
          <tr>
            <th>住所</th>
            <td colspan="3">${escapeHtml(address)}</td>
          </tr>
        </table>
        <table class="receipt-amount-table">
          <tr><th>金額</th><td class="receipt-amount-value">${numFmt(data.total)}</td><td class="receipt-amount-unit">円</td></tr>
        </table>
        <table class="receipt-detail-table">
          <tr>
            <th rowspan="${data.rows.length + 1}">交通費明細</th>
            ${rowCells(data.rows[0])}
          </tr>
          ${restRowsHtml}
          <tr class="rc-total-row">
            <td colspan="5" class="rc-total-label">合計</td>
            <td class="rc-num">${numFmt(data.total)} 円</td>
          </tr>
        </table>
      </div>`;
    })
    .join('');
}

/* ============================================================
 * 差込シート形式でのExcel出力（連絡先・住所列は含めない）
 * ============================================================ */
const SASHIKOMI_HEADER = ['No.', '支払月', '名前', '金額', 'メイン', 'サブ', '土日(半日・内)', '土日(全日・内)', '土日(半日・外)', '土日(全日・外)', '支払', '確認'];

function buildSashikomiRows() {
  const months = [...new Set(records.map((r) => monthKey(r.date)))].filter(Boolean).sort();
  const rows = [];
  let no = 1;
  months.forEach((month) => {
    STAFF_NAMES.forEach((name) => {
      const data = buildReceiptData(name, month);
      const confirmTotal = data.rows.reduce((sum, row) => sum + row.unit * row.count, 0);
      rows.push([
        no++,
        formatEraMonth(month),
        name,
        data.total,
        ...data.rows.map((row) => row.count),
        '',
        confirmTotal,
      ]);
    });
  });
  return rows;
}

function handleSashikomiExportClick() {
  if (records.length === 0) {
    alert('出力できる記録がありません');
    return;
  }
  const rows = buildSashikomiRows();
  const bytes = buildXlsxFile('差込', SASHIKOMI_HEADER, rows);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  downloadBytes(bytes, `交通費_差込データ_${today}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

function handleReceiptPdfClick() {
  const month = document.getElementById('summary-month').value;
  if (!month) {
    alert('対象月を選択してください');
    return;
  }
  const contacts = loadContacts();
  const names = STAFF_NAMES.filter((name) => buildReceiptData(name, month).rows.some((row) => row.count > 0));
  if (names.length === 0) {
    alert('対象月に支給記録がありません');
    return;
  }
  renderReceiptPrintArea(month, contacts, names);
  window.print();
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
