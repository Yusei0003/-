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
 * データストア（Firestoreに保存。window.FirebaseDataはfirebase-bundle.jsが用意する）
 * ============================================================ */
let records = [];
let pendingRecords = [];
let contactsCache = { addresses: {}, phones: {} };

function addRecord(record) {
  pendingRecords.push(record);
}

function persist() {
  if (pendingRecords.length === 0) return;
  const batch = pendingRecords;
  pendingRecords = [];
  window.FirebaseData.addRecords(batch).catch((err) => {
    console.error('addRecords failed', err);
    alert('登録に失敗しました: ' + err.message);
  });
}

function updateRecord(id, patch) {
  window.FirebaseData.updateRecord(id, patch).catch((err) => {
    console.error('updateRecord failed', err);
    alert('更新に失敗しました: ' + err.message);
  });
}

function deleteRecord(id) {
  window.FirebaseData.deleteRecord(id).catch((err) => {
    console.error('deleteRecord failed', err);
    alert('削除に失敗しました: ' + err.message);
  });
}

function loadContacts() {
  return contactsCache;
}

function saveContacts(contacts) {
  window.FirebaseData.saveContacts(contacts).catch((err) => {
    console.error('saveContacts failed', err);
    alert('連絡先の保存に失敗しました: ' + err.message);
  });
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
      if (btn.dataset.tab === 'dashboard') renderDashboard();
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
    pruneSelectedDatesForName();
    renderCalendar();
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

    const dates = [...selectedDates].sort().filter((date) => !isDateRegisteredForName(name, date));
    if (dates.length === 0) {
      alert('選択した日はすでに登録済みのため、登録できませんでした');
      return;
    }
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

function isDateRegisteredForName(name, date) {
  return records.some((r) => r.name === name && r.date === date);
}

function pruneSelectedDatesForName() {
  const name = document.getElementById('f-name').value;
  [...selectedDates].forEach((date) => {
    if (isDateRegisteredForName(name, date)) selectedDates.delete(date);
  });
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
 * 日本の祝日判定（固定日・ハッピーマンデー・春分秋分・振替休日・国民の休日）
 * ============================================================ */
const holidayCache = new Map(); // year -> Map('YYYY-MM-DD' -> name)

function nthMondayDate(year, month, nth) {
  const first = new Date(year, month - 1, 1);
  const firstMonday = 1 + ((8 - first.getDay()) % 7);
  return firstMonday + (nth - 1) * 7;
}

function computeJapaneseHolidays(year) {
  const pad = (n) => String(n).padStart(2, '0');
  const key = (m, d) => `${year}-${pad(m)}-${pad(d)}`;
  const holidays = new Map();
  const add = (m, d, name) => holidays.set(key(m, d), name);

  add(1, 1, '元日');
  add(2, 11, '建国記念の日');
  if (year >= 2020) add(2, 23, '天皇誕生日');
  add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日');
  add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');
  if (year >= 2016) add(8, 11, '山の日');
  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');

  add(1, nthMondayDate(year, 1, 2), '成人の日');
  add(7, nthMondayDate(year, 7, 3), '海の日');
  add(9, nthMondayDate(year, 9, 3), '敬老の日');
  add(10, nthMondayDate(year, 10, 2), year >= 2020 ? 'スポーツの日' : '体育の日');

  const shunbun = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  add(3, shunbun, '春分の日');
  const shuubun = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  add(9, shuubun, '秋分の日');

  // 国民の休日: 前後を祝日に挟まれた(日曜以外の)平日
  const toDate = (dstr) => {
    const [y, m, d] = dstr.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (date, n) => {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  };
  const fmt = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  [...holidays.keys()].forEach((dstr) => {
    const d = toDate(dstr);
    const next = addDays(d, 2);
    const between = addDays(d, 1);
    if (holidays.has(fmt(next)) && !holidays.has(fmt(between)) && between.getDay() !== 0) {
      holidays.set(fmt(between), '国民の休日');
    }
  });

  // 振替休日: 祝日が日曜の場合、直後の祝日でない日を振替休日にする
  [...holidays.entries()]
    .filter(([dstr]) => toDate(dstr).getDay() === 0)
    .forEach(([dstr]) => {
      let cursor = addDays(toDate(dstr), 1);
      while (holidays.has(fmt(cursor))) {
        cursor = addDays(cursor, 1);
      }
      holidays.set(fmt(cursor), '振替休日');
    });

  return holidays;
}

function getHolidaysForYear(year) {
  if (!holidayCache.has(year)) {
    holidayCache.set(year, computeJapaneseHolidays(year));
  }
  return holidayCache.get(year);
}

function getHolidayName(dateStr) {
  const year = Number(dateStr.slice(0, 4));
  return getHolidaysForYear(year).get(dateStr);
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
  const name = document.getElementById('f-name').value;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const selected = selectedDates.has(dateStr);
    const weekday = new Date(calYear, calMonth - 1, d).getDay();
    const holidayName = getHolidayName(dateStr);
    const registeredRecords = records.filter((r) => r.name === name && r.date === dateStr);
    const isRegistered = registeredRecords.length > 0;

    const classes = ['cal-day'];
    if (weekday === 6) classes.push('cal-day-sat');
    if (weekday === 0 || holidayName) classes.push('cal-day-holiday');
    if (isRegistered) classes.push('cal-day-registered');
    if (selected) classes.push('selected');

    const titleParts = [];
    if (holidayName) titleParts.push(holidayName);
    if (isRegistered) {
      titleParts.push(
        '登録済み: ' +
          registeredRecords
            .map((r) => `${categoryLabel(r.category)}${describeEntry(r) ? '・' + describeEntry(r) : ''}（${yen(r.amount)}）`)
            .join(' / ')
      );
    }
    const title = titleParts.length ? ` title="${escapeHtml(titleParts.join(' / '))}"` : '';
    const disabled = isRegistered ? ' disabled' : '';
    const badge = isRegistered ? '<span class="cal-day-badge">●</span>' : '';
    html += `<button type="button" class="${classes.join(' ')}" data-date="${dateStr}"${title}${disabled}>${d}${badge}</button>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.cal-day:not(.cal-day-empty):not(:disabled)').forEach((btn) => {
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
let listMonthFilterTouched = false;

function renderList() {
  let monthFilter = document.getElementById('list-month-filter').value;
  if (!listMonthFilterTouched) {
    const months = [...new Set(records.map((r) => monthKey(r.date)))].sort().reverse();
    monthFilter = months[0] || monthKey(new Date().toISOString());
  }
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
  document.getElementById('list-month-filter').addEventListener('change', () => {
    listMonthFilterTouched = true;
    renderList();
  });
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
  initImport();
  initMonthlyCountImport();
  initEnvelope();
}

/* ============================================================
 * 過去データのCSVインポート
 * ============================================================ */
function parseCsv(text) {
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = stripped.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.length > 0);
  return lines.map((line) => {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  });
}

function initImport() {
  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => handleImportCsv(String(reader.result));
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  });
}

/* ============================================================
 * 月別の回数からの一括インポート（日付ごとの出欠が不明な過去データ用）
 * 支払月,名前,金額,メイン,サブ,土日(半日・内),土日(全日・内),土日(半日・外),土日(全日・外)
 * ============================================================ */
const MONTHLY_COUNT_COLUMNS = [
  { header: 'メイン', category: 'practice', role: 'main_coach', amount: 1000 },
  { header: 'サブ', category: 'practice', role: 'staff', amount: 500 },
  { header: '土日(半日・内)', category: 'weekend', location: 'in', duration: 'half', amount: 1000 },
  { header: '土日(全日・内)', category: 'weekend', location: 'in', duration: 'full', amount: 1500 },
  { header: '土日(半日・外)', category: 'weekend', location: 'out', duration: 'half', amount: 2000 },
  { header: '土日(全日・外)', category: 'weekend', location: 'out', duration: 'full', amount: 3000 },
];

function parseReiwaMonth(str) {
  const m = String(str ?? '').trim().match(/^R(\d+)\.(\d{1,2})$/);
  if (!m) return null;
  const reiwaYear = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year: reiwaYear + 2018, month };
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function initMonthlyCountImport() {
  document.getElementById('monthly-import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => handleMonthlyCountImportCsv(String(reader.result));
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  });
}

function handleMonthlyCountImportCsv(text) {
  const resultEl = document.getElementById('monthly-import-result');
  const rows = parseCsv(text);
  if (rows.length === 0) {
    resultEl.textContent = 'ファイルが空です';
    return;
  }
  const header = rows[0].map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const iMonth = idx('支払月');
  const iName = idx('名前');
  const iAmount = idx('金額');
  const columns = MONTHLY_COUNT_COLUMNS.map((c) => ({ ...c, idx: idx(c.header) }));

  if (iMonth === -1 || iName === -1) {
    resultEl.textContent = 'CSVの形式が正しくありません（支払月・名前の列が必要です）';
    return;
  }

  let added = 0;
  let duplicated = 0;
  let invalid = 0;
  const mismatchLines = [];

  rows.slice(1).forEach((cells) => {
    if (cells.length < 2) return;
    const monthStr = cells[iMonth]?.trim();
    const name = cells[iName]?.trim();
    const period = parseReiwaMonth(monthStr);
    if (!period || !STAFF_NAMES.includes(name)) {
      invalid++;
      return;
    }

    const entries = [];
    columns.forEach((c) => {
      if (c.idx === -1) return;
      const count = Number(cells[c.idx]);
      if (!Number.isFinite(count) || count <= 0) return;
      for (let i = 0; i < count; i++) {
        entries.push({ category: c.category, role: c.role, location: c.location, duration: c.duration, amount: c.amount });
      }
    });
    if (entries.length === 0) {
      invalid++;
      return;
    }

    const computedTotal = entries.reduce((sum, e) => sum + e.amount, 0);
    const statedAmount = iAmount !== -1 ? Number(cells[iAmount]) : NaN;
    if (Number.isFinite(statedAmount) && statedAmount !== computedTotal) {
      mismatchLines.push(`${monthStr} ${name}: 記載${statedAmount}円 / 計算${computedTotal}円`);
    }

    const dim = daysInMonth(period.year, period.month);
    const mm = String(period.month).padStart(2, '0');
    entries.forEach((e, i) => {
      const day = (i % dim) + 1;
      const date = `${period.year}-${mm}-${String(day).padStart(2, '0')}`;
      const isDuplicate = records.some(
        (r) => r.date === date && r.name === name && r.category === e.category && r.role === e.role && r.location === e.location && r.duration === e.duration && Number(r.amount) === e.amount
      );
      if (isDuplicate) {
        duplicated++;
        return;
      }
      addRecord({ date, name, category: e.category, role: e.role, location: e.location, duration: e.duration, amount: e.amount, note: '月別回数取込（仮の日付）' });
      added++;
    });
  });

  persist();

  const resultLines = [`${added}件を追加しました`];
  if (duplicated > 0) resultLines.push(`（重複のためスキップ: ${duplicated}件）`);
  if (invalid > 0) resultLines.push(`（形式不正のためスキップ: ${invalid}行）`);
  if (mismatchLines.length > 0) {
    const shown = mismatchLines.slice(0, 5).join(' / ');
    const more = mismatchLines.length > 5 ? ` 他${mismatchLines.length - 5}件` : '';
    resultLines.push(`（金額不一致: ${shown}${more}）`);
  }
  resultEl.textContent = resultLines.join(' ');
  showToast(`${added}件をインポートしました`);
}

function handleImportCsv(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    document.getElementById('import-result').textContent = 'ファイルが空です';
    return;
  }
  const header = rows[0].map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const iDate = idx('date');
  const iName = idx('name');
  const iCategory = idx('category');
  const iRole = idx('role');
  const iLocation = idx('location');
  const iDuration = idx('duration');
  const iAmount = idx('amount');
  const iNote = idx('note');

  if (iDate === -1 || iName === -1 || iCategory === -1 || iAmount === -1) {
    document.getElementById('import-result').textContent =
      'CSVの形式が正しくありません（date, name, category, amount 列が必要です）';
    return;
  }

  let added = 0;
  let duplicated = 0;
  let invalid = 0;

  rows.slice(1).forEach((cells) => {
    if (cells.length < 2) return;
    const date = cells[iDate]?.trim();
    const name = cells[iName]?.trim();
    const category = cells[iCategory]?.trim();
    const role = iRole !== -1 ? cells[iRole]?.trim() || undefined : undefined;
    const location = iLocation !== -1 ? cells[iLocation]?.trim() || undefined : undefined;
    const duration = iDuration !== -1 ? cells[iDuration]?.trim() || undefined : undefined;
    const amount = Number(cells[iAmount]);
    const note = iNote !== -1 ? cells[iNote]?.trim() || '' : '';

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !STAFF_NAMES.includes(name) || !['practice', 'weekend'].includes(category) || !Number.isFinite(amount)) {
      invalid++;
      return;
    }
    const isDuplicate = records.some(
      (r) => r.date === date && r.name === name && r.category === category && r.role === role && r.location === location && r.duration === duration && Number(r.amount) === amount
    );
    if (isDuplicate) {
      duplicated++;
      return;
    }
    addRecord({ date, name, category, role, location, duration, amount, note });
    added++;
  });

  persist();

  const resultLines = [`${added}件を追加しました`];
  if (duplicated > 0) resultLines.push(`（重複のためスキップ: ${duplicated}件）`);
  if (invalid > 0) resultLines.push(`（形式不正のためスキップ: ${invalid}件）`);
  document.getElementById('import-result').textContent = resultLines.join(' ');
  showToast(`${added}件をインポートしました`);
}

/* ============================================================
 * 連絡先設定（この端末のlocalStorageにのみ保存。リポジトリには含めない）
 * ============================================================ */
function initContactSettings() {
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
    input.addEventListener('input', () => {
      const target = field === 'address' ? contactsCache.addresses : contactsCache.phones;
      target[name] = input.value;
      saveContacts(contactsCache);
    });
  });

  refreshContactInputs();
}

function refreshContactInputs() {
  document.querySelectorAll('#contact-settings-body input').forEach((input) => {
    if (document.activeElement === input) return; // 入力中の欄は上書きしない
    const name = input.dataset.name;
    const field = input.dataset.field;
    const store = field === 'address' ? contactsCache.addresses : contactsCache.phones;
    input.value = store[name] || '';
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
  document.getElementById('envelope-print-area').innerHTML = '';
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
        <img class="receipt-logo-img" src="logo.png" alt="KESEN LARUS BASKETBALL CLUB">
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
 * 封筒印刷（長形3号・120x235mm、対象期間内に交通費の記録がある全員分）
 * ============================================================ */
function reiwaYearOf(y) {
  return y - 2018;
}

/* 単月なら「令和8年7月分」、複数月かつ同じ年度内なら「令和8年4月〜7月分」、
 * 年をまたぐ場合は「令和7年12月〜令和8年3月分」のように両方の年を表記する */
function formatEnvelopePeriod(startMonth, endMonth) {
  const [sy, sm] = startMonth.split('-').map(Number);
  const [ey, em] = endMonth.split('-').map(Number);
  if (startMonth === endMonth) return `令和${reiwaYearOf(sy)}年${sm}月分`;
  if (sy === ey) return `令和${reiwaYearOf(sy)}年${sm}月〜${em}月分`;
  return `令和${reiwaYearOf(sy)}年${sm}月〜令和${reiwaYearOf(ey)}年${em}月分`;
}

function populateEnvelopeMonthOptions() {
  populateMonthOptions('env-start-month', document.getElementById('env-start-month').value, false);
  populateMonthOptions('env-end-month', document.getElementById('env-end-month').value, false);
}

function buildEnvelopeEntries(startMonth, endMonth) {
  const totals = new Map(STAFF_NAMES.map((n) => [n, 0]));
  records
    .filter((r) => {
      const mk = monthKey(r.date);
      return mk >= startMonth && mk <= endMonth;
    })
    .forEach((r) => {
      totals.set(r.name, (totals.get(r.name) || 0) + (Number(r.amount) || 0));
    });
  return STAFF_NAMES.map((name) => ({ name, total: totals.get(name) || 0 })).filter((e) => e.total > 0);
}

function renderEnvelopePrintArea(entries, period) {
  document.getElementById('receipt-print-area').innerHTML = '';
  const area = document.getElementById('envelope-print-area');
  area.innerHTML = entries
    .map(
      (e) => `
      <div class="envelope-page">
        <div class="env-top">
          <img class="env-logo" src="logo.png" alt="KESEN LARUS BASKETBALL CLUB">
          <div class="env-logo-rule"></div>
        </div>
        <div class="env-mid">
          <div class="env-name-block"><div class="env-name">${escapeHtml(formatDisplayName(e.name))}<span class="sama">様</span></div></div>
          <div class="env-period-block">
            <span class="env-label">対象期間</span>
            <div class="env-period">${escapeHtml(period)}</div>
            <div class="env-fee-type">交通費</div>
          </div>
          <div class="env-amount-block"><span class="env-amount-num">${numFmt(e.total)}</span><span class="env-amount-unit">円</span></div>
        </div>
        <div class="env-footer">KESEN LARUS BASKETBALL CLUB</div>
      </div>`
    )
    .join('');
}

/* 封筒は120x235mmの長形3号だが、受領書PDF(A4想定)と@pageサイズが競合するため、
 * 印刷直前だけ動的にスタイルを差し込み、印刷後に取り除く */
function printWithEnvelopePageSize() {
  const style = document.createElement('style');
  style.textContent = '@page { size: 120mm 235mm; margin: 0; }';
  document.head.appendChild(style);
  const cleanup = () => {
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 60000);
  window.print();
}

function handleEnvelopePrintClick() {
  const start = document.getElementById('env-start-month').value;
  const end = document.getElementById('env-end-month').value;
  if (!start || !end) {
    alert('開始月・終了月を選択してください');
    return;
  }
  if (start > end) {
    alert('開始月は終了月と同じか、それより前の月を選択してください');
    return;
  }
  const entries = buildEnvelopeEntries(start, end);
  if (entries.length === 0) {
    alert('指定した期間に交通費の支給記録がありません');
    return;
  }
  renderEnvelopePrintArea(entries, formatEnvelopePeriod(start, end));
  printWithEnvelopePageSize();
}

function initEnvelope() {
  populateEnvelopeMonthOptions();
  document.getElementById('btn-envelope-print').addEventListener('click', handleEnvelopePrintClick);
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
 * ダッシュボード
 * ============================================================ */
const CATEGORY_CHART_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'];
const STAFF_CHART_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];
const FISCAL_MONTH_LABELS = ['4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月'];

/* 年度は4月始まり(その年の4月〜翌年3月)。fiscalYearOfは年度の開始年(西暦)を返す */
function fiscalYearOf(dateStr) {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  return m >= 4 ? y : y - 1;
}

function fiscalMonthIndex(dateStr) {
  const m = Number(dateStr.slice(5, 7));
  return m >= 4 ? m - 4 : m + 8;
}

function fiscalYearLabel(fy) {
  const reiwaYear = fy - 2018;
  return `令和${reiwaYear}年度（${fy}年4月〜${fy + 1}年3月）`;
}

function getFiscalYearsWithData() {
  const years = new Set(records.map((r) => fiscalYearOf(r.date)));
  years.add(fiscalYearOf(new Date().toISOString().slice(0, 10)));
  return [...years].sort((a, b) => b - a);
}

function computeAnnualData(fiscalYear) {
  const yearRecords = records.filter((r) => fiscalYearOf(r.date) === fiscalYear);

  const monthly = Array(12).fill(0);
  yearRecords.forEach((r) => {
    monthly[fiscalMonthIndex(r.date)] += Number(r.amount) || 0;
  });
  const total = monthly.reduce((a, b) => a + b, 0);
  const activeDays = new Set(yearRecords.map((r) => r.date)).size;

  const categories = RECEIPT_ROWS.map((rowDef) => ({
    label: rowDef.label,
    total: yearRecords.filter(rowDef.match).reduce((s, r) => s + (Number(r.amount) || 0), 0),
  }));

  const daysByName = new Map(STAFF_NAMES.map((n) => [n, new Set()]));
  const amountByName = new Map(STAFF_NAMES.map((n) => [n, 0]));
  yearRecords.forEach((r) => {
    daysByName.get(r.name)?.add(r.date);
    amountByName.set(r.name, (amountByName.get(r.name) || 0) + (Number(r.amount) || 0));
  });
  const staff = STAFF_NAMES.map((name) => {
    const days = daysByName.get(name).size;
    const amount = amountByName.get(name);
    const rate = activeDays === 0 ? 0 : days / activeDays;
    return { name, amount, days, rate };
  });

  const monthsWithData = monthly.filter((v) => v > 0).length;
  const monthlyAverage = monthsWithData === 0 ? 0 : Math.round(total / monthsWithData);
  const topStaff = staff.reduce((best, s) => (s.days > 0 && s.rate > (best?.rate ?? -1) ? s : best), null);

  return { fiscalYear, monthly, total, activeDays, categories, staff, monthlyAverage, topStaff };
}

function initDashboard() {
  document.getElementById('dash-year').addEventListener('change', renderDashboard);
}

function renderDashboard() {
  const yearSel = document.getElementById('dash-year');
  const years = getFiscalYearsWithData();
  const keep = yearSel.value ? Number(yearSel.value) : fiscalYearOf(new Date().toISOString().slice(0, 10));
  yearSel.innerHTML = years.map((y) => `<option value="${y}">${escapeHtml(fiscalYearLabel(y))}</option>`).join('');
  yearSel.value = years.includes(keep) ? keep : years[0];

  const data = computeAnnualData(Number(yearSel.value));
  renderDashTiles(data);
  renderMonthlyChart(data);
  renderCategoryChart(data);
  renderStaffChart(data);
}

function renderDashTiles(data) {
  const tiles = [
    { label: '年間合計費用', value: yen(data.total) },
    { label: '総活動日数', value: `${data.activeDays} 日` },
    { label: '活動月平均費用', value: yen(data.monthlyAverage), sub: '記録のある月の平均' },
    {
      label: '稼働率トップ',
      value: data.topStaff ? data.topStaff.name : '-',
      sub: data.topStaff ? `${Math.round(data.topStaff.rate * 100)}%（${data.topStaff.days}/${data.activeDays}日）` : '',
    },
  ];
  document.getElementById('dash-tiles').innerHTML = tiles
    .map(
      (t) => `
    <div class="stat-tile">
      <div class="stat-tile-label">${escapeHtml(t.label)}</div>
      <div class="stat-tile-value">${escapeHtml(String(t.value))}</div>
      ${t.sub ? `<div class="stat-tile-sub">${escapeHtml(t.sub)}</div>` : ''}
    </div>`
    )
    .join('');
}

function showChartTooltip(evt, text) {
  const tip = document.getElementById('chart-tooltip');
  tip.textContent = text;
  tip.style.left = evt.clientX + 'px';
  tip.style.top = evt.clientY + 'px';
  tip.classList.add('show');
}
function moveChartTooltip(evt) {
  const tip = document.getElementById('chart-tooltip');
  tip.style.left = evt.clientX + 'px';
  tip.style.top = evt.clientY + 'px';
}
function hideChartTooltip() {
  document.getElementById('chart-tooltip').classList.remove('show');
}

function renderBarChart(containerId, items, colors, options = {}) {
  const container = document.getElementById(containerId);
  const max = Math.max(...items.map((i) => i.value), 1);
  const showValueLabel = options.showValueLabel !== false;

  container.innerHTML = items
    .map((item, i) => {
      const heightPct = item.value > 0 ? Math.max((item.value / max) * 100, 2) : 0;
      const color = typeof colors === 'function' ? colors(i) : colors[i % colors.length];
      const tooltip = `${item.label}: ${yen(item.value)}`;
      return `
      <div class="chart-bar-col" data-tooltip="${escapeHtml(tooltip)}">
        ${showValueLabel && item.value > 0 ? `<div class="chart-bar-value">${yen(item.value)}</div>` : ''}
        <div class="chart-bar" style="height:${heightPct}%; background:${color}"></div>
        <div class="chart-bar-label">${escapeHtml(item.label)}</div>
      </div>`;
    })
    .join('');

  container.querySelectorAll('.chart-bar-col').forEach((col) => {
    col.addEventListener('mouseenter', (e) => showChartTooltip(e, col.dataset.tooltip));
    col.addEventListener('mousemove', moveChartTooltip);
    col.addEventListener('mouseleave', hideChartTooltip);
  });
}

function renderMonthlyChart(data) {
  const items = data.monthly.map((v, i) => ({ label: FISCAL_MONTH_LABELS[i], value: v }));
  renderBarChart('dash-monthly-chart', items, ['var(--primary)'], { showValueLabel: false });

  document.getElementById('dash-monthly-table').innerHTML = items
    .map((it) => `<tr><td>${escapeHtml(it.label)}</td><td class="num">${yen(it.value)}</td></tr>`)
    .join('');
}

function renderCategoryChart(data) {
  renderBarChart(
    'dash-category-chart',
    data.categories.map((c) => ({ label: c.label, value: c.total })),
    CATEGORY_CHART_COLORS
  );

  document.getElementById('dash-category-legend').innerHTML = data.categories
    .map(
      (c, i) =>
        `<span class="chart-legend-item"><span class="chart-legend-swatch" style="background:${CATEGORY_CHART_COLORS[i]}"></span>${escapeHtml(c.label)}</span>`
    )
    .join('');

  document.getElementById('dash-category-table').innerHTML = data.categories
    .map((c) => {
      const pct = data.total === 0 ? 0 : Math.round((c.total / data.total) * 100);
      return `<tr><td>${escapeHtml(c.label)}</td><td class="num">${yen(c.total)}</td><td class="num">${pct}%</td></tr>`;
    })
    .join('');
}

function renderStaffChart(data) {
  renderBarChart(
    'dash-staff-chart',
    data.staff.map((s) => ({ label: s.name, value: s.amount })),
    STAFF_CHART_COLORS
  );

  document.getElementById('dash-staff-legend').innerHTML = data.staff
    .map(
      (s, i) =>
        `<span class="chart-legend-item"><span class="chart-legend-swatch" style="background:${STAFF_CHART_COLORS[i]}"></span>${escapeHtml(s.name)}</span>`
    )
    .join('');

  document.getElementById('dash-staff-table').innerHTML = data.staff
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.name)}</td><td class="num">${yen(s.amount)}</td><td class="num">${s.days}日</td><td class="num">${Math.round(s.rate * 100)}%</td></tr>`
    )
    .join('');
}

/* ============================================================
 * 認証（共有の合言葉でFirebase Authenticationにログイン）
 * ============================================================ */
function rerenderAll() {
  renderList();
  renderSummary();
  renderDashboard();
  renderCalendar();
  populateEnvelopeMonthOptions();
}

function initAuth() {
  const loginForm = document.getElementById('login-form');
  const loginPin = document.getElementById('login-pin');
  const loginError = document.getElementById('login-error');
  const loginStatus = document.getElementById('login-status');
  const logoutBtn = document.getElementById('btn-logout');

  let unsubscribeRecords = null;
  let unsubscribeContacts = null;
  let autoLoginAttempted = false;

  const urlKey = new URLSearchParams(location.search).get('key');
  if (urlKey) {
    loginStatus.textContent = '自動ログイン中...';
  }

  function tryAutoLogin() {
    if (autoLoginAttempted || !urlKey) return;
    autoLoginAttempted = true;
    window.FirebaseData.signIn(urlKey)
      .then(() => {
        // URLバーに合言葉が残らないよう、ログイン後に取り除く
        history.replaceState(null, '', location.pathname + location.hash);
      })
      .catch((err) => {
        console.error('auto signIn failed', err);
        loginError.textContent = 'URLの合言葉が正しくありません。手動で入力してください';
      });
  }

  window.FirebaseData.onAuthChange((user) => {
    loginStatus.style.display = 'none';

    if (!user) {
      // signIn()が同じonAuthChangeコールバックを同期的に再入呼び出しするため、
      // 今回のコールバック処理が完了してから実行する
      setTimeout(tryAutoLogin, 0);
    }

    if (user) {
      document.body.classList.remove('auth-locked');
      loginError.textContent = '';
      loginPin.value = '';
      if (!unsubscribeRecords) {
        unsubscribeRecords = window.FirebaseData.subscribeRecords((recs) => {
          records = recs;
          rerenderAll();
        });
      }
      if (!unsubscribeContacts) {
        unsubscribeContacts = window.FirebaseData.subscribeContacts((c) => {
          contactsCache = c;
          refreshContactInputs();
        });
      }
    } else {
      document.body.classList.add('auth-locked');
      if (unsubscribeRecords) {
        unsubscribeRecords();
        unsubscribeRecords = null;
      }
      if (unsubscribeContacts) {
        unsubscribeContacts();
        unsubscribeContacts = null;
      }
      records = [];
      contactsCache = { addresses: {}, phones: {} };
    }
  });

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = loginPin.value;
    if (!pin) return;
    loginError.textContent = '';
    window.FirebaseData.signIn(pin).catch((err) => {
      console.error('signIn failed', err);
      loginError.textContent = '合言葉が正しくありません';
    });
  });

  logoutBtn.addEventListener('click', () => {
    window.FirebaseData.signOut();
  });
}

/* ============================================================
 * 初期化
 * ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initForm();
  initList();
  initSummary();
  initDashboard();
  initAuth();
});
