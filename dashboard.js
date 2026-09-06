// dashboard.js — queues, approvals, announcements.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.HERITAGELINC;
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const el = (id) => document.getElementById(id);
const notice = el('notice');

let me = null;

// Held while the decline dialog is open.
let pendingDecline = null;

// ------------------------------------------------------------ helpers

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function say(kind, title, body) {
  notice.className = `notice notice-${kind} show`;
  notice.innerHTML = body ? `<strong>${esc(title)}</strong>${esc(body)}` : esc(title);
  notice.scrollIntoView({ block: 'nearest' });
}

function clearNotice() {
  notice.className = 'notice';
  notice.textContent = '';
}

function busy(button, on, idleLabel) {
  button.disabled = on;
  button.innerHTML = on ? '<span class="spinner"></span>' : idleLabel;
}

function whenLabel(iso) {
  if (!iso) return 'unknown date';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// --------------------------------------------------------------- gate

async function boot() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return (window.location.href = 'index.html');

  const { data: profile } = await db
    .from('profiles')
    .select('id, email, first_name, last_name, is_admin')
    .eq('id', session.user.id)
    .maybeSingle();

  if (!profile?.is_admin) return (window.location.href = 'index.html');

  me = profile;
  el('me-name').textContent =
    `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Administrator';
  el('me-mail').textContent = profile.email;

  loadOverview();
  loadTeachers();
  loadPlaces();
  loadCatalogue();

  restoreNavState();
}

// --------------------------------------------------------------- tabs

document.querySelectorAll('.nav button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.nav button')
      .forEach((x) => x.removeAttribute('aria-current'));
    b.setAttribute('aria-current', 'true');

    ['overview', 'teachers', 'places', 'catalogue', 'announce'].forEach((t) => {
      el(`tab-${t}`).classList.toggle('hidden', t !== b.dataset.tab);
    });

    clearNotice();
  });
});

el('signout').addEventListener('click', async () => {
  await db.auth.signOut();
  window.location.href = 'index.html';
});

// ----------------------------------------------------------- overview

async function loadOverview() {
  const { data, error } = await db.rpc('admin_stats');

  if (error) {
    el('stats').innerHTML =
      `<p class="loading">Could not load the counts. ${esc(error.message)}</p>`;
    return;
  }

  const s = Array.isArray(data) ? data[0] : data;

  const cards = [
    ['Teachers awaiting review', s.pending_teachers, true],
    ['Places awaiting review', s.pending_submissions, true],
    ['Scans flagged for checking', s.pending_scan_reviews, false],
    ['Route corrections reported', s.open_route_reports, false],
    ['Sites published', s.total_sites, false],
    ['Registered accounts', s.total_users, false],
  ];

  el('stats').innerHTML = cards.map(([label, n, urgent]) => `
    <div class="stat${urgent && n > 0 ? ' urgent' : ''}">
      <p class="n">${n ?? 0}</p>
      <p class="k">${label}</p>
    </div>
  `).join('');

  setCount('n-teachers', s.pending_teachers);
  setCount('n-places', s.pending_submissions);
}

function setCount(id, n) {
  const node = el(id);
  node.dataset.n = n ?? 0;
  node.textContent = n > 0 ? n : '';
}

// ----------------------------------------------------------- teachers

async function loadTeachers() {
  const box = el('q-teachers');
  const { data, error } = await db.rpc('admin_pending_teachers');

  if (error) {
    box.innerHTML = `<p class="loading">${esc(error.message)}</p>`;
    return;
  }

  if (!data.length) {
    box.innerHTML = `
      <div class="empty">
        <h3>Nothing to review</h3>
        <p>Teacher accounts appear here when they register without an
           official DepEd address.</p>
      </div>`;
    return;
  }

  box.innerHTML = data.map(teacherCard).join('');
  wireActions(box);
}

function teacherCard(t) {
  const deped = (t.email ?? '').toLowerCase().endsWith('@deped.gov.ph');

  const evidence = t.id_document_path
    ? `<div class="evidence">
         <a href="#" data-doc="${esc(t.id_document_path)}">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 16l-5-4-4 3-2-1.5L3 18"/></svg>
           Open faculty ID photo
         </a>
       </div>`
    : `<div class="evidence">
         <p class="hint">No ID photo was uploaded. Decide on the written
         details, or decline and ask for one.</p>
       </div>`;

  const depedNote = deped
    ? `<div class="quote">This is a DepEd address but the account is still
       pending, which means the email was never confirmed. Ask them to open
       the confirmation link rather than approving on the address alone.</div>`
    : '';

  return `
  <article class="card" data-id="${esc(t.profile_id)}" data-name="${esc(t.full_name)}">
    <div class="card-head">
      <div style="flex:1">
        <h3>${esc(t.full_name || 'Unnamed applicant')}</h3>
        <p class="meta">${esc(t.email)} · applied ${whenLabel(t.submitted_at)}</p>
      </div>
      <span class="tag ${deped ? 'tag-gold' : 'tag-grey'}">
        ${deped ? 'DepEd address' : 'Manual review'}
      </span>
    </div>

    ${depedNote}

    <dl class="facts">
      <dt>School</dt><dd${t.school_name ? '' : ' class="blank"'}>${esc(t.school_name) || 'not given'}</dd>
      <dt>Faculty ID</dt><dd${t.employee_id ? '' : ' class="blank"'}>${esc(t.employee_id) || 'not given'}</dd>
      <dt>Designation</dt><dd${t.designation ? '' : ' class="blank"'}>${esc(t.designation) || 'not given'}</dd>
      <dt>Subject</dt><dd${t.subject_taught ? '' : ' class="blank"'}>${esc(t.subject_taught) || 'not given'}</dd>
      <dt>PRC licence</dt><dd${t.prc_license_no ? '' : ' class="blank"'}>${esc(t.prc_license_no) || 'not given'}</dd>
    </dl>

    ${evidence}

    <div class="actions">
      <button class="btn btn-approve btn-sm" data-act="approve-teacher">Verify teacher</button>
      <button class="btn btn-reject btn-sm" data-act="decline-teacher">Decline</button>
    </div>
  </article>`;
}

// ------------------------------------------------------------- places

async function loadPlaces() {
  const box = el('q-places');
  const { data, error } = await db.rpc('admin_pending_submissions');

  if (error) {
    box.innerHTML = `<p class="loading">${esc(error.message)}</p>`;
    return;
  }

  if (!data.length) {
    box.innerHTML = `
      <div class="empty">
        <h3>Nothing to review</h3>
        <p>Places suggested from the app appear here before they reach the map.</p>
      </div>`;
    return;
  }

  box.innerHTML = data.map(placeCard).join('');
  wireActions(box);
}

function placeCard(p) {
  const coords = (p.latitude && p.longitude)
    ? `${Number(p.latitude).toFixed(5)}, ${Number(p.longitude).toFixed(5)}`
    : null;

  return `
  <article class="card" data-id="${esc(p.id)}" data-name="${esc(p.name)}">
    <div class="card-head">
      <div style="flex:1">
        <h3>${esc(p.name)}</h3>
        <p class="meta">${esc(p.municipality)} · from ${esc(p.submitter_name)} · ${whenLabel(p.created_at)}</p>
      </div>
      <span class="tag tag-grey">${esc(p.category)}</span>
    </div>

    <div class="quote">${esc(p.description)}</div>

    <dl class="facts">
      <dt>Historical note</dt><dd${p.historical_note ? '' : ' class="blank"'}>${esc(p.historical_note) || 'none given'}</dd>
      <dt>Source cited</dt><dd${p.source_note ? '' : ' class="blank"'}>${esc(p.source_note) || 'none cited'}</dd>
      <dt>Coordinates</dt><dd${coords ? '' : ' class="blank"'}>${coords || 'not given'}</dd>
      <dt>Submitted by</dt><dd>${esc(p.submitter_email)}</dd>
    </dl>

    ${p.source_note ? '' : `
      <div class="quote" style="border-left-color:var(--red)">
        No source was cited. Published entries carry a provenance line, so
        this one would read "No source cited by submitter" on every phone
        that opens it.
      </div>`}

    <div class="actions">
      <button class="btn btn-approve btn-sm" data-act="approve-place">Publish to Explore</button>
      <button class="btn btn-reject btn-sm" data-act="decline-place">Decline</button>
    </div>
  </article>`;
}

// ------------------------------------------------------------ actions

function wireActions(scope) {
  scope.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.card');
      const id = card.dataset.id;
      const name = card.dataset.name;
      const act = btn.dataset.act;

      if (act === 'approve-teacher') return approveTeacher(id, name, btn);
      if (act === 'approve-place') return approvePlace(id, name, btn);
      if (act === 'decline-teacher') return openDecline('teacher', id, name);
      if (act === 'decline-place') return openDecline('place', id, name);
    });
  });

  scope.querySelectorAll('[data-doc]').forEach((link) => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const path = link.dataset.doc;

      const { data, error } = await db.storage
        .from('teacher-ids')
        .createSignedUrl(path, 300);

      if (error) return say('error', 'Could not open that photo.', error.message);
      window.open(data.signedUrl, '_blank', 'noopener');
    });
  });
}

async function approveTeacher(id, name, btn) {
  busy(btn, true, 'Verify teacher');
  const { error } = await db.rpc('approve_teacher', { p_profile_id: id });
  busy(btn, false, 'Verify teacher');

  if (error) return say('error', 'Could not verify that account.', error.message);

  say('ok', `${name} can now host field trips.`);
  refreshAll();
}

async function approvePlace(id, name, btn) {
  busy(btn, true, 'Publish to Explore');
  const { error } = await db.rpc('approve_submission', { p_submission_id: id });
  busy(btn, false, 'Publish to Explore');

  if (error) return say('error', 'Could not publish that place.', error.message);

  say('ok', `${name} is published.`, 'Everyone has been notified.');
  refreshAll();
}

// ------------------------------------------------------ decline dialog

const veil = el('veil');

function openDecline(kind, id, name) {
  pendingDecline = { kind, id, name };
  el('dlg-title').textContent = `Decline ${name}`;
  el('dlg-sub').textContent = kind === 'teacher'
    ? 'The applicant sees this reason and can resubmit, so say what is missing.'
    : 'The submitter sees this reason, so say what would make the entry publishable.';
  el('dlg-reason').value = '';
  veil.classList.add('show');
  el('dlg-reason').focus();
}

el('dlg-cancel').addEventListener('click', () => {
  veil.classList.remove('show');
  pendingDecline = null;
});

veil.addEventListener('click', (e) => {
  if (e.target === veil) el('dlg-cancel').click();
});

el('dlg-confirm').addEventListener('click', async () => {
  const reason = el('dlg-reason').value.trim();

  if (reason.length < 5) {
    return say('error', 'Write a reason of at least five characters.');
  }

  const { kind, id, name } = pendingDecline;
  const btn = el('dlg-confirm');
  busy(btn, true, 'Send decision');

  const { error } = kind === 'teacher'
    ? await db.rpc('reject_teacher', { p_profile_id: id, p_reason: reason })
    : await db.rpc('reject_submission', { p_submission_id: id, p_reason: reason });

  busy(btn, false, 'Send decision');

  if (error) return say('error', 'Could not send that decision.', error.message);

  veil.classList.remove('show');
  pendingDecline = null;
  say('ok', `${name} was declined.`, 'They have been told why.');
  refreshAll();
});

// ------------------------------------------------------- announcement

el('announce-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearNotice();

  const title = el('an-title').value.trim();
  const body = el('an-body').value.trim();

  if (title.length < 3) return say('error', 'Give the announcement a title.');
  if (body.length < 10) return say('error', 'Write a message of at least ten characters.');

  const btn = el('an-submit');
  busy(btn, true, 'Post announcement');

  const { data, error } = await db.rpc('broadcast_notification', {
    p_type: 'announcement',
    p_title: title,
    p_body: body,
  });

  busy(btn, false, 'Post announcement');

  if (error) return say('error', 'Could not post that.', error.message);

  el('an-title').value = '';
  el('an-body').value = '';
  say('ok', `Posted to ${data} accounts.`);
});

// -------------------------------------------------------------- reload

function refreshAll() {
  loadOverview();
  loadTeachers();
  loadPlaces();
  loadCatalogue();
}

// ==================================================== SIDEBAR COLLAPSE

const shell = el('shell');

function restoreNavState() {
  if (localStorage.getItem('hl-nav') === 'tight') shell.classList.add('tight');
}

el('toggle-nav').addEventListener('click', () => {
  shell.classList.toggle('tight');
  localStorage.setItem(
    'hl-nav',
    shell.classList.contains('tight') ? 'tight' : 'wide',
  );
});

// ========================================================== CATALOGUE

let catalogue = [];
let editing = null;      // the row being edited, or null for a new one
let pendingImageUrl = null;

async function loadCatalogue() {
  const box = el('q-catalogue');
  const q = el('cat-search').value.trim();

  const { data, error } = await db.rpc('admin_sites', {
    q,
    max_results: 200,
  });

  if (error) {
    box.innerHTML = `<p class="loading">${esc(error.message)}</p>`;
    return;
  }

  catalogue = data;

  if (!data.length) {
    box.innerHTML = `
      <div class="empty">
        <h3>${q ? 'Nothing matched' : 'The catalogue is empty'}</h3>
        <p>${q
          ? 'Try a shorter word, or clear the search.'
          : 'Add a site, or approve a submission, and it appears here.'}</p>
      </div>`;
    return;
  }

  box.innerHTML = data.map(siteRow).join('');

  box.querySelectorAll('[data-edit]').forEach((b) => {
    b.addEventListener('click', () =>
      openEditor(catalogue.find((s) => s.id === b.dataset.edit)));
  });

  box.querySelectorAll('[data-retire]').forEach((b) => {
    b.addEventListener('click', () => retireSite(b.dataset.retire, b));
  });
}

function siteRow(s) {
  const img = s.image_url
    ? `<img class="thumb" src="${esc(s.image_url)}" alt="" loading="lazy">`
    : `<div class="thumb-blank">no photo</div>`;

  const edited = s.editor_name
    ? ` · last edited by ${esc(s.editor_name)}`
    : '';

  return `
  <div class="site-row${s.is_active ? '' : ' retired'}">
    ${img}
    <div>
      <h4>${esc(s.name)}</h4>
      <p class="meta">${esc(s.municipality)} · ${esc(s.category)}${edited}</p>
      <p class="snippet">${esc(s.summary)}</p>
    </div>
    <div class="actions">
      <button class="btn btn-ghost btn-sm" data-edit="${esc(s.id)}">Edit</button>
      ${s.is_active
        ? `<button class="btn btn-reject btn-sm" data-retire="${esc(s.id)}">Hide</button>`
        : `<span class="tag tag-grey">Hidden</span>`}
    </div>
  </div>`;
}

let searchTimer;
el('cat-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadCatalogue, 300);
});

el('cat-new').addEventListener('click', () => openEditor(null));

async function retireSite(id, btn) {
  busy(btn, true, 'Hide');
  const { error } = await db.rpc('admin_retire_site', { p_id: id });
  busy(btn, false, 'Hide');

  if (error) return say('error', 'Could not hide that site.', error.message);

  say('ok', 'Hidden from the app.', 'Existing scans that point at it still open.');
  loadCatalogue();
  loadOverview();
}

// ------------------------------------------------------------- editor

const edVeil = el('ed-veil');

function openEditor(site) {
  editing = site;
  pendingImageUrl = site?.image_url ?? null;

  el('ed-title').textContent = site ? 'Edit site' : 'Add a site';
  el('ed-name').value = site?.name ?? '';
  el('ed-category').value = site?.category ?? 'church';
  el('ed-municipality').value = site?.municipality ?? '';
  el('ed-lat').value = site?.latitude ?? '';
  el('ed-lon').value = site?.longitude ?? '';
  el('ed-summary').value = site?.summary ?? '';
  el('ed-note').value = site?.historical_note ?? '';
  el('ed-period').value = site?.period ?? '';
  el('ed-declaration').value = site?.declaration ?? '';
  el('ed-source').value = site?.source_name ?? '';
  el('ed-reference').value = site?.source_reference ?? '';
  el('ed-credit').value = site?.image_credit ?? '';
  el('ed-active').checked = site ? site.is_active : true;

  showPreview(pendingImageUrl);
  el('ed-drop-text').textContent = pendingImageUrl
    ? 'Choose a different photo, or drop one here.'
    : 'Choose a photo, or drop one here. JPG or PNG, under 3 MB.';

  edVeil.classList.add('show');
  el('ed-name').focus();
}

function showPreview(url) {
  const img = el('ed-preview');
  if (url) {
    img.src = url;
    img.classList.remove('hidden');
  } else {
    img.removeAttribute('src');
    img.classList.add('hidden');
  }
}

el('ed-cancel').addEventListener('click', () => {
  edVeil.classList.remove('show');
  editing = null;
  pendingImageUrl = null;
});

edVeil.addEventListener('click', (e) => {
  if (e.target === edVeil) el('ed-cancel').click();
});

// ------------------------------------------------------ image upload

el('ed-drop').addEventListener('click', () => el('ed-file').click());

el('ed-drop').addEventListener('dragover', (e) => {
  e.preventDefault();
  el('ed-drop').style.borderColor = 'var(--teal)';
});

el('ed-drop').addEventListener('dragleave', () => {
  el('ed-drop').style.borderColor = '';
});

el('ed-drop').addEventListener('drop', (e) => {
  e.preventDefault();
  el('ed-drop').style.borderColor = '';
  const file = e.dataTransfer.files[0];
  if (file) uploadPhoto(file);
});

el('ed-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) uploadPhoto(file);
});

async function uploadPhoto(file) {
  if (!file.type.startsWith('image/')) {
    return say('error', 'That file is not an image.');
  }
  if (file.size > 3 * 1024 * 1024) {
    return say('error', 'That photo is larger than 3 MB. Resize it and try again.');
  }

  const note = el('ed-drop-text');
  note.textContent = 'Uploading…';

  const ext = file.name.split('.').pop().toLowerCase();
  const path = `sites/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await db.storage
    .from('heritage-photos')
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    note.textContent = 'Choose a photo, or drop one here.';
    return say('error', 'Could not upload that photo.', error.message);
  }

  const { data } = db.storage.from('heritage-photos').getPublicUrl(path);
  pendingImageUrl = data.publicUrl;

  showPreview(pendingImageUrl);
  note.textContent = 'Choose a different photo, or drop one here.';
  clearNotice();
}

