// [سهل] مواعيد السيلز — GitHub Pages + Supabase (من غير تسجيل دخول)
(function () {
  'use strict';
  const CFG = window.SAHL_CONFIG || {};
  const $app = document.getElementById('app');
  const DISPLAY_TZ = 'Africa/Cairo';

  const STATUSES = { upcoming: 'قادم', done: 'تم', postponed: 'اتأجل', cancelled: 'اتلغى', no_show: 'العميل ما حضرش' };
  const ACTIVE = ['upcoming', 'postponed'];
  const CHANNELS = { call: 'مكالمة تليفون', whatsapp: 'واتساب', zoom: 'Zoom', meet: 'Google Meet', teams: 'Teams', other: 'تاني' };
  const TZS = { 'Asia/Riyadh': 'توقيت السعودية', 'Africa/Cairo': 'توقيت مصر' };
  const REMINDERS = [[1440, 'قبلها بيوم'], [60, 'قبلها بساعة'], [30, 'قبلها بنص ساعة'], [10, 'قبلها بـ 10 دقايق'], [0, 'في ميعاد الاجتماع']];
  const REM_TEXT = { 0: 'دلوقتي', 10: 'بعد 10 دقايق', 30: 'بعد نص ساعة', 60: 'بعد ساعة', 1440: 'بكرة في نفس الميعاد' };
  const REM_LABEL = Object.fromEntries(REMINDERS);
  const DEFAULT_REMINDERS = [30, 10, 0];

  // ------------------------------------------------------------ helpers
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
  function toast(msg, isError) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast' + (isError ? ' error' : ''); t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3500);
  }

  // ---- time zones
  function tzOffsetMs(date, tz) {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date).forEach((x) => (p[x.type] = x.value));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - date.getTime();
  }
  function zonedToUtc(local, tz) { // 'YYYY-MM-DDTHH:MM' in tz -> Date
    const [d, t] = local.split('T'); const [Y, M, D] = d.split('-').map(Number); const [h, m] = t.split(':').map(Number);
    const wall = Date.UTC(Y, M - 1, D, h, m);
    let guess = wall;
    for (let i = 0; i < 3; i++) { const next = wall - tzOffsetMs(new Date(guess), tz); if (next === guess) break; guess = next; }
    return new Date(guess);
  }
  function utcToLocalInput(iso, tz) {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(iso)).forEach((x) => (p[x.type] = x.value));
    return `${p.year}-${p.month}-${p.day}T${String(+p.hour % 24).padStart(2, '0')}:${p.minute}`;
  }
  const fmtTime = (d, tz) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(d));
  const fmtDate = (d, tz) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(d));
  function relative(iso) {
    const diff = new Date(iso).getTime() - Date.now(); const past = diff < 0; const m = Math.floor(Math.abs(diff) / 60000);
    if (m < 1) return 'دلوقتي';
    let txt;
    if (m < 60) txt = `${m} دقيقة`;
    else if (m < 1440) { const h = Math.floor(m / 60), mm = m % 60; txt = `${h} ساعة` + (mm ? ` و${mm} دقيقة` : ''); }
    else txt = `${Math.floor(m / 1440)} يوم`;
    return past ? `من ${txt}` : `بعد ${txt}`;
  }
  function todayBounds() {
    const today = utcToLocalInput(new Date().toISOString(), DISPLAY_TZ).slice(0, 10);
    const start = zonedToUtc(today + 'T00:00', DISPLAY_TZ);
    const [Y, M, D] = today.split('-').map(Number);
    const tmr = new Date(Date.UTC(Y, M - 1, D + 1)).toISOString().slice(0, 10);
    return { start: start.toISOString(), end: zonedToUtc(tmr + 'T00:00', DISPLAY_TZ).toISOString() };
  }
  const when = (m) => ({ date: fmtDate(m.starts_at, DISPLAY_TZ), cairo: fmtTime(m.starts_at, 'Africa/Cairo'), riyadh: fmtTime(m.starts_at, 'Asia/Riyadh'), rel: relative(m.starts_at) });
  const isOverdue = (m) => m.status === 'upcoming' && new Date(m.starts_at).getTime() + m.duration_min * 60000 < Date.now();

  // ------------------------------------------------------------ config check
  const configured = CFG.SUPABASE_URL && !/YOUR_/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY) && window.supabase;
  if (!configured) {
    $app.innerHTML = `<div class="setup-error card-form"><h2>الموقع لسه ما اتربطش بـ Supabase</h2>
      <p>افتح ملف <code>config.js</code> واملا <code>SUPABASE_URL</code> و<code>SUPABASE_ANON_KEY</code>.</p></div>`;
    return;
  }
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sahl-meetings-auth' },
  });

  let me = null;      // { id, name }
  let cache = [];     // آخر اجتماعات اتحمّلت (للتذكير الاحتياطي)

  // ------------------------------------------------------------ boot
  async function boot() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      const { data: prof } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      if (prof) me = prof;
    }
    if (!me) return renderOnboarding(session);
    document.getElementById('topbar').hidden = false;
    registerSW();
    refreshBanner();
    window.addEventListener('hashchange', route);
    route();
    // تحديث القايمة كل دقيقة (الوقت المتبقي والمواعيد اللي عدّت)
    setInterval(() => { if (/^(#\/?(\?.*)?)?$/.test(location.hash)) renderList(true); }, 60000);
  }

  function renderOnboarding(session) {
    document.getElementById('topbar').hidden = true;
    $app.innerHTML = `<div class="onboard">
      <span class="brand-mark big">س</span><h1>مواعيد السيلز</h1>
      <p class="muted">سهل للتسويق الإلكتروني</p>
      <form class="form card-form" id="onboard-form">
        <label>اسمك<input name="name" required maxlength="80" autofocus placeholder="مثلاً: أحمد محمد"></label>
        <button class="btn btn-primary btn-block">ابدأ</button>
        <p class="device-note">اجتماعاتك هتتحفظ على الجهاز ده بس، ومحدش غيرك هيشوفها. لو مسحت بيانات المتصفح أو غيّرت الجهاز، الاجتماعات القديمة مش هتظهر.</p>
      </form></div>`;
    document.getElementById('onboard-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); btn.disabled = true;
      const name = e.target.name.value.trim();
      try {
        let s = session;
        if (!s) {
          const { data, error } = await sb.auth.signInAnonymously();
          if (error) throw error;
          s = data.session;
        }
        const { error } = await sb.from('profiles').upsert({ id: s.user.id, name });
        if (error) throw error;
        location.hash = '#/';
        location.reload();
      } catch (err) {
        console.error(err);
        toast('حصلت مشكلة: ' + (err.message || err), true);
        btn.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------ router
  function route(silent) {
    const h = location.hash || '#/';
    let m;
    if (h.startsWith('#/new')) return renderForm(null);
    if ((m = h.match(/^#\/m\/(\d+)\/edit/))) return loadMeeting(+m[1]).then((x) => x && renderForm(x));
    if ((m = h.match(/^#\/m\/(\d+)/))) return renderDetail(+m[1]);
    if (h.startsWith('#/settings')) return renderSettings();
    return renderList(silent);
  }

  async function loadMeeting(id) {
    const { data, error } = await sb.from('meetings').select('*').eq('id', id).maybeSingle();
    if (error || !data) { $app.innerHTML = `<div class="empty"><p>الاجتماع ده مش موجود.</p><a class="btn btn-primary" href="#/">الرئيسية</a></div>`; return null; }
    return data;
  }

  // ------------------------------------------------------------ list
  const listState = { view: 'today', q: '' };
  async function renderList(silent) {
    const params = new URLSearchParams((location.hash.split('?')[1]) || '');
    listState.view = params.get('view') || 'today';
    listState.q = params.get('q') || '';
    if (!silent) $app.innerHTML = '<div class="loading">جاري التحميل...</div>';
    const { start, end } = todayBounds();
    const nowIso = new Date().toISOString();

    let q = sb.from('meetings').select('*');
    const term = listState.q.replace(/[%,()]/g, ' ').trim();
    if (term) q = q.or(`client_name.ilike.%${term}%,store.ilike.%${term}%,phone.ilike.%${term}%`).order('starts_at', { ascending: false }).limit(200);
    else if (listState.view === 'upcoming') q = q.gte('starts_at', end).order('starts_at').limit(300);
    else if (listState.view === 'past') q = q.lt('starts_at', start).order('starts_at', { ascending: false }).limit(300);
    else q = q.gte('starts_at', start).lt('starts_at', end).order('starts_at');

    const [list, cToday, cUp, cOver, nxt, soon] = await Promise.all([
      q,
      sb.from('meetings').select('id', { count: 'exact', head: true }).gte('starts_at', start).lt('starts_at', end),
      sb.from('meetings').select('id', { count: 'exact', head: true }).gte('starts_at', end),
      sb.from('meetings').select('starts_at,duration_min,status').eq('status', 'upcoming').lt('starts_at', nowIso).limit(500),
      sb.from('meetings').select('*').in('status', ACTIVE).gte('starts_at', new Date(Date.now() - 5 * 60000).toISOString()).order('starts_at').limit(1),
      sb.from('meetings').select('*').in('status', ACTIVE).gte('starts_at', nowIso).lt('starts_at', new Date(Date.now() + 2 * 86400000).toISOString()),
    ]);
    if (list.error) { $app.innerHTML = `<div class="empty"><p>مش قادر أوصل للبيانات. اتأكد من النت وجرّب تاني.</p></div>`; console.error(list.error); return; }
    cache = soon.data || [];
    setupFallback();

    const meetings = list.data || [];
    const overdue = (cOver.data || []).filter(isOverdue).length;
    const next = (nxt.data || [])[0];
    const v = listState.view;
    const tab = (k, label, count) => `<a href="#/?view=${k}" class="tab ${v === k && !term ? 'active' : ''}">${label}${count != null ? ` <span class="pill">${count}</span>` : ''}</a>`;

    $app.innerHTML = `
      <section class="hello"><div>
        <h1>أهلاً ${esc(me.name)}</h1>
        ${next ? `<p class="muted">اجتماعك الجاي: <a href="#/m/${next.id}"><b>${esc(next.client_name)}</b></a> — ${when(next).rel} (${when(next).cairo} مصر)</p>` : '<p class="muted">مفيش اجتماعات جاية متسجلة.</p>'}
      </div>
      <form class="search" id="search"><input type="search" name="q" value="${esc(listState.q)}" placeholder="دوّر باسم العميل أو المتجر أو الرقم"></form></section>
      ${overdue ? `<div class="flash flash-warn">عندك ${overdue} اجتماع ميعاده عدّى وحالته لسه "قادم" — حدّث حالته.</div>` : ''}
      ${term ? `<p class="muted">نتايج البحث عن "<b>${esc(term)}</b>" — <a href="#/">رجوع</a></p>`
             : `<div class="tabs">${tab('today', 'النهارده', cToday.count ?? 0)}${tab('upcoming', 'الجاية', cUp.count ?? 0)}${tab('past', 'اللي فاتت')}</div>`}
      ${meetings.length ? `<div class="list">${meetings.map((m) => card(m, !!term || v !== 'today')).join('')}</div>`
        : `<div class="empty"><p>${term ? 'مفيش نتايج.' : v === 'today' ? 'مفيش اجتماعات النهارده.' : v === 'upcoming' ? 'مفيش اجتماعات جاية.' : 'مفيش اجتماعات قديمة.'}</p><a href="#/new" class="btn btn-primary">+ سجّل اجتماع</a></div>`}`;

    document.getElementById('search').addEventListener('submit', (e) => {
      e.preventDefault(); const val = e.target.q.value.trim();
      location.hash = val ? `#/?q=${encodeURIComponent(val)}` : '#/';
    });
    $app.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true; await setStatus(+b.dataset.done, 'done'); renderList(true);
    }));
  }

  function card(m, showDate) {
    const w = when(m), over = isOverdue(m), link = safeUrl(m.link);
    return `<article class="card status-${esc(m.status)} ${over ? 'overdue' : ''}">
      <div class="card-time"><div class="t-main">${w.cairo}</div><div class="t-sub">مصر</div><div class="t-ksa">${w.riyadh} <small>السعودية</small></div></div>
      <div class="card-body">
        <a class="card-title" href="#/m/${m.id}">${esc(m.client_name)}</a>
        <div class="card-meta">
          ${showDate ? `<span>📅 ${w.date}</span>` : ''}
          ${m.store ? `<span>🏪 ${esc(m.store)}</span>` : ''}
          <span>${CHANNELS[m.channel] || ''}</span><span>${m.duration_min} دقيقة</span>
          ${ACTIVE.includes(m.status) && new Date(m.starts_at) > new Date() ? `<span class="rel">${w.rel}</span>` : ''}
        </div>
        ${over ? '<div class="overdue-note">الميعاد عدّى — اتعمل ولا لأ؟</div>' : ''}
      </div>
      <div class="card-actions">
        <span class="badge badge-${esc(m.status)}">${STATUSES[m.status]}</span>
        ${link ? `<a class="btn btn-sm btn-blue" href="${esc(link)}" target="_blank" rel="noopener">افتح اللينك</a>` : ''}
        ${m.phone ? `<a class="btn btn-sm btn-ghost" href="tel:${esc(m.phone)}">اتصال</a>` : ''}
        ${ACTIVE.includes(m.status) ? `<button class="btn btn-sm btn-ghost" data-done="${m.id}">✓ تم</button>` : ''}
      </div></article>`;
  }

  async function setStatus(id, status) {
    const { error } = await sb.from('meetings').update({ status }).eq('id', id);
    if (error) toast('ما اتحفظش: ' + error.message, true); else toast('الحالة بقت: ' + STATUSES[status]);
  }

  // ------------------------------------------------------------ form
  function renderForm(m) {
    const editing = !!m;
    m = m || { tz: 'Asia/Riyadh', duration_min: 30, channel: 'call', status: 'upcoming', reminder_offsets: DEFAULT_REMINDERS };
    const localVal = editing ? utcToLocalInput(m.starts_at, m.tz) : '';
    const offs = (m.reminder_offsets || []).map(Number);
    const opt = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
    $app.innerHTML = `
      <h1>${editing ? 'تعديل الاجتماع' : 'اجتماع جديد'}</h1>
      <form class="form card-form" id="mform">
        <div class="grid2">
          <label>اسم العميل *<input name="client_name" required maxlength="200" value="${esc(m.client_name)}" placeholder="مثلاً: أ. محمد"></label>
          <label>المتجر / الموقع<input name="store" maxlength="200" value="${esc(m.store)}" placeholder="example.com"></label>
        </div>
        <div class="grid3">
          <label>الميعاد *<input type="datetime-local" name="starts_at" required value="${localVal}"></label>
          <label>الميعاد ده بتوقيت<select name="tz">${opt(TZS, m.tz)}</select></label>
          <label>المدة (دقيقة)<input type="number" name="duration_min" min="5" max="600" step="5" value="${m.duration_min}"></label>
        </div>
        <p class="hint" id="tz-preview">لو العميل قالك ميعاد، سيبه "توقيت السعودية" والموقع هيحسبلك الفرق.</p>
        <div class="grid3">
          <label>نوع الاجتماع<select name="channel">${opt(CHANNELS, m.channel)}</select></label>
          <label>رقم العميل<input name="phone" maxlength="40" dir="ltr" value="${esc(m.phone)}" placeholder="+9665xxxxxxxx"></label>
          <label>لينك الاجتماع<input name="link" maxlength="500" dir="ltr" value="${esc(m.link)}" placeholder="https://meet.google.com/..."></label>
        </div>
        <fieldset><legend>ابعتلي تذكير</legend><div class="checks">
          ${REMINDERS.map(([v, l]) => `<label class="check"><input type="checkbox" name="rem" value="${v}" ${offs.includes(v) ? 'checked' : ''}> ${l}</label>`).join('')}
        </div></fieldset>
        ${editing ? `<label>الحالة<select name="status">${opt(STATUSES, m.status)}</select></label>` : ''}
        <label>ملاحظات<textarea name="notes" rows="4" maxlength="4000" placeholder="العميل عايز إيه، الباقة، اعتراضاته...">${esc(m.notes)}</textarea></label>
        <div class="actions">
          <button class="btn btn-primary">${editing ? 'احفظ التعديل' : 'سجّل الاجتماع'}</button>
          <a class="btn btn-ghost" href="${editing ? '#/m/' + m.id : '#/'}">إلغاء</a>
        </div>
      </form>`;
    const f = document.getElementById('mform');
    const preview = () => {
      if (!f.starts_at.value) return;
      const d = zonedToUtc(f.starts_at.value, f.tz.value);
      document.getElementById('tz-preview').textContent =
        `= ${fmtDate(d, 'Africa/Cairo')} ${fmtTime(d, 'Africa/Cairo')} بتوقيت مصر  ·  ${fmtTime(d, 'Asia/Riyadh')} بتوقيت السعودية`;
    };
    f.starts_at.addEventListener('input', preview); f.tz.addEventListener('change', preview); preview();

    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = f.querySelector('button.btn-primary'); btn.disabled = true;
      let link = f.link.value.trim();
      if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
      const startsAt = zonedToUtc(f.starts_at.value, f.tz.value);
      const row = {
        client_name: f.client_name.value.trim(),
        store: f.store.value.trim() || null,
        phone: f.phone.value.trim() || null,
        starts_at: startsAt.toISOString(),
        tz: f.tz.value,
        duration_min: Math.max(5, Math.min(600, +f.duration_min.value || 30)),
        channel: f.channel.value,
        link: link || null,
        notes: f.notes.value.trim() || null,
        reminder_offsets: [...f.querySelectorAll('input[name=rem]:checked')].map((x) => +x.value),
      };
      if (editing) row.status = f.status.value;
      const res = editing
        ? await sb.from('meetings').update(row).eq('id', m.id).select().single()
        : await sb.from('meetings').insert(row).select().single();
      if (res.error) { toast('ما اتحفظش: ' + res.error.message, true); btn.disabled = false; return; }
      toast(startsAt < new Date() ? 'اتسجل — بس الميعاد ده في الماضي' : (editing ? 'اتعدّل ✓' : 'الاجتماع اتسجل والتذكيرات اتظبطت ✓'));
      location.hash = '#/m/' + res.data.id;
    });
  }

  // ------------------------------------------------------------ detail
  async function renderDetail(id) {
    $app.innerHTML = '<div class="loading">جاري التحميل...</div>';
    const m = await loadMeeting(id); if (!m) return;
    const { data: rems } = await sb.from('reminders').select('*').eq('meeting_id', id).order('fire_at');
    const w = when(m), link = safeUrl(m.link);
    const wa = (m.phone || '').replace(/[^\d]/g, '');
    $app.innerHTML = `
      <a href="#/" class="back">→ رجوع</a>
      <div class="detail">
        <div class="detail-head"><div><h1>${esc(m.client_name)}</h1>${m.store ? `<p class="muted">🏪 ${esc(m.store)}</p>` : ''}</div>
          <span class="badge badge-${esc(m.status)}">${STATUSES[m.status]}</span></div>
        <div class="when-box">
          <div>📅 <b>${w.date}</b></div><div><b>${w.cairo}</b> بتوقيت مصر</div><div><b>${w.riyadh}</b> بتوقيت السعودية</div>
          <div class="muted">${w.rel} · ${m.duration_min} دقيقة · ${CHANNELS[m.channel] || ''}</div>
        </div>
        <div class="actions">
          ${link ? `<a class="btn btn-blue" href="${esc(link)}" target="_blank" rel="noopener">افتح لينك الاجتماع</a>` : ''}
          ${m.phone ? `<a class="btn btn-ghost" href="tel:${esc(m.phone)}" dir="ltr">📞 ${esc(m.phone)}</a>` : ''}
          ${wa ? `<a class="btn btn-ghost" href="https://wa.me/${wa}" target="_blank" rel="noopener">واتساب</a>` : ''}
          <a class="btn btn-primary" href="#/m/${m.id}/edit">تعديل</a>
        </div>
        ${m.notes ? `<h3>ملاحظات</h3><div class="notes">${esc(m.notes)}</div>` : ''}
        <h3>غيّر الحالة</h3>
        <div class="status-row">${Object.entries(STATUSES).map(([k, v]) => `<button data-st="${k}" class="btn btn-sm ${m.status === k ? 'btn-primary' : 'btn-ghost'}">${v}</button>`).join('')}</div>
        <p class="hint">لو اتأجل: اضغط "تعديل" وغيّر الميعاد — التذكيرات هتتظبط على الميعاد الجديد لوحدها.</p>
        <h3>التذكيرات</h3>
        ${(rems || []).length ? `<ul class="rems">${rems.map((r) => `<li class="${r.sent_at ? 'sent' : ''}">${REM_LABEL[r.offset_min] || ''} — ${fmtDate(r.fire_at, DISPLAY_TZ)} ${fmtTime(r.fire_at, DISPLAY_TZ)} (مصر) ${r.sent_at ? '✓ اتبعت' : ''}</li>`).join('')}</ul>` : '<p class="muted">مفيش تذكيرات للاجتماع ده.</p>'}
        <div class="danger-zone"><button class="linkbtn danger" id="del">امسح الاجتماع</button></div>
      </div>`;
    $app.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', async () => { await setStatus(m.id, b.dataset.st); renderDetail(m.id); }));
    document.getElementById('del').addEventListener('click', async () => {
      if (!confirm('متأكد إنك عايز تمسح الاجتماع ده؟')) return;
      const { error } = await sb.from('meetings').delete().eq('id', m.id);
      if (error) return toast('ما اتمسحش: ' + error.message, true);
      toast('الاجتماع اتمسح'); location.hash = '#/';
    });
  }

  // ------------------------------------------------------------ settings
  async function renderSettings() {
    $app.innerHTML = `
      <h1>الإعدادات</h1>
      <section class="card-form">
        <h2>الإشعارات على الجهاز ده</h2>
        <p id="push-status" class="push-status">جاري الفحص...</p>
        <div class="actions">
          <button id="push-enable" class="btn btn-blue">فعّل الإشعارات هنا</button>
          <button id="push-test" class="btn btn-ghost">ابعت إشعار تجريبي</button>
          <button id="push-disable" class="btn btn-ghost">اقفل الإشعارات هنا</button>
        </div>
        <details class="help"><summary>الإشعار مش بيوصل؟</summary><ul>
          <li><b>آيفون:</b> لازم iOS 16.4 أو أحدث. افتح الموقع من Safari ← زرار المشاركة ← "إضافة إلى الشاشة الرئيسية"، وافتحه من الأيقونة وفعّل الإشعارات من جوه. <b>وخلّي استخدامك كله من الأيقونة دي</b>، لأن اجتماعاتك متسجلة عليها هي.</li>
          <li><b>أندرويد:</b> افتح من Chrome، ولو الإشعار بيتأخر: الإعدادات ← التطبيقات ← Chrome ← البطارية ← "بدون قيود".</li>
          <li><b>لابتوب:</b> المتصفح لازم يكون شغال (حتى لو مفيش تاب للموقع). اتأكد إن إشعارات Chrome مسموحة من إعدادات الويندوز.</li>
          <li>لو رفضت الإذن بالغلط: اضغط على القفل جنب العنوان ← الإشعارات ← سماح.</li>
        </ul></details>
      </section>
      <section class="card-form">
        <h2>اسمك</h2>
        <form class="form" id="name-form"><label>الاسم<input name="name" required maxlength="80" value="${esc(me.name)}"></label>
          <button class="btn btn-primary">احفظ</button></form>
        <p class="device-note">اجتماعاتك متسجلة على المتصفح ده بس. لو مسحت بيانات المتصفح أو فتحت من جهاز تاني، الاجتماعات القديمة مش هتظهر.</p>
      </section>`;
    document.getElementById('name-form').addEventListener('submit', async (e) => {
      e.preventDefault(); const name = e.target.name.value.trim();
      const { error } = await sb.from('profiles').update({ name }).eq('id', me.id);
      if (error) return toast(error.message, true);
      me.name = name; toast('اتحفظ ✓');
    });
    document.getElementById('push-enable').addEventListener('click', async () => {
      try { if (await enablePush()) toast('الإشعارات اتفعّلت ✓'); } catch (err) { toast('حصلت مشكلة: ' + err.message, true); }
      refreshStatus(); refreshBanner();
    });
    document.getElementById('push-disable').addEventListener('click', async () => { await disablePush(); refreshStatus(); refreshBanner(); });
    document.getElementById('push-test').addEventListener('click', async (e) => {
      e.target.disabled = true;
      const { data, error } = await sb.functions.invoke('send-reminders', { body: { test: true } });
      e.target.disabled = false;
      if (error) return toast('مش قادر أبعت: ' + error.message, true);
      if (!data?.ok) toast('مفيش جهاز مفعّل عليه الإشعارات. اضغط "فعّل الإشعارات هنا" الأول.', true);
      else toast('اتبعت ✓ — لو ما وصلكش في ثواني شوف "الإشعار مش بيوصل؟"');
    });
    refreshStatus();
  }

  // ------------------------------------------------------------ push
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let swReg = null;
  async function registerSW() {
    if (!('serviceWorker' in navigator)) return null;
    if (!swReg) { swReg = await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready; }
    return swReg;
  }
  function b64ToUint8(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }
  async function currentSub() {
    if (!pushSupported) return null;
    const reg = await registerSW(); return reg ? reg.pushManager.getSubscription() : null;
  }
  async function pushOn() { try { return !!(await currentSub()) && Notification.permission === 'granted'; } catch (_) { return false; } }
  async function enablePush() {
    if (!pushSupported) {
      alert(isIOS && !standalone
        ? 'على الآيفون: افتح الموقع من Safari ← زرار المشاركة ← "إضافة إلى الشاشة الرئيسية"، وافتحه من الأيقونة وفعّل الإشعارات من هناك.'
        : 'المتصفح ده مش بيدعم الإشعارات. استخدم Chrome أو Edge.');
      return false;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { alert('الإذن اترفض. فعّله من إعدادات المتصفح (القفل جنب العنوان ← الإشعارات ← سماح).'); return false; }
    const reg = await registerSW();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      let key = CFG.VAPID_PUBLIC_KEY;
      if (!key) {
        const { data, error } = await sb.functions.invoke('send-reminders', { body: { vapid: true } });
        if (error || !data?.key) throw new Error('مش قادر أجيب مفتاح الإشعارات من السيرفر');
        key = data.key;
      }
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(key) });
    }
    const j = sub.toJSON();
    const { error } = await sb.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    if (error) throw error;
    return true;
  }
  async function disablePush() {
    const sub = await currentSub();
    if (sub) { await sb.rpc('remove_push_subscription', { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
  }
  async function refreshStatus() {
    const el = document.getElementById('push-status'); if (!el) return;
    if (!pushSupported) {
      el.textContent = isIOS && !standalone ? 'ضيف الموقع للشاشة الرئيسية الأول (شوف الشرح تحت).' : 'المتصفح ده مش بيدعم الإشعارات.';
      el.className = 'push-status off'; return;
    }
    const on = await pushOn();
    el.textContent = on ? '✓ الإشعارات شغالة على الجهاز ده' : '✗ الإشعارات مش مفعّلة على الجهاز ده';
    el.className = 'push-status ' + (on ? 'on' : 'off');
  }
  async function refreshBanner() {
    const banner = document.getElementById('push-banner');
    if (await pushOn()) { banner.hidden = true; return; }
    if (isIOS && !standalone) {
      document.getElementById('push-banner-text').textContent = 'على الآيفون: ضيف الموقع للشاشة الرئيسية (مشاركة ← إضافة إلى الشاشة الرئيسية) وافتحه من الأيقونة عشان الإشعارات تشتغل.';
      document.getElementById('push-banner-btn').hidden = true;
    }
    banner.hidden = false;
  }
  document.getElementById('push-banner-btn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { if (await enablePush()) { toast('الإشعارات اتفعّلت ✓'); refreshBanner(); } } catch (err) { toast('حصلت مشكلة: ' + err.message, true); }
    e.target.disabled = false;
  });

  // ------------------------------------------------------------ in-page fallback alarm (لو الإشعارات مش مفعّلة والصفحة مفتوحة)
  const fallbackTimers = [];
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.35, 0.7].forEach((t) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.25, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3);
      });
    } catch (_) {}
  }
  function showAlarm(title, id) {
    beep();
    const box = document.createElement('div'); box.className = 'alarm';
    box.innerHTML = '<b></b><span><a class="btn btn-sm btn-blue">افتح</a> <button class="btn btn-sm btn-ghost">تمام</button></span>';
    box.querySelector('b').textContent = '⏰ ' + title;
    box.querySelector('a').href = '#/m/' + id;
    const orig = document.title; let flip = false;
    const iv = setInterval(() => { document.title = (flip = !flip) ? '⏰ ' + title : orig; }, 1000);
    const close = () => { clearInterval(iv); document.title = orig; box.remove(); };
    box.querySelector('button').onclick = close; box.querySelector('a').addEventListener('click', close);
    document.body.appendChild(box);
  }
  async function setupFallback() {
    fallbackTimers.splice(0).forEach(clearTimeout);
    if (await pushOn()) return;
    const now = Date.now();
    cache.forEach((m) => (m.reminder_offsets || []).forEach((off) => {
      const ms = new Date(m.starts_at).getTime() - off * 60000 - now;
      if (ms > 0 && ms < 86400000) fallbackTimers.push(setTimeout(() => showAlarm(`اجتماع ${m.client_name} ${REM_TEXT[off] || ''}`, m.id), ms));
    }));
  }

  boot().catch((err) => { console.error(err); $app.innerHTML = `<div class="empty"><p>حصلت مشكلة في التحميل: ${esc(err.message || err)}</p></div>`; });
})();
