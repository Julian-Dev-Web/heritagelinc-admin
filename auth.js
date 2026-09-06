// auth.js — sign in, request access, and the administrator gate.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.HERITAGELINC;
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const el = (id) => document.getElementById(id);

const views = {
  signin: el('view-signin'),
  request: el('view-request'),
  pending: el('view-pending'),
};

const notice = el('notice');

function show(name) {
  Object.values(views).forEach((v) => v.classList.add('hidden'));
  views[name].classList.remove('hidden');
  clearNotice();
}

function say(kind, title, body) {
  notice.className = `notice notice-${kind} show`;
  notice.innerHTML = body
    ? `<strong>${title}</strong>${body}`
    : title;
}

function clearNotice() {
  notice.className = 'notice';
  notice.textContent = '';
}

function busy(button, on, idleLabel) {
  button.disabled = on;
  button.innerHTML = on ? '<span class="spinner"></span>' : idleLabel;
}

document.querySelectorAll('[data-view]').forEach((b) => {
  b.addEventListener('click', () => show(b.dataset.view));
});

// ---------------------------------------------------------------- gate

/// The only thing that decides access. Reads the caller's own profile
/// row, which RLS already limits to themselves, so a non-admin cannot
/// learn anything about anyone else by calling this.
async function isAdmin() {
  const { data, error } = await db
    .from('profiles')
    .select('is_admin')
    .eq('id', (await db.auth.getUser()).data.user.id)
    .maybeSingle();

  if (error) return false;
  return data?.is_admin === true;
}

async function routeAfterAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return show('signin');

  if (await isAdmin()) {
    window.location.href = 'dashboard.html';
  } else {
    show('pending');
  }
}

// ------------------------------------------------------------- sign in

views.signin.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearNotice();

  const email = el('si-email').value.trim();
  const password = el('si-password').value;

  if (!email || !password) {
    return say('error', 'Enter your email and password to continue.');
  }

  busy(el('si-submit'), true, 'Sign in');

  const { error } = await db.auth.signInWithPassword({ email, password });

  if (error) {
    busy(el('si-submit'), false, 'Sign in');
    const m = error.message.toLowerCase();

    if (m.includes('invalid login') || m.includes('credentials')) {
      return say('error', 'That email and password do not match an account.');
    }
    if (m.includes('not confirmed')) {
      return say(
        'info',
        'Confirm your email first',
        'We sent a link when the account was created. Open it, then sign in.',
      );
    }
    return say('error', error.message);
  }

  if (await isAdmin()) {
    window.location.href = 'dashboard.html';
  } else {
    busy(el('si-submit'), false, 'Sign in');
    show('pending');
  }
});

// ------------------------------------------------------ request access

views.request.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearNotice();

  const first = el('rq-first').value.trim();
  const last = el('rq-last').value.trim();
  const email = el('rq-email').value.trim();
  const password = el('rq-password').value;

  if (!first || !last) {
    return say('error', 'Enter your first and last name.');
  }
  if (!email.includes('@') || !email.includes('.')) {
    return say('error', 'Enter a valid email address.');
  }
  if (password.length < 8) {
    return say('error', 'Use a password of at least 8 characters.');
  }
  if (!/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return say('error', 'Include at least one number and one symbol.');
  }

  busy(el('rq-submit'), true, 'Create account');

  // is_admin is never sent from here. It is revoked from the client and
  // can only be set by an existing administrator.
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: { first_name: first, last_name: last, role: 'commuter' },
    },
  });

  busy(el('rq-submit'), false, 'Create account');

  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes('already registered')) {
      return say(
        'info',
        'That email already has an account',
        'Sign in instead, or ask an administrator to grant it access.',
      );
    }
    return say('error', error.message);
  }

  if (!data.session) {
    return say(
      'ok',
      'Check your inbox',
      `We sent a confirmation link to ${email}. Open it, then sign in. ` +
        'An administrator still needs to grant access before you can review anything.',
    );
  }

  show('pending');
});

// ------------------------------------------------------------ sign out

el('pending-signout').addEventListener('click', async () => {
  await db.auth.signOut();
  show('signin');
  say('ok', 'Signed out.');
});

// --------------------------------------------------------------- start

routeAfterAuth();