// --------------------------------------------------------------- save

el('ed-save').addEventListener('click', async () => {
  const name = el('ed-name').value.trim();
  const summary = el('ed-summary').value.trim();
  const municipality = el('ed-municipality').value.trim();

  if (name.length < 3) return say('error', 'The name needs at least 3 characters.');
  if (!municipality) return say('error', 'Enter the town or city.');
  if (summary.length < 20) {
    return say('error', 'Write a description of at least 20 characters.');
  }

  const lat = parseFloat(el('ed-lat').value);
  const lon = parseFloat(el('ed-lon').value);

  const btn = el('ed-save');
  busy(btn, true, 'Save changes');

  const { error } = await db.rpc('admin_save_site', {
    p_id: editing?.id ?? null,
    p_name: name,
    p_category: el('ed-category').value,
    p_municipality: municipality,
    p_summary: summary,
    p_historical_note: el('ed-note').value.trim() || null,
    p_period: el('ed-period').value.trim() || null,
    p_declaration: el('ed-declaration').value.trim() || null,
    p_image_url: pendingImageUrl,
    p_image_credit: el('ed-credit').value.trim() || null,
    p_source_name: el('ed-source').value.trim() || null,
    p_source_reference: el('ed-reference').value.trim() || null,
    p_latitude: Number.isFinite(lat) ? lat : null,
    p_longitude: Number.isFinite(lon) ? lon : null,
    p_is_active: el('ed-active').checked,
  });

  busy(btn, false, 'Save changes');

  if (error) return say('error', 'Could not save.', error.message);

  edVeil.classList.remove('show');
  say('ok', `${name} saved.`, 'Students see it the next time they open Explore.');

  editing = null;
  pendingImageUrl = null;
  loadCatalogue();
  loadOverview();
});

boot();