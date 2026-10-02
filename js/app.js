/* ============================================================
   Personal Travel Planning & Travel Memory Management System
   HTML + CSS + Vanilla JS + Supabase (Auth, Postgres, Storage)
   ============================================================ */
(() => {
  'use strict';

  // ---------- Жижиг туслахууд ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const view = $('#view');
  const cfg = window.APP_CONFIG || {};
  const BUCKET = cfg.STORAGE_BUCKET || 'trip-media';
  const MAX_FILE = 5 * 1024 * 1024;
  const MONTHS = ['1-р сар', '2-р сар', '3-р сар', '4-р сар', '5-р сар', '6-р сар', '7-р сар', '8-р сар', '9-р сар', '10-р сар', '11-р сар', '12-р сар'];
  const CUR = { MNT: '₮', USD: '$', EUR: '€', KRW: '₩', JPY: '¥', CNY: '¥', RUB: '₽' };
  const STATE_LABEL = { planned: 'Төлөвлөсөн', ongoing: 'Явж байгаа', completed: 'Дууссан' };
  const CAT_LABEL = { domestic: 'Дотоод', international: 'Гадаад' };
  const CHECK_TEMPLATES = ['Паспорт', 'Виз', 'Иргэний үнэмлэх', 'Мөнгө / карт', 'Утасны цэнэглэгч', 'Power bank', 'Адаптер', 'Хувцас', 'Эм тариа', 'Нарны тос', 'Шүдний сойз', 'Камер', 'Даатгал', 'Билет'];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const parseDate = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDate = (s) => (s ? s.replaceAll('-', '.') : '—');
  const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
  const tripDays = (t) => daysBetween(t.start_date, t.end_date) + 1;
  const fmtMoney = (v, cur = 'MNT') => {
    const n = Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
    return cur === 'MNT' ? `${n}₮` : `${CUR[cur] || ''}${n} ${cur}`;
  };
  const shortMoney = (v) => {
    const n = Number(v || 0);
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + ' тэрбум';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + ' сая';
    if (n >= 1e3) return Math.round(n / 1e3) + ' мянга';
    return String(n);
  };
  const tripName = (t) => t.title || t.destination;
  const tripState = (t) => {
    if (t.status === 'completed') return 'completed';
    const today = todayStr();
    return t.start_date <= today && t.end_date >= today ? 'ongoing' : 'planned';
  };
  const initial = (s) => (String(s || '?').trim()[0] || '?').toUpperCase();
  const fileExt = (f) => (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const rid = () => Math.random().toString(36).slice(2, 8);

  // ---------- Theme ----------
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('theme', t); } catch (e) { /* storage unavailable */ }
    $$('.theme-label').forEach((el) => (el.textContent = t === 'dark' ? 'Light mode' : 'Dark mode'));
  }
  $$('.theme-toggle').forEach((b) => b.addEventListener('click', () => {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }));
  applyTheme(document.documentElement.getAttribute('data-theme') || 'light');

  // ---------- Toast ----------
  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
  function errMsg(e) {
    const m = (e && (e.message || e.error_description)) || String(e);
    const map = [
      [/Invalid login credentials/i, 'Имэйл эсвэл нууц үг буруу байна.'],
      [/already registered|already been registered/i, 'Энэ имэйлээр бүртгэл үүссэн байна.'],
      [/Email not confirmed/i, 'Имэйлээ баталгаажуулаагүй байна. Ирсэн захидлаа шалгана уу.'],
      [/Password should be at least/i, 'Нууц үг хамгийн багадаа 6 тэмдэгт байна.'],
      [/rate limit|too many/i, 'Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.'],
      [/Failed to fetch|NetworkError/i, 'Сүлжээний алдаа. Интернэт холболтоо шалгана уу.'],
      [/exceeded the maximum allowed size|Payload too large/i, 'Файл хэт том байна (5MB хүртэл).'],
      [/mime type/i, 'Зөвхөн зураг (JPG, PNG, WEBP, GIF) оруулна уу.'],
    ];
    for (const [re, t] of map) if (re.test(m)) return t;
    return m;
  }

  // ---------- Тохиргоо шалгах ----------
  const configured = cfg.SUPABASE_URL && !/YOUR-PROJECT/.test(cfg.SUPABASE_URL) &&
    cfg.SUPABASE_ANON_KEY && !/YOUR-ANON/.test(cfg.SUPABASE_ANON_KEY);
  if (!window.supabase || !configured) {
    $('#boot').hidden = true;
    $('#auth-view').hidden = false;
    $('.auth-card').innerHTML = `
      <div class="brand brand-lg"><span class="brand-mark">✈</span><div><strong>Тохиргоо дутуу байна</strong><small>Supabase холбогдоогүй</small></div></div>
      <p style="margin-top:18px">${!window.supabase
        ? 'Supabase JS сан ачаалагдсангүй. Интернэт холболтоо шалгана уу.'
        : '<code>js/config.js</code> файлд өөрийн Supabase project-ийн <b>URL</b> болон <b>anon public key</b>-ийг оруулна уу. Дэлгэрэнгүйг README.md-ээс харна уу.'}</p>`;
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // ---------- Төлөв ----------
  const state = {
    user: null,
    trips: [],
    checkStats: {},          // tripId -> {done, total}
    urls: {},                // storage path -> signed url
    filters: { category: 'all', status: 'all', q: '', sort: 'date-desc' },
    historyYear: null,
    historyMonth: null,
    detail: null,            // {trip, items, memories, photos}
    detailTab: 'checklist',
  };

  // ============================================================
  // AUTH
  // ============================================================
  const authMsg = (t, cls = '') => { const el = $('#auth-msg'); el.textContent = t; el.className = `auth-msg ${cls}`; };

  $$('[data-auth-tab]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-auth-tab]').forEach((x) => x.classList.toggle('active', x === b));
    $('#login-form').hidden = b.dataset.authTab !== 'login';
    $('#register-form').hidden = b.dataset.authTab !== 'register';
    authMsg('');
  }));

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('[type=submit]');
    btn.disabled = true; authMsg('');
    const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    btn.disabled = false;
    if (error) authMsg(errMsg(error), 'err');
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('[type=submit]');
    if (f.password.value !== f.password2.value) return authMsg('Нууц үг таарахгүй байна.', 'err');
    btn.disabled = true; authMsg('');
    const { data, error } = await sb.auth.signUp({
      email: f.email.value.trim(),
      password: f.password.value,
      options: { data: { full_name: f.name.value.trim() }, emailRedirectTo: location.origin + location.pathname },
    });
    btn.disabled = false;
    if (error) return authMsg(errMsg(error), 'err');
    if (!data.session) {
      authMsg('Бүртгэл амжилттай! Имэйл рүү илгээсэн холбоосоор баталгаажуулаад нэвтэрнэ үү.', 'ok');
      f.reset();
    }
  });

  $('#forgot-btn').addEventListener('click', async () => {
    const email = $('#login-form').email.value.trim();
    if (!email) return authMsg('Эхлээд имэйлээ бичнэ үү.', 'err');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) return authMsg(errMsg(error), 'err');
    authMsg('Нууц үг сэргээх холбоосыг имэйл рүү илгээлээ.', 'ok');
  });

  $('#logout-btn').addEventListener('click', async () => {
    await sb.auth.signOut();
  });

  function openPasswordReset() {
    openModal('Шинэ нууц үг тохируулах', `
      <form class="form" id="pw-form">
        <label>Шинэ нууц үг<input type="password" name="pw" required minlength="6" autocomplete="new-password" /></label>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Хадгалах</button></div>
      </form>`);
    $('#pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.updateUser({ password: e.target.pw.value });
      if (error) return toast(errMsg(error), 'err');
      closeModal(); toast('Нууц үг шинэчлэгдлээ');
    });
  }

  async function handleSession(session) {
    const user = session?.user || null;
    $('#boot').hidden = true;
    if (!user) {
      state.user = null; state.trips = []; state.urls = {};
      $('#app-view').hidden = true;
      $('#auth-view').hidden = false;
      return;
    }
    if (state.user?.id === user.id) return;
    state.user = user;
    const name = user.user_metadata?.full_name || user.email.split('@')[0];
    $('#user-name').textContent = name;
    $('#user-email').textContent = user.email;
    $('#user-avatar').textContent = initial(name);
    $('#auth-view').hidden = true;
    $('#app-view').hidden = false;
    view.innerHTML = '<div class="skeleton" style="height:120px"></div>';
    await loadTrips();
    route();
  }

  sb.auth.onAuthStateChange((event, session) => {
    // Supabase-ийн callback дотор шууд await хийхгүйн тулд setTimeout
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') openPasswordReset();
      handleSession(session);
    }, 0);
  });

  // ============================================================
  // ӨГӨГДӨЛ
  // ============================================================
  async function loadTrips() {
    const [{ data: trips, error }, { data: items, error: e2 }] = await Promise.all([
      sb.from('trips').select('*').order('start_date', { ascending: false }),
      sb.from('checklist_items').select('trip_id,is_done'),
    ]);
    if (error || e2) { toast(errMsg(error || e2), 'err'); return; }
    state.trips = trips || [];
    state.checkStats = {};
    (items || []).forEach((i) => {
      const s = (state.checkStats[i.trip_id] ||= { done: 0, total: 0 });
      s.total++; if (i.is_done) s.done++;
    });
    await signUrls(state.trips.map((t) => t.cover_path));
  }

  async function signUrls(paths) {
    const need = [...new Set(paths.filter((p) => p && !state.urls[p]))];
    if (!need.length) return;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need, 60 * 60 * 6);
    if (error) return;
    (data || []).forEach((d) => { if (d.signedUrl) state.urls[d.path] = d.signedUrl; });
  }
  const url = (p) => (p && state.urls[p]) || '';

  async function uploadImage(file, tripId, kind) {
    if (!file.type.startsWith('image/')) throw new Error('Зөвхөн зураг оруулна уу.');
    if (file.size > MAX_FILE) throw new Error(`"${file.name}" 5MB-аас том байна.`);
    const path = `${state.user.id}/${tripId}/${kind}-${Date.now()}-${rid()}.${fileExt(file)}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return path;
  }
  async function removeFiles(paths) {
    const p = [...new Set(paths.filter(Boolean))];
    if (p.length) await sb.storage.from(BUCKET).remove(p);
  }

  // ============================================================
  // ROUTER
  // ============================================================
  function route() {
    if (!state.user) return;
    const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const [page, id] = hash.split('/');
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === page || (page === 'trip' && a.dataset.nav === 'trips')));
    closeSidebar();
    window.scrollTo(0, 0);
    if (page === 'trips') renderTrips();
    else if (page === 'timeline') renderTimeline();
    else if (page === 'history') renderHistory();
    else if (page === 'trip' && id) renderTripDetail(id);
    else renderDashboard();
  }
  window.addEventListener('hashchange', route);

  // Mobile цэс
  const closeSidebar = () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); };
  $('#menu-btn').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); });
  $('#scrim').addEventListener('click', closeSidebar);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="new-trip"]')) { closeSidebar(); openTripForm(); }
  });

  // ============================================================
  // ХУВААЛЦСАН UI ХЭСГҮҮД
  // ============================================================
  const badges = (t) => {
    const st = tripState(t);
    return `<span class="badge b-${t.category}">${CAT_LABEL[t.category]}</span><span class="badge b-${st}">${STATE_LABEL[st]}</span>`;
  };
  const coverStyle = (t) => (url(t.cover_path) ? `style="background-image:url('${esc(url(t.cover_path))}')"` : '');

  function progressRow(t) {
    const s = state.checkStats[t.id];
    if (!s || !s.total) return '';
    const pct = Math.round((s.done / s.total) * 100);
    return `<div class="progress-row"><span>Checklist</span><div class="progress"><span style="width:${pct}%"></span></div><span>${s.done}/${s.total}</span></div>`;
  }

  function tripCard(t) {
    const hasCover = !!url(t.cover_path);
    return `
      <a class="card trip-card" href="#/trip/${t.id}">
        <div class="trip-cover ${t.category === 'international' ? 'intl' : ''}" ${coverStyle(t)}>
          ${hasCover ? '' : `<span class="initial">${esc(initial(t.destination))}</span>`}
          <div class="badges">${badges(t)}</div>
        </div>
        <div class="trip-body">
          <h3>${esc(tripName(t))}</h3>
          <div class="trip-meta">
            <span>📍 ${esc(t.destination)}${t.country ? ', ' + esc(t.country) : ''}</span>
          </div>
          <div class="trip-meta">
            <span>🗓 ${fmtDate(t.start_date)} – ${fmtDate(t.end_date)}</span>
            <span>${tripDays(t)} хоног</span>
          </div>
          <div class="trip-meta"><span>💰 ${fmtMoney(t.budget, t.currency)}</span></div>
          ${progressRow(t)}
        </div>
      </a>`;
  }

  const emptyState = (icon, title, text, withBtn = true) => `
    <div class="card empty">
      <div class="big">${icon}</div>
      <h3>${title}</h3>
      <p>${text}</p>
      ${withBtn ? '<button class="btn btn-primary" data-action="new-trip">+ Шинэ аялал нэмэх</button>' : ''}
    </div>`;

  function applyFilters(list, { withStatus = true } = {}) {
    const f = state.filters;
    const q = f.q.trim().toLowerCase();
    return list.filter((t) => {
      if (f.category !== 'all' && t.category !== f.category) return false;
      if (withStatus && f.status !== 'all') {
        if (f.status === 'completed' && t.status !== 'completed') return false;
        if (f.status === 'planned' && t.status === 'completed') return false;
      }
      if (q && ![t.title, t.destination, t.country, t.notes].some((x) => (x || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function filterBar({ search = true, status = true, sort = false } = {}) {
    const f = state.filters;
    const seg = (key, opts) => `<div class="seg" data-filter="${key}">${opts.map(([v, l]) =>
      `<button type="button" data-v="${v}" class="${f[key] === v ? 'active' : ''}">${l}</button>`).join('')}</div>`;
    return `
      <div class="toolbar">
        ${search ? `<input type="search" id="q" placeholder="Хайх: газар, улс…" value="${esc(f.q)}" />` : ''}
        ${seg('category', [['all', 'Бүгд'], ['domestic', 'Дотоод'], ['international', 'Гадаад']])}
        ${status ? seg('status', [['all', 'Бүх төлөв'], ['planned', 'Төлөвлөсөн'], ['completed', 'Дууссан']]) : ''}
        ${sort ? `<select id="sort" aria-label="Эрэмбэлэх">
          <option value="date-desc" ${f.sort === 'date-desc' ? 'selected' : ''}>Огноо: шинэ → хуучин</option>
          <option value="date-asc" ${f.sort === 'date-asc' ? 'selected' : ''}>Огноо: хуучин → шинэ</option>
          <option value="budget-desc" ${f.sort === 'budget-desc' ? 'selected' : ''}>Төсөв: их → бага</option>
          <option value="name" ${f.sort === 'name' ? 'selected' : ''}>Нэрээр</option>
        </select>` : ''}
      </div>`;
  }
  function bindFilterBar(rerender) {
    $$('[data-filter]', view).forEach((seg) => seg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      state.filters[seg.dataset.filter] = b.dataset.v; rerender();
    }));
    const q = $('#q', view);
    if (q) q.addEventListener('input', () => {
      state.filters.q = q.value;
      const pos = q.selectionStart; rerender();
      const nq = $('#q', view); nq.focus(); nq.setSelectionRange(pos, pos);
    });
    const s = $('#sort', view);
    if (s) s.addEventListener('change', () => { state.filters.sort = s.value; rerender(); });
  }

  // ============================================================
  // НҮҮР (DASHBOARD)
  // ============================================================
  function renderDashboard() {
    const trips = state.trips;
    const today = todayStr();
    const completed = trips.filter((t) => t.status === 'completed');
    const upcoming = trips.filter((t) => t.status !== 'completed' && t.end_date >= today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
    const mnt = trips.filter((t) => t.currency === 'MNT');
    const budgetMnt = mnt.reduce((s, t) => s + Number(t.budget || 0), 0);
    const others = trips.length - mnt.length;
    const countries = new Set(completed.filter((t) => t.category === 'international' && t.country).map((t) => t.country.trim().toLowerCase()));
    const intlCount = trips.filter((t) => t.category === 'international').length;
    const name = $('#user-name').textContent;
    const next = upcoming[0];

    let heroHtml;
    if (next) {
      const d = daysBetween(today, next.start_date);
      heroHtml = `
        <a class="hero" href="#/trip/${next.id}" ${coverStyle(next)}>
          <div class="countdown">${d > 0 ? `<b>${d}</b><small>хоног үлдлээ</small>` : '<b>🧳</b><small>Явж байна</small>'}</div>
          <span class="hero-kicker">Дараагийн аялал</span>
          <h2>${esc(tripName(next))}</h2>
          <div class="hero-meta">
            <span>📍 ${esc(next.destination)}${next.country ? ', ' + esc(next.country) : ''}</span>
            <span>🗓 ${fmtDate(next.start_date)} – ${fmtDate(next.end_date)}</span>
            <span>💰 ${fmtMoney(next.budget, next.currency)}</span>
          </div>
        </a>`;
    } else {
      heroHtml = emptyState('🗺️', 'Удахгүй болох аялал алга', 'Дараагийн адал явдлаа төлөвлөөд эхлээрэй.');
    }

    const needsComplete = trips.filter((t) => t.status !== 'completed' && t.end_date < today);
    const recent = [...completed].sort((a, b) => b.end_date.localeCompare(a.end_date)).slice(0, 5);

    view.innerHTML = `
      <div class="page-head">
        <div><h1>Сайн байна уу, ${esc(name)} 👋</h1><p>Таны аяллын ерөнхий тойм</p></div>
        <div class="page-actions"><button class="btn btn-primary" data-action="new-trip">+ Шинэ аялал</button></div>
      </div>

      <div class="stats">
        <div class="card stat"><div class="stat-label">Нийт аялал</div><div class="stat-value">${trips.length}</div><div class="stat-sub">${intlCount} гадаад · ${trips.length - intlCount} дотоод</div></div>
        <div class="card stat"><div class="stat-label">Дууссан</div><div class="stat-value">${completed.length}</div><div class="stat-sub">${upcoming.length} удахгүй болох</div></div>
        <div class="card stat"><div class="stat-label">Очсон улс</div><div class="stat-value">${countries.size}</div><div class="stat-sub">гадаад аяллаар</div></div>
        <div class="card stat"><div class="stat-label">Нийт төсөв</div><div class="stat-value">${shortMoney(budgetMnt)}₮</div><div class="stat-sub">${others ? `+ ${others} аялал өөр валютаар` : 'бүх аялал'}</div></div>
      </div>

      ${needsComplete.length ? `<div class="notice">✅ <b>${needsComplete.length}</b> аяллын хугацаа дууссан байна. Дуусгасан гэж тэмдэглээд дурсамжаа нэмээрэй:
        ${needsComplete.slice(0, 3).map((t) => `<a href="#/trip/${t.id}">${esc(tripName(t))}</a>`).join(', ')}</div>` : ''}

      <div class="dash-grid">
        <div style="display:grid;gap:18px;align-content:start">
          ${heroHtml}
          <div class="card card-pad">
            <div class="card-title">Удахгүй болох аяллууд <a href="#/trips" class="btn btn-ghost btn-sm">Бүгдийг харах →</a></div>
            ${upcoming.length ? `<div class="mini-list">${upcoming.slice(0, 5).map(miniItem).join('')}</div>`
              : '<p class="muted">Төлөвлөсөн аялал алга.</p>'}
          </div>
        </div>
        <div class="card card-pad">
          <div class="card-title">Сүүлийн дурсамжууд <a href="#/timeline" class="btn btn-ghost btn-sm">Timeline →</a></div>
          ${recent.length ? `<div class="mini-list">${recent.map(miniItem).join('')}</div>`
            : '<p class="muted">Дууссан аялал хараахан алга. Аяллаа дуусгасны дараа энд харагдана.</p>'}
        </div>
      </div>`;
  }

  function miniItem(t) {
    const u = url(t.cover_path);
    return `<a class="mini-item" href="#/trip/${t.id}">
      <div class="mini-thumb" ${u ? `style="background-image:url('${esc(u)}')"` : ''}>${u ? '' : esc(initial(t.destination))}</div>
      <div class="mini-body"><strong>${esc(tripName(t))}</strong><small>${fmtDate(t.start_date)} · ${tripDays(t)} хоног</small></div>
      <span class="badge b-${t.category}">${CAT_LABEL[t.category]}</span>
    </a>`;
  }

  // ============================================================
  // АЯЛЛУУД (LIST VIEW)
  // ============================================================
  function renderTrips() {
    const list = applyFilters(state.trips);
    const sorters = {
      'date-desc': (a, b) => b.start_date.localeCompare(a.start_date),
      'date-asc': (a, b) => a.start_date.localeCompare(b.start_date),
      'budget-desc': (a, b) => Number(b.budget) - Number(a.budget),
      name: (a, b) => tripName(a).localeCompare(tripName(b)),
    };
    list.sort(sorters[state.filters.sort] || sorters['date-desc']);
    view.innerHTML = `
      <div class="page-head">
        <div><h1>Аяллууд</h1><p>${list.length} / ${state.trips.length} аялал</p></div>
        <div class="page-actions"><button class="btn btn-primary" data-action="new-trip">+ Шинэ аялал</button></div>
      </div>
      ${filterBar({ sort: true })}
      ${state.trips.length === 0
        ? emptyState('🧭', 'Аялал хараахан алга', 'Эхний аяллаа төлөвлөөд эхлээрэй — газар, огноо, төсвөө оруулна.')
        : list.length === 0
          ? emptyState('🔍', 'Илэрц олдсонгүй', 'Шүүлтүүрээ өөрчилж үзнэ үү.', false)
          : `<div class="trip-grid">${list.map(tripCard).join('')}</div>`}`;
    bindFilterBar(renderTrips);
  }

  // ============================================================
  // TIMELINE
  // ============================================================
  function renderTimeline() {
    const list = applyFilters(state.trips).sort((a, b) => b.start_date.localeCompare(a.start_date));
    const byYear = {};
    list.forEach((t) => (byYear[t.start_date.slice(0, 4)] ||= []).push(t));
    const years = Object.keys(byYear).sort((a, b) => b - a);
    view.innerHTML = `
      <div class="page-head"><div><h1>Timeline</h1><p>Аяллууд цаг хугацааны дарааллаар</p></div></div>
      ${filterBar()}
      ${years.length === 0
        ? (state.trips.length ? emptyState('🔍', 'Илэрц олдсонгүй', 'Шүүлтүүрээ өөрчилж үзнэ үү.', false)
          : emptyState('🕰️', 'Timeline хоосон байна', 'Аялал нэмэхэд энд цагийн дарааллаар харагдана.'))
        : years.map((y) => `
          <div class="tl-year">${y} <small>${byYear[y].length} аялал</small></div>
          <div class="timeline">
            ${byYear[y].map((t) => {
              const st = tripState(t); const u = url(t.cover_path);
              return `<div class="tl-item">
                <span class="tl-dot ${st}"></span>
                <a class="card tl-card" href="#/trip/${t.id}">
                  <div class="tl-thumb" ${u ? `style="background-image:url('${esc(u)}')"` : ''}>${u ? '' : esc(initial(t.destination))}</div>
                  <div style="min-width:0">
                    <div class="tl-date">${MONTHS[parseDate(t.start_date).getMonth()]} ${parseDate(t.start_date).getDate()} · ${tripDays(t)} хоног</div>
                    <h3>${esc(tripName(t))}</h3>
                    <div class="row">${badges(t)}<span class="muted" style="font-size:13px">📍 ${esc(t.destination)}${t.country ? ', ' + esc(t.country) : ''}</span></div>
                  </div>
                </a>
              </div>`;
            }).join('')}
          </div>`).join('')}`;
    bindFilterBar(renderTimeline);
  }

  // ============================================================
  // ТҮҮХ (САР, ЖИЛЭЭР)
  // ============================================================
  function renderHistory() {
    const list = applyFilters(state.trips, { withStatus: true });
    const years = [...new Set(state.trips.map((t) => +t.start_date.slice(0, 4)))].sort((a, b) => b - a);
    if (!years.length) {
      view.innerHTML = `<div class="page-head"><div><h1>Аяллын түүх</h1><p>Сар, жилээр</p></div></div>
        ${emptyState('📅', 'Түүх хоосон байна', 'Аялал нэмэхэд сар, жилээр ангилагдан харагдана.')}`;
      return;
    }
    if (!years.includes(state.historyYear)) { state.historyYear = years[0]; state.historyMonth = null; }
    const Y = state.historyYear;
    const yearTrips = list.filter((t) => +t.start_date.slice(0, 4) === Y);
    const counts = Array(12).fill(0);
    yearTrips.forEach((t) => counts[parseDate(t.start_date).getMonth()]++);
    const shown = state.historyMonth === null ? yearTrips : yearTrips.filter((t) => parseDate(t.start_date).getMonth() === state.historyMonth);
    const byMonth = {};
    shown.sort((a, b) => a.start_date.localeCompare(b.start_date)).forEach((t) => (byMonth[parseDate(t.start_date).getMonth()] ||= []).push(t));
    const days = yearTrips.reduce((s, t) => s + tripDays(t), 0);
    const budget = yearTrips.filter((t) => t.currency === 'MNT').reduce((s, t) => s + Number(t.budget || 0), 0);
    const yearCount = (y) => list.filter((t) => +t.start_date.slice(0, 4) === y).length;

    view.innerHTML = `
      <div class="page-head"><div><h1>Аяллын түүх</h1><p>Сар, жилээр ангилсан</p></div></div>
      ${filterBar({ search: false })}
      <div class="toolbar"><div class="seg" id="years">${years.map((y) =>
        `<button type="button" data-y="${y}" class="${y === Y ? 'active' : ''}">${y} (${yearCount(y)})</button>`).join('')}</div></div>

      <div class="stats">
        <div class="card stat"><div class="stat-label">${Y} онд</div><div class="stat-value">${yearTrips.length}</div><div class="stat-sub">аялал</div></div>
        <div class="card stat"><div class="stat-label">Дууссан</div><div class="stat-value">${yearTrips.filter((t) => t.status === 'completed').length}</div><div class="stat-sub">аялал</div></div>
        <div class="card stat"><div class="stat-label">Аялсан хоног</div><div class="stat-value">${days}</div><div class="stat-sub">нийт</div></div>
        <div class="card stat"><div class="stat-label">Төсөв</div><div class="stat-value">${shortMoney(budget)}₮</div><div class="stat-sub">₮-өөр төлөвлөсөн</div></div>
      </div>

      <div class="months" id="months">
        ${MONTHS.map((m, i) => `<button type="button" class="month ${state.historyMonth === i ? 'active' : ''} ${counts[i] ? '' : 'none'}" data-m="${i}">
          <div class="m-count">${counts[i]}</div><div class="m-name">${m}</div></button>`).join('')}
      </div>

      <div class="card-title" style="margin-bottom:0">${state.historyMonth === null ? `${Y} оны бүх аялал` : `${Y} оны ${MONTHS[state.historyMonth]}`}
        ${state.historyMonth !== null ? '<button class="btn btn-ghost btn-sm" id="all-months">Бүх сар</button>' : ''}</div>
      ${shown.length === 0 ? '<p class="muted">Энэ хугацаанд аялал алга.</p>'
        : Object.keys(byMonth).sort((a, b) => a - b).map((m) => `
          <div class="month-group"><h3>${MONTHS[m]}</h3><div class="mini-list card card-pad" style="padding:8px">${byMonth[m].map(historyItem).join('')}</div></div>`).join('')}`;

    bindFilterBar(renderHistory);
    $('#years').addEventListener('click', (e) => {
      const b = e.target.closest('[data-y]'); if (!b) return;
      state.historyYear = +b.dataset.y; state.historyMonth = null; renderHistory();
    });
    $('#months').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      const m = +b.dataset.m; state.historyMonth = state.historyMonth === m ? null : m; renderHistory();
    });
    $('#all-months')?.addEventListener('click', () => { state.historyMonth = null; renderHistory(); });
  }

  function historyItem(t) {
    const u = url(t.cover_path); const st = tripState(t);
    return `<a class="mini-item" href="#/trip/${t.id}">
      <div class="mini-thumb" ${u ? `style="background-image:url('${esc(u)}')"` : ''}>${u ? '' : esc(initial(t.destination))}</div>
      <div class="mini-body"><strong>${esc(tripName(t))}</strong><small>${fmtDate(t.start_date)} – ${fmtDate(t.end_date)} · ${esc(t.destination)}</small></div>
      <div class="mini-badges"><span class="badge b-${t.category}">${CAT_LABEL[t.category]}</span><span class="badge b-${st}">${STATE_LABEL[st]}</span></div>
    </a>`;
  }

  // ============================================================
  // АЯЛЛЫН ДЭЛГЭРЭНГҮЙ
  // ============================================================
  async function renderTripDetail(id) {
    const trip = state.trips.find((t) => t.id === id);
    if (!trip) {
      view.innerHTML = emptyState('🤷', 'Аялал олдсонгүй', 'Устгагдсан эсвэл холбоос буруу байна.', false);
      return;
    }
    if (state.detail?.trip.id !== id) state.detailTab = trip.status === 'completed' ? 'memories' : 'checklist';
    view.innerHTML = '<div class="skeleton" style="height:240px;margin-bottom:18px"></div><div class="skeleton" style="height:300px"></div>';
    const [items, memories, photos] = await Promise.all([
      sb.from('checklist_items').select('*').eq('trip_id', id).order('created_at'),
      sb.from('memories').select('*').eq('trip_id', id).order('memory_date', { ascending: false }).order('created_at', { ascending: false }),
      sb.from('photos').select('*').eq('trip_id', id).order('created_at', { ascending: false }),
    ]);
    const err = items.error || memories.error || photos.error;
    if (err) { toast(errMsg(err), 'err'); return; }
    await signUrls((photos.data || []).map((p) => p.path));
    // Хэрэглэгч энэ хооронд өөр хуудас руу шилжсэн бол зогсооно
    if (!location.hash.endsWith(id)) return;
    state.detail = { trip, items: items.data || [], memories: memories.data || [], photos: photos.data || [] };
    drawDetail();
  }

  function drawDetail() {
    const { trip: t, items, memories, photos } = state.detail;
    const st = tripState(t);
    const done = items.filter((i) => i.is_done).length;
    const pct = items.length ? Math.round((done / items.length) * 100) : 0;
    const today = todayStr();
    const until = daysBetween(today, t.start_date);
    const tab = state.detailTab;

    view.innerHTML = `
      <div class="detail-hero" ${coverStyle(t)}>
        <div class="hero-top">
          <a class="btn btn-sm glass" href="#/trips">← Буцах</a>
          <div class="row">
            <button class="btn btn-sm glass" id="cover-btn">🖼 Cover солих</button>
            <input type="file" id="cover-input" accept="image/*" hidden />
          </div>
        </div>
        <div class="row">${badges(t)}</div>
        <h1>${esc(tripName(t))}</h1>
        <div class="hero-meta">
          <span>📍 ${esc(t.destination)}${t.country ? ', ' + esc(t.country) : ''}</span>
          <span>🗓 ${fmtDate(t.start_date)} – ${fmtDate(t.end_date)} (${tripDays(t)} хоног)</span>
          <span>💰 ${fmtMoney(t.budget, t.currency)}</span>
        </div>
      </div>

      <div class="detail-grid">
        <div>
          <div class="tabs detail-tabs" id="detail-tabs">
            <button class="tab ${tab === 'checklist' ? 'active' : ''}" data-tab="checklist">Checklist (${done}/${items.length})</button>
            <button class="tab ${tab === 'memories' ? 'active' : ''}" data-tab="memories">Тэмдэглэл (${memories.length})</button>
            <button class="tab ${tab === 'photos' ? 'active' : ''}" data-tab="photos">Зураг (${photos.length})</button>
          </div>
          <div class="card card-pad" id="tab-panel">
            ${tab === 'checklist' ? checklistPanel(items, pct) : tab === 'memories' ? memoriesPanel(t, memories) : photosPanel(t, photos)}
          </div>
        </div>

        <aside class="card card-pad">
          <div class="card-title">Аяллын мэдээлэл</div>
          <div class="info-list">
            <div><span>Төлөв</span><b><span class="badge b-${st}">${STATE_LABEL[st]}</span></b></div>
            <div><span>Ангилал</span><b>${CAT_LABEL[t.category]}</b></div>
            <div><span>Очих газар</span><b>${esc(t.destination)}</b></div>
            ${t.country ? `<div><span>Улс</span><b>${esc(t.country)}</b></div>` : ''}
            <div><span>Эхлэх</span><b>${fmtDate(t.start_date)}</b></div>
            <div><span>Дуусах</span><b>${fmtDate(t.end_date)}</b></div>
            <div><span>Хугацаа</span><b>${tripDays(t)} хоног</b></div>
            <div><span>Төсөв</span><b>${fmtMoney(t.budget, t.currency)}</b></div>
            ${st === 'planned' && until > 0 ? `<div><span>Эхлэх хүртэл</span><b>${until} хоног</b></div>` : ''}
            ${t.completed_at ? `<div><span>Дуусгасан</span><b>${fmtDate(t.completed_at.slice(0, 10))}</b></div>` : ''}
          </div>
          ${t.notes ? `<div class="notes-box">${esc(t.notes)}</div>` : ''}
          <div class="side-actions">
            ${t.status === 'completed'
              ? '<button class="btn" id="complete-btn">↺ Төлөвлөсөн болгох</button>'
              : '<button class="btn btn-ok" id="complete-btn">✓ Completed гэж тэмдэглэх</button>'}
            <button class="btn" id="edit-btn">✎ Засах</button>
            <button class="btn btn-danger" id="delete-btn">🗑 Устгах</button>
          </div>
        </aside>
      </div>`;

    $('#detail-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]'); if (!b) return;
      state.detailTab = b.dataset.tab; drawDetail();
    });
    $('#edit-btn').addEventListener('click', () => openTripForm(t));
    $('#delete-btn').addEventListener('click', () => deleteTrip(t));
    $('#complete-btn').addEventListener('click', () => toggleComplete(t));
    $('#cover-btn').addEventListener('click', () => $('#cover-input').click());
    $('#cover-input').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      await setCoverFromFile(t, f);
    });

    if (tab === 'checklist') bindChecklist();
    else if (tab === 'memories') bindMemories();
    else bindPhotos();
  }

  // ---------- Checklist ----------
  function checklistPanel(items, pct) {
    const existing = new Set(items.map((i) => i.text.toLowerCase()));
    const sugg = CHECK_TEMPLATES.filter((x) => !existing.has(x.toLowerCase()));
    return `
      <div class="card-title">Авч явах зүйлс <span class="muted" style="font-weight:500;font-size:13px">${pct}% бэлэн</span></div>
      <div class="progress" style="margin-bottom:14px"><span style="width:${pct}%"></span></div>
      <form class="check-add" id="check-form">
        <input type="text" name="text" placeholder="Жишээ: Паспорт, цэнэглэгч…" maxlength="200" required autocomplete="off" />
        <button class="btn btn-primary" type="submit">Нэмэх</button>
      </form>
      ${sugg.length ? `<div class="chips">${sugg.map((s) => `<button type="button" class="chip" data-sugg="${esc(s)}">+ ${esc(s)}</button>`).join('')}</div>` : ''}
      ${items.length === 0 ? '<p class="muted">Жагсаалт хоосон байна. Дээрээс нэмнэ үү эсвэл санал болгосон зүйлс дээр дарна уу.</p>' : `
      <ul class="check-list">
        ${items.map((i) => `
          <li class="check-item ${i.is_done ? 'done' : ''}" data-id="${i.id}">
            <input type="checkbox" id="ci-${i.id}" ${i.is_done ? 'checked' : ''} />
            <label for="ci-${i.id}">${esc(i.text)}</label>
            <button class="icon-btn" data-del aria-label="Устгах">✕</button>
          </li>`).join('')}
      </ul>`}`;
  }

  function bindChecklist() {
    const d = state.detail;
    const add = async (text) => {
      text = text.trim(); if (!text) return;
      const { data, error } = await sb.from('checklist_items').insert({ trip_id: d.trip.id, text }).select().single();
      if (error) return toast(errMsg(error), 'err');
      d.items.push(data); bumpStats(d.trip.id, 1, 0);
      drawDetail(); $('#check-form input')?.focus();
    };
    $('#check-form').addEventListener('submit', (e) => { e.preventDefault(); add(e.target.text.value); });
    $$('[data-sugg]').forEach((b) => b.addEventListener('click', () => add(b.dataset.sugg)));
    $$('.check-item').forEach((li) => {
      const item = d.items.find((i) => i.id === li.dataset.id);
      li.querySelector('input').addEventListener('change', async (e) => {
        const val = e.target.checked;
        const { error } = await sb.from('checklist_items').update({ is_done: val }).eq('id', item.id);
        if (error) { e.target.checked = !val; return toast(errMsg(error), 'err'); }
        item.is_done = val; bumpStats(d.trip.id, 0, val ? 1 : -1); drawDetail();
      });
      li.querySelector('[data-del]').addEventListener('click', async () => {
        const { error } = await sb.from('checklist_items').delete().eq('id', item.id);
        if (error) return toast(errMsg(error), 'err');
        d.items = d.items.filter((i) => i !== item); bumpStats(d.trip.id, -1, item.is_done ? -1 : 0); drawDetail();
      });
    });
  }
  function bumpStats(tripId, dTotal, dDone) {
    const s = (state.checkStats[tripId] ||= { done: 0, total: 0 });
    s.total += dTotal; s.done += dDone;
  }

  // ---------- Тэмдэглэл (memory log) ----------
  function memoriesPanel(t, memories) {
    const defDate = todayStr() < t.start_date ? t.start_date : (todayStr() > t.end_date ? t.end_date : todayStr());
    return `
      <div class="card-title">Дурсамжийн тэмдэглэл</div>
      ${t.status !== 'completed' ? '<div class="notice">💡 Аяллын үеэр эсвэл дараа нь сэтгэгдэл, түүхээ энд тэмдэглээрэй.</div>' : ''}
      <form class="form" id="memory-form">
        <div class="form-row">
          <label>Огноо<input type="date" name="date" value="${defDate}" required /></label>
          <span></span>
        </div>
        <label>Тэмдэглэл<textarea name="note" required maxlength="5000" placeholder="Өнөөдөр юу хийсэн, юу мэдэрсэн бэ…"></textarea></label>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Тэмдэглэл нэмэх</button></div>
      </form>
      <div class="memory-list">
        ${memories.length === 0 ? '<p class="muted">Тэмдэглэл хараахан алга.</p>' : memories.map((m) => `
          <div class="card memory" data-id="${m.id}">
            <div class="memory-head"><span>📝 ${fmtDate(m.memory_date)}</span><button class="icon-btn" data-del aria-label="Устгах" style="width:28px;height:28px;font-size:13px">✕</button></div>
            <p>${esc(m.note)}</p>
          </div>`).join('')}
      </div>`;
  }
  function bindMemories() {
    const d = state.detail;
    $('#memory-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target, btn = f.querySelector('[type=submit]'); btn.disabled = true;
      const { data, error } = await sb.from('memories').insert({ trip_id: d.trip.id, memory_date: f.date.value, note: f.note.value.trim() }).select().single();
      btn.disabled = false;
      if (error) return toast(errMsg(error), 'err');
      d.memories.unshift(data);
      d.memories.sort((a, b) => b.memory_date.localeCompare(a.memory_date));
      toast('Тэмдэглэл нэмэгдлээ'); drawDetail();
    });
    $$('.memory').forEach((el) => el.querySelector('[data-del]').addEventListener('click', async () => {
      if (!(await confirmModal('Энэ тэмдэглэлийг устгах уу?'))) return;
      const { error } = await sb.from('memories').delete().eq('id', el.dataset.id);
      if (error) return toast(errMsg(error), 'err');
      d.memories = d.memories.filter((m) => m.id !== el.dataset.id); drawDetail();
    }));
  }

  // ---------- Зургууд ----------
  function photosPanel(t, photos) {
    return `
      <div class="card-title">Зургийн цомог</div>
      <label class="upload-zone" id="drop">
        <input type="file" id="photo-input" accept="image/*" multiple />
        <span>📷 Зураг сонгох эсвэл энд чирч оруулах <span class="hint">(JPG/PNG/WEBP, 5MB хүртэл)</span></span>
      </label>
      <div id="upload-status" class="hint" style="margin-top:8px"></div>
      ${photos.length === 0 ? '<p class="muted" style="margin-top:14px">Зураг хараахан алга.</p>' : `
      <div class="photo-grid">
        ${photos.map((p) => `
          <figure class="photo" data-id="${p.id}" style="margin:0">
            <img src="${esc(url(p.path))}" alt="${esc(p.caption || tripName(t))}" loading="lazy" />
            <button class="icon-btn del" data-del aria-label="Устгах" title="Устгах">✕</button>
            <button class="icon-btn del" data-cover title="Cover болгох" style="right:40px">★</button>
            ${t.cover_path === p.path ? '<figcaption>★ Cover зураг</figcaption>' : ''}
          </figure>`).join('')}
      </div>`}`;
  }
  function bindPhotos() {
    const d = state.detail;
    const input = $('#photo-input'), drop = $('#drop');
    const handle = async (files) => {
      files = [...files].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      const status = $('#upload-status');
      let ok = 0;
      for (const [i, f] of files.entries()) {
        status.textContent = `Хуулж байна… ${i + 1}/${files.length}`;
        try {
          const path = await uploadImage(f, d.trip.id, 'photo');
          const { data, error } = await sb.from('photos').insert({ trip_id: d.trip.id, path }).select().single();
          if (error) { await removeFiles([path]); throw error; }
          d.photos.unshift(data); ok++;
        } catch (e) { toast(errMsg(e), 'err'); }
      }
      await signUrls(d.photos.map((p) => p.path));
      if (ok) toast(`${ok} зураг нэмэгдлээ`);
      drawDetail();
    };
    input.addEventListener('change', () => handle(input.files));
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', (e) => handle(e.dataTransfer.files));

    $$('.photo').forEach((el) => {
      const p = d.photos.find((x) => x.id === el.dataset.id);
      el.querySelector('img').addEventListener('click', () => openLightbox(url(p.path), p.caption || ''));
      el.querySelector('[data-cover]').addEventListener('click', async (e) => {
        e.stopPropagation();
        await updateTrip(d.trip, { cover_path: p.path }, { keepOldFile: true });
        toast('Cover зураг солигдлоо'); drawDetail();
      });
      el.querySelector('[data-del]').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!(await confirmModal('Энэ зургийг устгах уу?'))) return;
        const { error } = await sb.from('photos').delete().eq('id', p.id);
        if (error) return toast(errMsg(error), 'err');
        if (d.trip.cover_path === p.path) await updateTrip(d.trip, { cover_path: null }, { keepOldFile: true });
        await removeFiles([p.path]);
        d.photos = d.photos.filter((x) => x !== p); drawDetail();
      });
    });
  }

  // ---------- Аяллын үйлдлүүд ----------
  async function updateTrip(t, patch, { keepOldFile = false } = {}) {
    const old = t.cover_path;
    const { data, error } = await sb.from('trips').update(patch).eq('id', t.id).select().single();
    if (error) { toast(errMsg(error), 'err'); return null; }
    Object.assign(t, data);
    // Хуучин cover файл цомогт байхгүй бол устгана
    if ('cover_path' in patch && old && old !== t.cover_path && !keepOldFile) {
      const usedInPhotos = state.detail?.photos.some((p) => p.path === old);
      if (!usedInPhotos) await removeFiles([old]);
    }
    return t;
  }

  async function setCoverFromFile(t, file) {
    try {
      toast('Cover зураг хуулж байна…');
      const path = await uploadImage(file, t.id, 'cover');
      await updateTrip(t, { cover_path: path });
      await signUrls([path]);
      toast('Cover зураг солигдлоо');
      if (state.detail?.trip.id === t.id) drawDetail();
    } catch (e) { toast(errMsg(e), 'err'); }
  }

  async function toggleComplete(t) {
    const completing = t.status !== 'completed';
    const patch = completing ? { status: 'completed', completed_at: new Date().toISOString() } : { status: 'planned', completed_at: null };
    if (!(await updateTrip(t, patch))) return;
    if (completing) { toast('🎉 Аялал дууссан гэж тэмдэглэгдлээ. Дурсамжаа нэмээрэй!'); state.detailTab = 'memories'; }
    else toast('Төлөвлөсөн болголоо');
    drawDetail();
  }

  async function deleteTrip(t) {
    if (!(await confirmModal(`"${tripName(t)}" аяллыг устгах уу? Checklist, тэмдэглэл, зураг бүгд устана.`, 'Устгах'))) return;
    const { data: ph } = await sb.from('photos').select('path').eq('trip_id', t.id);
    const { error } = await sb.from('trips').delete().eq('id', t.id);
    if (error) return toast(errMsg(error), 'err');
    await removeFiles([t.cover_path, ...(ph || []).map((p) => p.path)]);
    state.trips = state.trips.filter((x) => x.id !== t.id);
    delete state.checkStats[t.id];
    state.detail = null;
    toast('Аялал устгагдлаа');
    location.hash = '#/trips';
  }

  // ============================================================
  // АЯЛАЛ ҮҮСГЭХ / ЗАСАХ ФОРМ
  // ============================================================
  function openTripForm(t = null) {
    const v = t || { category: 'domestic', currency: 'MNT', start_date: '', end_date: '', budget: '' };
    const curOpts = Object.keys(CUR).map((c) => `<option ${v.currency === c ? 'selected' : ''}>${c}</option>`).join('');
    openModal(t ? 'Аялал засах' : 'Шинэ аялал төлөвлөх', `
      <form class="form" id="trip-form" novalidate>
        <div class="form-row">
          <label>Очих газар *<input type="text" name="destination" required maxlength="120" value="${esc(v.destination)}" placeholder="Жишээ: Токио, Хөвсгөл" /></label>
          <label>Улс<input type="text" name="country" maxlength="80" value="${esc(v.country)}" placeholder="Жишээ: Япон" /></label>
        </div>
        <label>Аяллын нэр <span class="hint">(заавал биш)</span><input type="text" name="title" maxlength="120" value="${esc(v.title)}" placeholder="Жишээ: Зуны амралт 2026" /></label>
        <label>Ангилал
          <div class="seg" id="cat-seg" style="width:max-content">
            <button type="button" data-v="domestic" class="${v.category === 'domestic' ? 'active' : ''}">🏔 Дотоод</button>
            <button type="button" data-v="international" class="${v.category === 'international' ? 'active' : ''}">✈ Гадаад</button>
          </div>
        </label>
        <div class="form-row">
          <label>Эхлэх огноо *<input type="date" name="start_date" required value="${esc(v.start_date)}" /></label>
          <label>Дуусах огноо *<input type="date" name="end_date" required value="${esc(v.end_date)}" /></label>
        </div>
        <div class="form-row">
          <label>Төсөв<input type="number" name="budget" min="0" step="any" value="${esc(v.budget)}" placeholder="0" /></label>
          <label>Валют<select name="currency">${curOpts}</select></label>
        </div>
        <label>Тэмдэглэл<textarea name="notes" maxlength="2000" placeholder="Нислэг, буудал, санаанууд…">${esc(v.notes)}</textarea></label>
        <label>Cover зураг <span class="hint">(заавал биш, 5MB хүртэл)</span>
          <div class="cover-preview" id="cover-preview" ${url(v.cover_path) ? `style="background-image:url('${esc(url(v.cover_path))}')"` : ''}>${url(v.cover_path) ? '' : 'Зураг сонгоогүй'}</div>
          <input type="file" name="cover" accept="image/*" />
        </label>
        <p id="form-err" class="auth-msg err" style="margin:0;text-align:left"></p>
        <div class="form-actions">
          <button type="button" class="btn" data-close>Болих</button>
          <button type="submit" class="btn btn-primary">${t ? 'Хадгалах' : 'Аялал үүсгэх'}</button>
        </div>
      </form>`);

    const form = $('#trip-form');
    let category = v.category;
    $('#cat-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      category = b.dataset.v;
      $$('#cat-seg button').forEach((x) => x.classList.toggle('active', x === b));
    });
    form.start_date.addEventListener('change', () => {
      if (!form.end_date.value || form.end_date.value < form.start_date.value) form.end_date.value = form.start_date.value;
      form.end_date.min = form.start_date.value;
    });
    form.cover.addEventListener('change', () => {
      const f = form.cover.files[0]; const pv = $('#cover-preview');
      if (!f) return;
      pv.style.backgroundImage = `url('${URL.createObjectURL(f)}')`; pv.textContent = '';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = $('#form-err');
      const payload = {
        destination: form.destination.value.trim(),
        country: form.country.value.trim() || null,
        title: form.title.value.trim() || null,
        category,
        start_date: form.start_date.value,
        end_date: form.end_date.value,
        budget: form.budget.value === '' ? 0 : Number(form.budget.value),
        currency: form.currency.value,
        notes: form.notes.value.trim() || null,
      };
      if (!payload.destination) return (errEl.textContent = 'Очих газраа оруулна уу.');
      if (!payload.start_date || !payload.end_date) return (errEl.textContent = 'Эхлэх, дуусах огноогоо оруулна уу.');
      if (payload.end_date < payload.start_date) return (errEl.textContent = 'Дуусах огноо эхлэх огнооноос өмнө байж болохгүй.');
      if (!(payload.budget >= 0)) return (errEl.textContent = 'Төсөв 0 эсвэл түүнээс их байна.');
      const file = form.cover.files[0];
      if (file && file.size > MAX_FILE) return (errEl.textContent = 'Cover зураг 5MB-аас бага байх ёстой.');
      errEl.textContent = '';
      const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Хадгалж байна…';

      try {
        let trip;
        if (t) {
          trip = await updateTrip(t, payload);
          if (!trip) throw new Error('Хадгалж чадсангүй');
        } else {
          const { data, error } = await sb.from('trips').insert(payload).select().single();
          if (error) throw error;
          trip = data; state.trips.unshift(trip);
        }
        if (file) {
          const path = await uploadImage(file, trip.id, 'cover');
          await updateTrip(trip, { cover_path: path });
          await signUrls([path]);
        }
        state.trips.sort((a, b) => b.start_date.localeCompare(a.start_date));
        closeModal();
        toast(t ? 'Аялал шинэчлэгдлээ' : 'Шинэ аялал үүслээ ✈');
        if (t) route(); else location.hash = `#/trip/${trip.id}`;
      } catch (e2) {
        errEl.textContent = errMsg(e2);
        btn.disabled = false; btn.textContent = t ? 'Хадгалах' : 'Аялал үүсгэх';
      }
    });
    setTimeout(() => form.destination.focus(), 50);
  }

  // ============================================================
  // MODAL / CONFIRM / LIGHTBOX
  // ============================================================
  let lastFocus = null;
  function openModal(title, html) {
    lastFocus = document.activeElement;
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = html;
    $('#modal').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    $('#modal').hidden = true;
    $('#modal-body').innerHTML = '';
    document.body.style.overflow = '';
    lastFocus?.focus?.();
  }
  $('#modal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#lightbox').hidden) closeLightbox();
    else if (!$('#modal').hidden) closeModal();
  });

  function confirmModal(text, okLabel = 'Тийм') {
    return new Promise((resolve) => {
      openModal('Баталгаажуулах', `
        <p style="margin:0 0 18px">${esc(text)}</p>
        <div class="form-actions">
          <button class="btn" id="cf-no">Болих</button>
          <button class="btn btn-primary" id="cf-yes" style="background:var(--danger);border-color:var(--danger);color:#fff">${esc(okLabel)}</button>
        </div>`);
      const done = (v) => { closeModal(); resolve(v); };
      $('#cf-yes').addEventListener('click', () => done(true));
      $('#cf-no').addEventListener('click', () => done(false));
      // backdrop/✕ дарахад false
      const onClose = (e) => { if (e.target.closest('[data-close]')) { $('#modal').removeEventListener('click', onClose); resolve(false); } };
      $('#modal').addEventListener('click', onClose);
      $('#cf-yes').focus();
    });
  }

  function openLightbox(src, cap) {
    $('#lightbox-img').src = src; $('#lightbox-cap').textContent = cap; $('#lightbox').hidden = false;
  }
  function closeLightbox() { $('#lightbox').hidden = true; $('#lightbox-img').src = ''; }
  $('#lightbox').addEventListener('click', (e) => { if (e.target.id !== 'lightbox-img') closeLightbox(); });

  // ---------- Эхлүүлэх ----------
  sb.auth.getSession().then(({ data }) => handleSession(data.session));
})();
