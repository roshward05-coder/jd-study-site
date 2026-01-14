(() => {
  'use strict';

  // ----------------------------
  // Data model (client-side MVP)
  // ----------------------------
  // units: {id,name,created}
  // items: {id, unitId, title, type, tags[], content, created, pinned:boolean}
  // decks: {id, unitId, name, created, cards:[{id,q,a,box,due,stats:{seen,correct}}]}
  // todos: {id, unitId, text, done, priority, due, created}
  // timetable: {id, unitId, date, time, activity, created}
  // issues: {id, unitId, text, done, created}
  // mastery: {unitId, tag -> 0..100}
  // streak: {lastDayISO, count}
// ========= Supabase (PRIVATE MODE) =========
const SUPABASE_URL = "https://YOURPROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Auth UI elements
const authEmail = document.getElementById("auth-email");
const authSend = document.getElementById("auth-send");
const authLogout = document.getElementById("auth-logout");
const authStatus = document.getElementById("auth-status");

// Require login for app
async function requireAuth() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    authStatus.textContent = "Please log in to use your private library.";
    authLogout.style.display = "none";
    return null;
  }
  authStatus.textContent = `Logged in: ${session.user.email}`;
  authLogout.style.display = "inline-flex";
  return session.user;
}

authSend?.addEventListener("click", async () => {
  const email = (authEmail.value || "").trim();
  if (!email) return alert("Enter your email.");
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) return alert(error.message);
  alert("Login link sent! Check your email.");
});

authLogout?.addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.reload();
});

// Update UI when auth changes
supabase.auth.onAuthStateChange(() => {
  requireAuth().then(() => {
    // After login, reload your library/unit stats from cloud
    if (typeof cloudLoadAll === "function") cloudLoadAll();
  });
});

  const KEY = {
    V: 'jdh_v',
    UNITS: 'jdh_units',
    ITEMS: 'jdh_items',
    DECKS: 'jdh_decks',
    TODOS: 'jdh_todos',
    TT: 'jdh_timetable',
    ISSUES: 'jdh_issues',
    MASTERY: 'jdh_mastery',
    STREAK: 'jdh_streak',
    SELECTED_FOR_TEST: 'jdh_selected_for_test',
    CITATIONS: 'jdh_citations'
  };

  const VERSION = 2;

  // ----------------------------
  // Helpers
  // ----------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const now = () => Date.now();
  const uid = () => now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const toISODate = (d = new Date()) => d.toISOString().slice(0, 10);

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }
  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  function normaliseTags(input) {
    return (input || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20);
  }
function safeFilename(name) {
  return name.replace(/[^\w.\-]+/g, "_");
}

async function cloudUploadPdf(file) {
  const user = await requireAuth();
  if (!user) throw new Error("Not logged in.");

  const path = `${user.id}/${Date.now()}_${safeFilename(file.name)}`;

  const { error } = await supabase
    .storage
    .from("library")
    .upload(path, file, { contentType: "application/pdf", upsert: false });

  if (error) throw error;
  return path;
}

async function cloudSignedUrl(storagePath) {
  const { data, error } = await supabase
    .storage
    .from("library")
    .createSignedUrl(storagePath, 60 * 30); // 30 minutes

  if (error) throw error;
  return data.signedUrl;
}

async function cloudInsertLibraryItem(item) {
  const user = await requireAuth();
  if (!user) throw new Error("Not logged in.");

  const payload = { ...item, user_id: user.id };
  const { error } = await supabase.from("library_items").insert(payload);
  if (error) throw error;
}

async function cloudFetchLibraryItems(unit) {
  const user = await requireAuth();
  if (!user) return [];

  const q = supabase
    .from("library_items")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const { data, error } = unit ? await q.eq("unit", unit) : await q;
  if (error) throw error;
  return data || [];
}

async function cloudDeleteLibraryItem(id, storagePath) {
  const user = await requireAuth();
  if (!user) throw new Error("Not logged in.");

  const { error: dbErr } = await supabase
    .from("library_items")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (dbErr) throw dbErr;

  if (storagePath) {
    const { error: stErr } = await supabase.storage.from("library").remove([storagePath]);
    if (stErr) console.warn("Storage delete failed:", stErr.message);
  }
}

  // ----------------------------
  // Migration from older demo
  // ----------------------------
  function migrateIfNeeded() {
    const v = load(KEY.V, 0);

    // If user is coming from the earlier scaffold in this repo,
    // try to convert sd_* keys into new schema.
    if (v >= VERSION) return;

    const oldUnits = load('sd_units', []);
    const oldDocs = load('sd_docs', []);
    const oldLectures = load('sd_lectures', []);
    const oldDecks = load('sd_decks', []);
    const oldTT = load('sd_timetable', []);
    const oldTodos = load('sd_todos', []);
    const oldIssues = load('sd_issues', []);

    let units = load(KEY.UNITS, []);
    let items = load(KEY.ITEMS, []);
    let decks = load(KEY.DECKS, []);
    let timetable = load(KEY.TT, []);
    let todos = load(KEY.TODOS, []);
    let issues = load(KEY.ISSUES, []);
    let mastery = load(KEY.MASTERY, {});
    let streak = load(KEY.STREAK, { lastDayISO: null, count: 0 });

    // If new store empty but old store has data, migrate.
    const newEmpty = units.length === 0 && items.length === 0 && decks.length === 0;

    if (newEmpty && (oldDocs.length || oldLectures.length || oldUnits.length)) {
      // units
      if (oldUnits.length) {
        units = oldUnits.map((u) => ({ id: u.id || uid(), name: u.name, created: now() }));
      } else {
        units = [{ id: uid(), name: 'My Unit', created: now() }];
      }

      const fallbackUnit = units[0].id;

      // items from docs + lectures
      const mapOld = (d, type) => ({
        id: d.id || uid(),
        unitId: fallbackUnit,
        title: d.title || 'Untitled',
        type,
        tags: [],
        content: d.content || '',
        created: d.created || now(),
        pinned: false
      });
      const fromDocs = oldDocs.map((d) => mapOld(d, d.isCase ? 'case' : 'note'));
      const fromLectures = oldLectures.map((l) => mapOld(l, 'lecture'));
      items = [...fromDocs, ...fromLectures];

      // decks
      decks = oldDecks.map((dk) => ({
        id: dk.id || uid(),
        unitId: fallbackUnit,
        name: dk.name || 'Deck',
        created: now(),
        cards: (dk.cards || []).map((c) => ({
          id: uid(),
          q: c.q,
          a: c.a,
          box: c.known ? 3 : 1,
          due: toISODate(new Date()),
          stats: { seen: 0, correct: 0 }
        }))
      }));

      // timetable
      timetable = oldTT.map((t) => ({
        id: t.id || uid(),
        unitId: fallbackUnit,
        date: t.date,
        time: t.time,
        activity: t.activity,
        created: now()
      }));

      // todos
      todos = oldTodos.map((t) => ({
        id: t.id || uid(),
        unitId: fallbackUnit,
        text: t.text,
        done: !!t.done,
        priority: 'med',
        due: '',
        created: now()
      }));

      // issues
      issues = oldIssues.map((it) => ({
        id: it.id || uid(),
        unitId: fallbackUnit,
        text: it.text,
        done: !!it.done,
        created: now()
      }));

      mastery[fallbackUnit] = mastery[fallbackUnit] || {};
      save(KEY.UNITS, units);
      save(KEY.ITEMS, items);
      save(KEY.DECKS, decks);
      save(KEY.TT, timetable);
      save(KEY.TODOS, todos);
      save(KEY.ISSUES, issues);
      save(KEY.MASTERY, mastery);
      save(KEY.STREAK, streak);
    }

    save(KEY.V, VERSION);
  }

  // ----------------------------
  // App state
  // ----------------------------
  migrateIfNeeded();

  let units = load(KEY.UNITS, []);
  let items = load(KEY.ITEMS, []);
  let decks = load(KEY.DECKS, []);
  let timetable = load(KEY.TT, []);
  let todos = load(KEY.TODOS, []);
  let issues = load(KEY.ISSUES, []);
  let mastery = load(KEY.MASTERY, {});
  let streak = load(KEY.STREAK, { lastDayISO: null, count: 0 });
  let selectedForTest = load(KEY.SELECTED_FOR_TEST, []);

  // AGLC4 citation history: {id, type, full, shortTitle, created}
  let citations = load(KEY.CITATIONS, []);

  let activeUnitId = null;
  let openItemId = null;

  // ----------------------------
  // Router / navigation
  // ----------------------------
  const views = {
    units: $('#view-units'),
    library: $('#view-library'),
    learn: $('#view-learn'),
    flashcards: $('#view-flashcards'),
    tests: $('#view-tests'),
    citations: $('#view-citations'),
    timetable: $('#view-timetable'),
    tasks: $('#view-tasks'),
    exampack: $('#view-exampack'),
    settings: $('#view-settings')
  };

  function show(viewName) {
    Object.entries(views).forEach(([k, el]) => {
      if (!el) return;
      el.style.display = (k === viewName) ? 'block' : 'none';
    });
    $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === viewName));
  }

  $$('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => show(btn.dataset.view));
  });

  // ----------------------------
  // Theme toggle
  // ----------------------------
  $('#theme-toggle')?.addEventListener('click', () => {
    document.body.classList.toggle('theme-light');
    document.body.classList.toggle('theme-default');
  });

  // ----------------------------
  // Units
  // ----------------------------
  function ensureDefaultUnit() {
    if (!units.length) {
      units = [
        { id: uid(), name: 'Contracts', created: now() },
        { id: uid(), name: 'Torts', created: now() },
        { id: uid(), name: 'Criminal Law', created: now() },
        { id: uid(), name: 'Public Law', created: now() }
      ];
      save(KEY.UNITS, units);
    }
    activeUnitId = activeUnitId || units[0].id;
  }

  function renderUnitSelect() {
    const sel = $('#active-unit');
    if (!sel) return;
    sel.innerHTML = '';
    units.forEach((u) => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.name;
      sel.appendChild(opt);
    });
    sel.value = activeUnitId;
  }

  $('#active-unit')?.addEventListener('change', (e) => {
    activeUnitId = e.target.value;
    openItemId = null;
    selectedForTest = [];
    save(KEY.SELECTED_FOR_TEST, selectedForTest);
    refreshAll();
  });

  $('#add-unit')?.addEventListener('click', () => {
    const name = ($('#new-unit-input')?.value || '').trim();
    if (!name) return;
    const u = { id: uid(), name, created: now() };
    units.push(u);
    save(KEY.UNITS, units);
    $('#new-unit-input').value = '';
    activeUnitId = u.id;
    renderUnitSelect();
    refreshAll();
  });

  // ----------------------------
  // Library: adding / uploading
  // ----------------------------
  async function extractTextFromPDF(file) {
    try {
      if (!window.pdfjsLib) {
        alert('pdf.js not loaded. Run via a local web server (see footer).');
        return '';
      }
      const arrayBuffer = await file.arrayBuffer();
      const loading = pdfjsLib.getDocument({ data: arrayBuffer });
      const doc = await loading.promise;
      let full = '';
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        full += content.items.map((it) => it.str).join(' ') + '\n\n';
      }
      return full.trim();
    } catch (err) {
      console.error('PDF extract error', err);
      return '';
    }
  }

  function addItem({ title, type, tags, content }) {
    const it = {
      id: uid(),
      unitId: activeUnitId,
      title: title || 'Untitled',
      type: type || 'note',
      tags: Array.isArray(tags) ? tags : [],
      content: content || '',
      created: now(),
      pinned: false
    };
    items.unshift(it);
    save(KEY.ITEMS, items);
    return it;
  }

  $('#add-text-item')?.addEventListener('click', () => {
    const title = ($('#item-title')?.value || '').trim() || 'Untitled';
    const type = $('#item-type')?.value || 'note';
    const tags = normaliseTags($('#item-tags')?.value || '');
    const it = addItem({ title, type, tags, content: '' });
    $('#item-title').value = '';
    $('#item-tags').value = '';
    openLibraryItem(it.id);
    renderLibrary();
    renderTags();
  });

  $('#file-input')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    const type = $('#item-type')?.value || 'note';
    const tags = normaliseTags($('#item-tags')?.value || '');
    for (const f of files) {
      const isPDF = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
      const content = isPDF ? await extractTextFromPDF(f) : await f.text();
      addItem({ title: f.name, type, tags, content });
    }
    e.target.value = '';
    renderLibrary();
    renderTags();
    renderStats();
    renderUnitCards();
  });

  // ----------------------------
  // Library: list / open / edit
  // ----------------------------
  function unitItems() {
    return items.filter((it) => it.unitId === activeUnitId);
  }

  function openLibraryItem(id) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    openItemId = id;
    $('#open-item-title').textContent = it.title;
    $('#open-item-meta').textContent = `${it.type.toUpperCase()} • ${it.tags.join(', ') || 'No tags'} • ${new Date(it.created).toLocaleString()}`;
    $('#doc-body').textContent = it.content || '';
    $('#summary').textContent = '—';
    $('#concepts').innerHTML = '';
  }

  function renderLibrary() {
    const list = $('#library-list');
    if (!list) return;

    const typeFilter = $('#filter-type')?.value || '';
    const tagFilter = $('#filter-tag')?.value || '';
    const filtered = unitItems().filter((it) => {
      const okType = typeFilter ? it.type === typeFilter : true;
      const okTag = tagFilter ? (it.tags || []).includes(tagFilter) : true;
      return okType && okTag;
    });

    list.innerHTML = '';
    if (!filtered.length) {
      list.innerHTML = '<div class="muted small">No items yet. Upload a lecture, case, tutorial or note.</div>';
      return;
    }

    filtered.forEach((it) => {
      const div = document.createElement('div');
      div.className = 'item';
      div.dataset.id = it.id;

      const tags = (it.tags || []).slice(0, 3).map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join(' ');
      const pin = it.pinned ? '<span class="pill">Pinned</span>' : '';
      div.innerHTML = `
        <div class="row between">
          <strong>${escapeHtml(it.title)}</strong>
          <div class="row gap">${pin}<span class="badge">${escapeHtml(it.type)}</span></div>
        </div>
        <div class="muted small" style="margin-top:6px">${tags || '<span class="muted small">No tags</span>'}</div>
      `;

      div.addEventListener('click', () => {
        openLibraryItem(it.id);
      });

      list.appendChild(div);
    });

    // If nothing open yet, open first
    if (!openItemId && filtered[0]) openLibraryItem(filtered[0].id);
  }

  $('#filter-type')?.addEventListener('change', renderLibrary);
  $('#filter-tag')?.addEventListener('change', renderLibrary);

  // Edit toggle
  $('#toggle-edit')?.addEventListener('click', () => {
    const body = $('#doc-body');
    if (!body) return;
    const isEditing = body.getAttribute('contenteditable') === 'true';
    body.setAttribute('contenteditable', isEditing ? 'false' : 'true');
    $('#toggle-edit').textContent = isEditing ? 'Edit' : 'Save';
    if (isEditing && openItemId) {
      const it = items.find((x) => x.id === openItemId);
      if (it) {
        it.content = body.textContent || '';
        save(KEY.ITEMS, items);
      }
    }
  });

  // Highlight selection (wrap selection in <mark>)
  function wrapSelectionWithMark(container) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return false;
    const mark = document.createElement('mark');
    mark.className = 'mark';
    range.surroundContents(mark);
    sel.removeAllRanges();
    return true;
  }

  $('#highlight-btn')?.addEventListener('click', () => {
    const body = $('#doc-body');
    if (!body) return;
    // Use rich text during highlight; then save back as plain text with \n.
    if (body.getAttribute('contenteditable') !== 'true') {
      body.setAttribute('contenteditable', 'true');
      $('#toggle-edit').textContent = 'Save';
    }
    const ok = wrapSelectionWithMark(body);
    if (!ok) return alert('Select text in the open item to highlight.');
  });

  // Save highlights when leaving edit mode or on demand by converting to plain text
  function persistOpenItemFromBody() {
    const body = $('#doc-body');
    if (!body || !openItemId) return;
    const it = items.find((x) => x.id === openItemId);
    if (!it) return;
    // Strip mark tags but keep text.
    it.content = body.textContent || '';
    save(KEY.ITEMS, items);
  }

  // Delete open item
  $('#delete-open')?.addEventListener('click', () => {
    if (!openItemId) return;
    const it = items.find((x) => x.id === openItemId);
    if (!it) return;
    if (!confirm(`Delete “${it.title}”?`)) return;
    items = items.filter((x) => x.id !== openItemId);
    save(KEY.ITEMS, items);
    openItemId = null;
    renderLibrary();
    renderTags();
    renderStats();
    renderUnitCards();
  });

  // Pin to exam pack
  $('#pin-to-exampack')?.addEventListener('click', () => {
    if (!openItemId) return;
    const it = items.find((x) => x.id === openItemId);
    if (!it) return;
    it.pinned = !it.pinned;
    save(KEY.ITEMS, items);
    renderLibrary();
    renderPackList();
  });

  // ----------------------------
  // Summariser + concept extractor
  // ----------------------------
  function summarize(text, topN = 4) {
    const sents = (text || '')
      .split(/[\.!?]\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20);

    if (sents.length <= topN) return sents;

    const stop = new Set([
      'the', 'and', 'of', 'to', 'a', 'in', 'is', 'for', 'that', 'on', 'with', 'as', 'by',
      'an', 'are', 'this', 'it', 'be', 'or', 'from', 'at', 'was', 'were', 'can', 'may',
      'must', 'should', 'not', 'but', 'if', 'into', 'their', 'there', 'which', 'also'
    ]);
    const freq = {};
    for (const s of sents) {
      for (const w0 of s.split(/\W+/)) {
        const w = w0.toLowerCase();
        if (!w || stop.has(w)) continue;
        freq[w] = (freq[w] || 0) + 1;
      }
    }
    const scored = sents.map((s) => {
      const sc = s.split(/\W+/).reduce((acc, w0) => {
        const w = w0.toLowerCase();
        return acc + (freq[w] || 0);
      }, 0);
      return { s, sc };
    });
    scored.sort((a, b) => b.sc - a.sc);
    return scored.slice(0, topN).map((x) => x.s);
  }

  function extractConcepts(text, max = 12) {
    const raw = (text || '').replace(/\s+/g, ' ').trim();
    if (!raw) return [];
    const words = raw.split(/\W+/).filter(Boolean);
    const stop = new Set(['the','and','of','to','a','in','is','for','that','on','with','as','by','an','are','this','it','be','or','from','at']);
    const freq = {};
    for (const w0 of words) {
      const w = w0.toLowerCase();
      if (w.length < 5 || stop.has(w)) continue;
      freq[w] = (freq[w] || 0) + 1;
    }
    const ranked = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, max * 2)
      .map(([w]) => w);

    // Also pick capitalised phrases (case names, doctrines)
    const caps = (text || '').match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g) || [];
    const capRank = [...new Set(caps)]
      .filter((p) => p.length >= 8 && p.split(' ').length <= 4)
      .slice(0, max);

    const mix = [...new Set([...capRank, ...ranked])].slice(0, max);
    return mix;
  }

  $('#summarize-btn')?.addEventListener('click', () => {
    if (!openItemId) return alert('Open an item first.');
    persistOpenItemFromBody();
    const it = items.find((x) => x.id === openItemId);
    const sum = summarize(it?.content || '', 4);
    $('#summary').innerHTML = sum.length
      ? `<ol class="small">${sum.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`
      : '<span class="muted">—</span>';
  });

  let lastConcepts = [];
  $('#extract-concepts')?.addEventListener('click', () => {
    if (!openItemId) return alert('Open an item first.');
    persistOpenItemFromBody();
    const it = items.find((x) => x.id === openItemId);
    lastConcepts = extractConcepts(it?.content || '', 14);
    const c = $('#concepts');
    c.innerHTML = '';
    lastConcepts.forEach((t) => {
      const el = document.createElement('div');
      el.className = 'chip';
      el.textContent = t;
      c.appendChild(el);
    });
    if (!lastConcepts.length) c.innerHTML = '<span class="muted small">No concepts found.</span>';
  });

  // ----------------------------
  // Flashcards: Leitner spaced repetition
  // ----------------------------
  const BOX_DAYS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 14 };

  function unitDecks() {
    return decks.filter((d) => d.unitId === activeUnitId);
  }

  function saveDecks() {
    save(KEY.DECKS, decks);
  }

  function ensureDefaultDeck() {
    if (!unitDecks().length) {
      const d = {
        id: uid(),
        unitId: activeUnitId,
        name: 'General',
        created: now(),
        cards: []
      };
      decks.push(d);
      saveDecks();
    }
  }

  function renderDeckSelect() {
    const sel = $('#deck-select');
    if (!sel) return;
    sel.innerHTML = '';
    const ds = unitDecks();
    ds.forEach((dk) => {
      const opt = document.createElement('option');
      opt.value = dk.id;
      opt.textContent = `${dk.name} (${dk.cards.length})`;
      sel.appendChild(opt);
    });
    if (!sel.value && ds[0]) sel.value = ds[0].id;
  }

  $('#new-empty-deck')?.addEventListener('click', () => {
    const name = prompt('Deck name', 'New deck');
    if (!name) return;
    decks.push({ id: uid(), unitId: activeUnitId, name, created: now(), cards: [] });
    saveDecks();
    renderDeckSelect();
    renderDueList();
    renderStats();
  });

  $('#delete-deck')?.addEventListener('click', () => {
    const sel = $('#deck-select');
    if (!sel?.value) return;
    const dk = decks.find((d) => d.id === sel.value);
    if (!dk) return;
    if (!confirm(`Delete deck “${dk.name}”?`)) return;
    decks = decks.filter((d) => d.id !== dk.id);
    saveDecks();
    ensureDefaultDeck();
    renderDeckSelect();
    loadDeck($('#deck-select').value);
    renderDueList();
    renderStats();
  });

  function addCardToDeck(deckId, q, a) {
    const dk = decks.find((d) => d.id === deckId);
    if (!dk) return;
    dk.cards.push({
      id: uid(),
      q: q || '',
      a: a || '',
      box: 1,
      due: toISODate(new Date()),
      stats: { seen: 0, correct: 0 }
    });
    saveDecks();
  }

  $('#add-card')?.addEventListener('click', () => {
    const q = ($('#card-q')?.value || '').trim();
    const a = ($('#card-a')?.value || '').trim();
    if (!q || !a) return alert('Add both front and back.');
    const deckId = $('#deck-select')?.value;
    if (!deckId) return;
    addCardToDeck(deckId, q, a);
    $('#card-q').value = '';
    $('#card-a').value = '';
    renderDeckSelect();
    renderDueList();
    renderStats();
    loadDeck(deckId);
  });

  // Create deck from open item (Quizlet-ish)
  function makeClozeCards(text, limit = 30) {
    const sents = (text || '')
      .split(/[\.!?]\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 35)
      .slice(0, 200);

    const concepts = extractConcepts(text, 40).map((t) => t.split(' ')[0]);
    return sents.slice(0, limit).map((s) => {
      const words = s.split(/\s+/);
      let pivot = words.reduce((best, w) => (w.length > best.length ? w : best), '');
      // Prefer concept words if present
      for (const c of concepts) {
        const re = new RegExp(`\\b${c}\\b`, 'i');
        if (re.test(s) && c.length >= 5) { pivot = c; break; }
      }
      const q = s.replace(new RegExp(`\\b${pivot}\\b`, 'i'), '_____');
      return { q, a: s };
    });
  }

  $('#create-deck-from-open')?.addEventListener('click', () => {
    if (!openItemId) return alert('Open a library item first.');
    persistOpenItemFromBody();
    const it = items.find((x) => x.id === openItemId);
    if (!it) return;
    const name = prompt('Deck name', `${it.title} — deck`) || `${it.title} — deck`;
    const cards = makeClozeCards(it.content, 28);

    const deckId = uid();
    decks.push({
      id: deckId,
      unitId: activeUnitId,
      name,
      created: now(),
      cards: cards.map((c) => ({
        id: uid(),
        q: c.q,
        a: c.a,
        box: 1,
        due: toISODate(new Date()),
        stats: { seen: 0, correct: 0 }
      }))
    });

    saveDecks();
    renderDeckSelect();
    loadDeck(deckId);
    show('flashcards');
    renderDueList();
    renderStats();
    alert('Deck created.');
  });

  $('#qa-generate-deck')?.addEventListener('click', () => {
    show('library');
    setTimeout(() => $('#create-deck-from-open')?.click(), 50);
  });

  // Flashcard session
  let currentDeckId = null;
  let currentCardIndex = 0;
  let reviewMode = 'all'; // all | due

  function currentDeck() {
    return decks.find((d) => d.id === currentDeckId);
  }

  function dueCards(deck) {
    const today = toISODate(new Date());
    return (deck?.cards || []).filter((c) => !c.due || c.due <= today);
  }

  function renderDeckStats() {
    const deck = currentDeck();
    const el = $('#deck-stats');
    if (!el || !deck) return;
    const due = dueCards(deck).length;
    const total = deck.cards.length;
    const boxes = [1,2,3,4,5].map((b) => deck.cards.filter((c) => c.box === b).length);
    el.innerHTML = `Total: <strong>${total}</strong> • Due today: <strong>${due}</strong><br>
      Boxes: ${boxes.map((n, i) => `<span class="badge">B${i+1}: ${n}</span>`).join(' ')}`;
  }

  function cardPool(deck) {
    if (!deck) return [];
    return reviewMode === 'due' ? dueCards(deck) : deck.cards;
  }

  function showCard() {
    const deck = currentDeck();
    const pool = cardPool(deck);
    if (!deck || !pool.length) {
      $('#card-info').textContent = 'No cards (or none due).';
      $('#question').textContent = '—';
      $('#answer').style.display = 'none';
      $('#answer').textContent = '';
      return;
    }
    const idx = clamp(currentCardIndex, 0, pool.length - 1);
    currentCardIndex = idx;
    const card = pool[idx];

    $('#card-info').textContent = `${deck.name} • ${reviewMode === 'due' ? 'Due' : 'All'} • Card ${idx + 1}/${pool.length} • Box ${card.box}`;
    $('#question').textContent = card.q;
    $('#answer').textContent = card.a;
    $('#answer').style.display = 'none';
    renderDeckStats();
  }

  function loadDeck(deckId) {
    currentDeckId = deckId;
    currentCardIndex = 0;
    reviewMode = 'all';
    showCard();
  }

  $('#deck-select')?.addEventListener('change', (e) => {
    loadDeck(e.target.value);
    renderDueList();
  });

  $('#study-due')?.addEventListener('click', () => {
    reviewMode = 'due';
    currentCardIndex = 0;
    showCard();
  });

  $('#show-answer')?.addEventListener('click', () => {
    $('#answer').style.display = 'block';
  });

  $('#next-card')?.addEventListener('click', () => {
    const pool = cardPool(currentDeck());
    if (!pool.length) return;
    currentCardIndex = (currentCardIndex + 1) % pool.length;
    showCard();
  });

  $('#prev-card')?.addEventListener('click', () => {
    const pool = cardPool(currentDeck());
    if (!pool.length) return;
    currentCardIndex = (currentCardIndex - 1 + pool.length) % pool.length;
    showCard();
  });

  function reschedule(card, correct) {
    const box = correct ? clamp((card.box || 1) + 1, 1, 5) : 1;
    card.box = box;
    const days = BOX_DAYS[box] ?? 0;
    const due = new Date();
    due.setDate(due.getDate() + days);
    card.due = toISODate(due);
  }

  $('#mark-known')?.addEventListener('click', () => {
    const deck = currentDeck();
    const pool = cardPool(deck);
    if (!deck || !pool.length) return;
    const card = pool[currentCardIndex];

    card.stats.seen += 1;
    card.stats.correct += 1;
    reschedule(card, true);
    saveDecks();

    bumpStreak();
    renderDueList();
    renderStats();
    $('#next-card').click();
  });

  $('#mark-again')?.addEventListener('click', () => {
    const deck = currentDeck();
    const pool = cardPool(deck);
    if (!deck || !pool.length) return;
    const card = pool[currentCardIndex];

    card.stats.seen += 1;
    reschedule(card, false);
    saveDecks();

    bumpStreak();
    renderDueList();
    renderStats();
    $('#next-card').click();
  });

  function renderDueList() {
    const el = $('#due-list');
    if (!el) return;
    const ds = unitDecks();
    const today = toISODate(new Date());
    const due = [];
    ds.forEach((dk) => {
      (dk.cards || []).forEach((c) => {
        if (!c.due || c.due <= today) due.push({ deck: dk.name, q: c.q, box: c.box });
      });
    });
    el.innerHTML = '';
    if (!due.length) {
      el.innerHTML = '<div class="muted small">No cards due today.</div>';
      return;
    }
    due.slice(0, 14).forEach((d) => {
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML = `<div class="row between"><strong>${escapeHtml(d.deck)}</strong><span class="badge">Box ${d.box}</span></div>
                       <div class="muted small" style="margin-top:6px">${escapeHtml(d.q).slice(0, 140)}${d.q.length > 140 ? '…' : ''}</div>`;
      el.appendChild(div);
    });
  }

  // ----------------------------
  // Learn: skills (tags) + mastery
  // ----------------------------
  function unitMastery() {
    mastery[activeUnitId] = mastery[activeUnitId] || {};
    return mastery[activeUnitId];
  }

  function renderTags() {
    const tagSel = $('#filter-tag');
    const testTagSel = $('#test-tag');
    const practiceSel = $('#practice-skill');
    if (!tagSel || !testTagSel || !practiceSel) return;

    const tags = new Set();
    unitItems().forEach((it) => (it.tags || []).forEach((t) => tags.add(t)));
    const list = Array.from(tags).sort((a, b) => a.localeCompare(b));

    tagSel.innerHTML = '<option value="">All topics</option>' + list.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    testTagSel.innerHTML = '<option value="">Choose topic</option>' + list.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    practiceSel.innerHTML = '<option value="">Choose a skill/topic</option>' + list.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');

    renderSkills();
  }

  function renderSkills() {
    const container = $('#skills');
    if (!container) return;
    const m = unitMastery();
    const tags = new Set();
    unitItems().forEach((it) => (it.tags || []).forEach((t) => tags.add(t)));
    const list = Array.from(tags).sort((a, b) => a.localeCompare(b));
    container.innerHTML = '';
    if (!list.length) {
      container.innerHTML = '<div class="muted small">No skills yet. Add tags to library items (e.g., Offer, Consideration, Mens rea).</div>';
      return;
    }

    list.forEach((tag) => {
      const val = clamp(m[tag] ?? 0, 0, 100);
      const div = document.createElement('div');
      div.className = 'skill';
      div.innerHTML = `
        <div class="row between">
          <strong>${escapeHtml(tag)}</strong>
          <span class="badge">${val}%</span>
        </div>
        <div class="bar"><div style="width:${val}%"></div></div>
        <div class="muted small" style="margin-top:6px">${val < 40 ? 'Needs practice' : val < 75 ? 'Developing' : 'Strong'}</div>
      `;
      container.appendChild(div);
    });
  }

  function adjustMastery(tags, delta) {
    const m = unitMastery();
    (tags || []).forEach((t) => {
      const cur = clamp(m[t] ?? 0, 0, 100);
      m[t] = clamp(cur + delta, 0, 100);
    });
    save(KEY.MASTERY, mastery);
    renderSkills();
  }

  // ----------------------------
  // Tests: generate MCQ / short / cloze
  // ----------------------------
  function pickSourcesForTest(mode, tag) {
    if (mode === 'selected') {
      return unitItems().filter((it) => selectedForTest.includes(it.id));
    }
    if (mode === 'tag') {
      return unitItems().filter((it) => (it.tags || []).includes(tag));
    }
    return unitItems();
  }

  function buildQuestionBank(sourceItems) {
    const bank = [];
    sourceItems.forEach((it) => {
      const text = it.content || '';
      if (!text.trim()) return;

      const concepts = extractConcepts(text, 20);
      const sents = text.split(/[\.!?]\s+/).map((s) => s.trim()).filter((s) => s.length > 40);

      // Cloze from sentences
      sents.slice(0, 14).forEach((s) => {
        const pick = concepts.find((c) => new RegExp(`\\b${c.split(' ')[0]}\\b`, 'i').test(s)) || concepts[0];
        if (!pick) return;
        const term = pick.split(' ')[0];
        const q = s.replace(new RegExp(`\\b${term}\\b`, 'i'), '_____');
        bank.push({ type: 'cloze', q, a: term, tags: it.tags || [], itemId: it.id });
      });

      // Short answer prompts from concepts
      concepts.slice(0, 10).forEach((c) => {
        bank.push({
          type: 'short',
          q: `Explain: ${c}`,
          a: '',
          tags: it.tags || [],
          itemId: it.id,
          hint: `Look for mentions of “${c}” in ${it.title}.`
        });
      });
    });

    // MCQ from global concept pool across items
    const allConcepts = [];
    sourceItems.forEach((it) => extractConcepts(it.content || '', 16).forEach((c) => allConcepts.push(c)));
    const uniq = [...new Set(allConcepts)].filter((c) => c.length >= 4);
    const distract = (ans) => {
      const pool = uniq.filter((x) => x !== ans);
      const picks = [];
      while (picks.length < 3 && pool.length) {
        const i = Math.floor(Math.random() * pool.length);
        picks.push(pool.splice(i, 1)[0]);
      }
      return picks;
    };
    uniq.slice(0, 25).forEach((ans) => {
      const opts = [...distract(ans), ans].sort(() => Math.random() - 0.5);
      bank.push({
        type: 'mcq',
        q: `Which option best matches this key term?`,
        a: ans,
        options: opts,
        tags: [],
        itemId: null
      });
    });

    return bank;
  }

  function selectQuestions(bank, count, mix) {
    const byType = {
      mcq: bank.filter((q) => q.type === 'mcq'),
      short: bank.filter((q) => q.type === 'short'),
      cloze: bank.filter((q) => q.type === 'cloze')
    };
    const pickN = (arr, n) => {
      const copy = arr.slice();
      const out = [];
      while (out.length < n && copy.length) {
        const i = Math.floor(Math.random() * copy.length);
        out.push(copy.splice(i, 1)[0]);
      }
      return out;
    };

    let mcqN = Math.round(count * 0.45);
    let shortN = Math.round(count * 0.25);
    let clozeN = count - mcqN - shortN;

    if (mix === 'mcq') { mcqN = Math.round(count * 0.7); shortN = Math.round(count * 0.15); clozeN = count - mcqN - shortN; }
    if (mix === 'short') { shortN = Math.round(count * 0.6); mcqN = Math.round(count * 0.25); clozeN = count - mcqN - shortN; }
    if (mix === 'cloze') { clozeN = Math.round(count * 0.6); mcqN = Math.round(count * 0.25); shortN = count - mcqN - clozeN; }

    const out = [
      ...pickN(byType.mcq, mcqN),
      ...pickN(byType.short, shortN),
      ...pickN(byType.cloze, clozeN)
    ];
    return out.sort(() => Math.random() - 0.5);
  }

  function renderTestBuilderUI() {
    const src = $('#test-source')?.value;
    $('#test-tag').style.display = (src === 'tag') ? 'block' : 'none';
  }

  // ----------------------------
  // AGLC4 citations (client-side helper)
  // ----------------------------
  function showCiteForm(type) {
    const forms = {
      case: $('#cite-form-case'),
      legislation: $('#cite-form-legislation'),
      journal: $('#cite-form-journal'),
      book: $('#cite-form-book'),
      web: $('#cite-form-web'),
    };
    Object.entries(forms).forEach(([k, el]) => {
      if (!el) return;
      el.style.display = (k === type) ? 'block' : 'none';
    });
  }

  // Very small helpers — this is not a complete AGLC4 engine.
  const clean = (s) => (s || '').toString().trim();
  const join = (parts, sep = ' ') => parts.filter(Boolean).join(sep).replace(/\s+/g, ' ').trim();
  const wrapAngle = (url) => {
    const u = clean(url);
    if (!u) return '';
    return u.startsWith('<') ? u : `<${u}>`;
  };

  // Pinpoints: AGLC uses no 'p'/'pg' and paragraph numbers in [ ].
  // We let users type a preformatted pinpoint, but offer page/para inputs for cases.
  function casePinpoint(page, para) {
    const p = clean(page);
    const q = clean(para);
    if (p && q) return `${p} [${q}]`;
    if (p) return p;
    if (q) return `[${q}]`;
    return '';
  }

  function formatCase() {
    const name = clean($('#case-name')?.value);
    const year = clean($('#case-year')?.value);
    const report = clean($('#case-report')?.value);
    const start = clean($('#case-start')?.value);
    const pin = casePinpoint($('#case-pinpage')?.value, $('#case-pinpara')?.value);
    const judge = clean($('#case-jjudge')?.value);
    const short = clean($('#case-short')?.value);

    // Accept either:
    // - Reported: Name (YEAR) VOL REPORT START, PIN (JUDGE) ('SHORT').
    // - Medium neutral: Name [YEAR] COURTID JNO, [PIN] (JUDGE) ('SHORT').
    // We keep it flexible by trusting the user's report string.
    const core = join([
      name,
      year ? (year.startsWith('[') ? year : `(${year})`) : '',
      report,
      start
    ]);
    const withPin = pin ? `${core}, ${pin}` : core;
    const withJudge = judge ? `${withPin} (${judge})` : withPin;
    const withShort = short ? `${withJudge} (‘${short.replace(/^‘|’$/g,'').replace(/^'|"|’|‘/g,'').replace(/'|"|’|‘$/g,'')}’)` : withJudge;
    return withShort ? `${withShort}.` : '';
  }

  function formatLegislation() {
    const title = clean($('#leg-title')?.value);
    const year = clean($('#leg-year')?.value);
    const jur = clean($('#leg-jur')?.value);
    const pin = clean($('#leg-pin')?.value);
    const short = clean($('#leg-short')?.value);
    const core = join([title, year, jur]);
    const withPin = pin ? `${core} ${pin}` : core;
    const withShort = short ? `${withPin} (‘${short}’)` : withPin;
    return withShort ? `${withShort}.` : '';
  }

  function formatJournal() {
    const author = clean($('#j-author')?.value);
    const title = clean($('#j-title')?.value);
    const year = clean($('#j-year')?.value);
    const vol = clean($('#j-vol')?.value);
    const issue = clean($('#j-issue')?.value);
    const journal = clean($('#j-journal')?.value);
    const start = clean($('#j-start')?.value);
    const pin = clean($('#j-pin')?.value);
    const short = clean($('#j-short')?.value);

    const volIssue = issue ? `${vol}(${issue})` : vol;
    const core = join([
      author ? `${author},` : '',
      title ? `‘${title}’,` : '',
      year ? `(${year})` : '',
      volIssue,
      journal,
      start
    ]);
    const withPin = pin ? `${core}, ${pin}` : core;
    const withShort = short ? `${withPin} (‘${short}’)` : withPin;
    return withShort ? `${withShort}.` : '';
  }

  function formatBook() {
    const author = clean($('#b-author')?.value);
    const title = clean($('#b-title')?.value);
    const publisher = clean($('#b-publisher')?.value);
    const edition = clean($('#b-edition')?.value);
    const year = clean($('#b-year')?.value);
    const pin = clean($('#b-pin')?.value);
    const short = clean($('#b-short')?.value);

    const ed = edition ? `${edition} ed,` : '';
    const core = join([
      author ? `${author},` : '',
      title,
      `(${join([publisher, ed, year], ' ')})`
    ]);
    const withPin = pin ? `${core} ${pin}` : core;
    const withShort = short ? `${withPin} (‘${short}’)` : withPin;
    return withShort ? `${withShort}.` : '';
  }

  function formatWeb() {
    const author = clean($('#w-author')?.value);
    const title = clean($('#w-title')?.value);
    const type = clean($('#w-type')?.value) || 'Web Page';
    const date = clean($('#w-date')?.value);
    const pin = clean($('#w-pin')?.value);
    const url = wrapAngle($('#w-url')?.value);
    const short = clean($('#w-short')?.value);

    // URL handling (angle brackets, end of citation, no retrieval date).
    // (AGLC4 rule 4.4)
    const core = join([
      author ? `${author},` : '',
      title ? `‘${title}’` : '',
      `(${type}${date ? `, ${date}` : ''})`
    ]);
    const withPin = pin ? `${core} ${pin}` : core;
    const withUrl = url ? `${withPin} ${url}` : withPin;
    const withShort = short ? `${withUrl} (‘${short}’)` : withUrl;
    return withShort ? `${withShort}.` : '';
  }

  function buildCitationFromForm(type) {
    switch (type) {
      case 'case': return formatCase();
      case 'legislation': return formatLegislation();
      case 'journal': return formatJournal();
      case 'book': return formatBook();
      case 'web': return formatWeb();
      default: return '';
    }
  }

  function renderCitationHistory() {
    const list = $('#cite-history');
    const sel = $('#cite-sub-source');
    if (!list) return;
    list.innerHTML = '';
    if (sel) {
      sel.innerHTML = '<option value="">Choose saved citation…</option>';
    }

    citations.slice().reverse().forEach((c) => {
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML = `
        <div class="row between">
          <strong>${escapeHTML(c.shortTitle || c.type.toUpperCase())}</strong>
          <span class="badge">#${c.n}</span>
        </div>
        <div class="muted small">${escapeHTML(c.full)}</div>
      `;
      div.addEventListener('click', async () => {
        await navigator.clipboard?.writeText(c.full);
        toast('Copied citation');
      });
      list.appendChild(div);
      if (sel) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `#${c.n} — ${c.shortTitle || c.type}`;
        sel.appendChild(opt);
      }
    });
  }

  function initCitations() {
    const typeSel = $('#cite-type');
    const out = $('#cite-output');

    typeSel?.addEventListener('change', () => showCiteForm(typeSel.value));
    showCiteForm(typeSel?.value || 'case');

    $('#cite-clear')?.addEventListener('click', () => {
      $$('#view-citations input, #view-citations textarea').forEach((el) => {
        if (el.id === 'cite-output' || el.id === 'cite-sub-output') return;
        el.value = '';
      });
      toast('Cleared');
    });

    $('#cite-generate')?.addEventListener('click', () => {
      const type = typeSel?.value || 'case';
      const citation = buildCitationFromForm(type);
      if (!citation) return toast('Fill in the fields first');
      if (out) out.value = citation;
    });

    $('#cite-copy')?.addEventListener('click', async () => {
      const v = clean(out?.value);
      if (!v) return toast('Nothing to copy');
      await navigator.clipboard?.writeText(v);
      toast('Copied');
    });

    $('#cite-save')?.addEventListener('click', () => {
      const type = typeSel?.value || 'case';
      const full = clean(out?.value) || buildCitationFromForm(type);
      if (!full) return toast('Generate a citation first');

      // best-effort shortTitle: prefer per-form short title fields
      const shortTitle = clean($('#case-short')?.value) || clean($('#leg-short')?.value) || clean($('#j-short')?.value) || clean($('#b-short')?.value) || clean($('#w-short')?.value) || type;

      const entry = { id: uid(), type, full, shortTitle, created: now(), n: (citations.reduce((m,c)=>Math.max(m, c.n||0), 0) + 1) };
      citations.push(entry);
      save(KEY.CITATIONS, citations);
      renderCitationHistory();

      // Save to library as a note for the current unit
      const title = `Citation — ${shortTitle}`;
      const item = { id: uid(), unitId: activeUnitId, title, type: 'note', tags: ['citation'], content: full, created: now(), pinned: false };
      items.unshift(item);
      save(KEY.ITEMS, items);
      renderLibrary();
      renderStats();

      toast('Saved to Library');
    });

    $('#cite-clear-history')?.addEventListener('click', () => {
      citations = [];
      save(KEY.CITATIONS, citations);
      renderCitationHistory();
      toast('History cleared');
    });

    $('#cite-sub-generate')?.addEventListener('click', () => {
      const id = clean($('#cite-sub-source')?.value);
      const n = clean($('#cite-sub-n')?.value);
      const pin = clean($('#cite-sub-pin')?.value);
      const target = citations.find((c) => c.id === id);
      if (!target) return toast('Choose a saved citation');
      if (!n) return toast('Add the footnote number');

      // AGLC4 subsequent reference pattern: short form + (n X) + pinpoint.
      // (AGLC4 rule 1.4.1)
      const short = target.shortTitle ? `${target.shortTitle} (n ${n})` : `${target.type} (n ${n})`;
      const outSub = $('#cite-sub-output');
      const full = pin ? `${short} ${pin}.` : `${short}.`;
      if (outSub) outSub.value = full;
    });

    $('#cite-sub-output')?.addEventListener('focus', () => {
      // convenience: select all
      const el = $('#cite-sub-output');
      el?.select?.();
    });

    renderCitationHistory();
  }

  $('#test-source')?.addEventListener('change', renderTestBuilderUI);

  $('#open-library-to-select')?.addEventListener('click', () => {
    show('library');
    alert('Tip: use global search + filters, then choose items for testing by clicking “Select for test” in the list (added at bottom of each item).');
  });

  // We add selection UI by double-clicking an item in library list
  $('#library-list')?.addEventListener('dblclick', (e) => {
    const itemDiv = e.target.closest('.item');
    if (!itemDiv) return;
    const id = itemDiv.dataset.id;
    if (!id) return;
    const idx = selectedForTest.indexOf(id);
    if (idx >= 0) selectedForTest.splice(idx, 1);
    else selectedForTest.push(id);
    save(KEY.SELECTED_FOR_TEST, selectedForTest);
    itemDiv.style.outline = selectedForTest.includes(id) ? '2px solid rgba(45,212,191,0.65)' : 'none';
  });

  function startTestSession() {
    const mode = $('#test-source')?.value || 'unit';
    const tag = $('#test-tag')?.value || '';
    const count = clamp(parseInt($('#test-count')?.value || '12', 10), 5, 50);
    const mix = $('#test-mix')?.value || 'balanced';

    const sources = pickSourcesForTest(mode, tag);
    if (!sources.length) return alert('No source items for this test yet.');

    const bank = buildQuestionBank(sources);
    if (!bank.length) return alert('Your sources need more text content to generate questions.');

    const qs = selectQuestions(bank, count, mix);

    let i = 0;
    let correct = 0;
    const touchedTags = new Set();

    const container = $('#test-session');
    const render = () => {
      const q = qs[i];
      if (!q) return;
      const progress = `<div class="muted small">Question ${i + 1}/${qs.length}</div>`;

      if (q.type === 'mcq') {
        container.innerHTML = `
          ${progress}
          <div style="margin-top:8px"><strong>${escapeHtml(q.q)}</strong></div>
          <div class="muted small" style="margin-top:6px">Choose the best match:</div>
          <div class="list">
            ${q.options.map((opt) => `<div class="item" data-opt="${escapeHtml(opt)}">${escapeHtml(opt)}</div>`).join('')}
          </div>
          <div class="divider"></div>
          <div class="muted small">Score: ${correct}/${i}</div>
        `;
        $$('#test-session .item').forEach((el) => {
          el.addEventListener('click', () => {
            const chosen = el.dataset.opt;
            const ok = chosen === q.a;
            if (ok) correct += 1;
            (q.tags || []).forEach((t) => touchedTags.add(t));
            el.style.outline = ok ? '2px solid rgba(45,212,191,0.8)' : '2px solid rgba(255,77,109,0.8)';
            setTimeout(() => {
              i += 1;
              if (i >= qs.length) return finish();
              render();
            }, 350);
          });
        });
        return;
      }

      if (q.type === 'cloze') {
        container.innerHTML = `
          ${progress}
          <div style="margin-top:8px"><strong>Fill the blank:</strong></div>
          <div class="panel" style="margin-top:8px">${escapeHtml(q.q)}</div>
          <div class="row gap wrap" style="margin-top:10px">
            <input id="cloze-answer" placeholder="Your answer">
            <button id="cloze-submit">Submit</button>
            <button id="cloze-reveal" class="secondary">Reveal</button>
          </div>
          <div id="cloze-feedback" class="muted small" style="margin-top:10px"></div>
          <div class="divider"></div>
          <div class="muted small">Score: ${correct}/${i}</div>
        `;
        $('#cloze-submit').addEventListener('click', () => {
          const a = ($('#cloze-answer').value || '').trim().toLowerCase();
          const ok = a && q.a.toLowerCase().includes(a) || a.includes(q.a.toLowerCase());
          if (ok) correct += 1;
          (q.tags || []).forEach((t) => touchedTags.add(t));
          $('#cloze-feedback').textContent = ok ? 'Correct.' : `Not quite. Expected: ${q.a}`;
          setTimeout(() => {
            i += 1;
            if (i >= qs.length) return finish();
            render();
          }, 650);
        });
        $('#cloze-reveal').addEventListener('click', () => {
          $('#cloze-feedback').textContent = `Answer: ${q.a}`;
        });
        return;
      }

      // short
      container.innerHTML = `
        ${progress}
        <div style="margin-top:8px"><strong>${escapeHtml(q.q)}</strong></div>
        <div class="muted small" style="margin-top:6px">${escapeHtml(q.hint || '')}</div>
        <textarea id="short-answer" rows="5" style="margin-top:10px" placeholder="Write your answer…"></textarea>
        <div class="row gap wrap" style="margin-top:10px">
          <button id="short-done">Mark done</button>
          <button id="short-skip" class="secondary">Skip</button>
        </div>
        <div class="divider"></div>
        <div class="muted small">Score: ${correct}/${i}</div>
      `;
      $('#short-done').addEventListener('click', () => {
        // We can't grade short answers locally; treat as completion.
        correct += 0.6; // partial credit to encourage practice
        (q.tags || []).forEach((t) => touchedTags.add(t));
        i += 1;
        if (i >= qs.length) return finish();
        render();
      });
      $('#short-skip').addEventListener('click', () => {
        i += 1;
        if (i >= qs.length) return finish();
        render();
      });
    };

    const finish = () => {
      bumpStreak();
      // Update mastery: reward touched tags proportional to score
      const pct = Math.round((correct / qs.length) * 100);
      const delta = pct >= 80 ? 8 : pct >= 60 ? 4 : 2;
      adjustMastery(Array.from(touchedTags), delta);
      renderStats();
      $('#learn-session').innerHTML = `<div><strong>Last test:</strong> ${pct}%</div><div class="muted small">Skills updated for: ${escapeHtml(Array.from(touchedTags).slice(0, 8).join(', ') || '—')}</div>`;
      container.innerHTML = `
        <div><strong>Finished.</strong></div>
        <div class="muted small" style="margin-top:6px">Score: ${pct}%</div>
        <div class="divider"></div>
        <button id="test-again" class="secondary">New test</button>
      `;
      $('#test-again').addEventListener('click', () => startTestSession());
    };

    render();
  }

  $('#start-test')?.addEventListener('click', startTestSession);

  // Learn: practice quiz by tag
  $('#start-skill-quiz')?.addEventListener('click', () => {
    const tag = $('#practice-skill')?.value;
    if (!tag) return alert('Pick a skill first.');
    show('tests');
    $('#test-source').value = 'tag';
    renderTestBuilderUI();
    $('#test-tag').value = tag;
    $('#test-count').value = '10';
    $('#test-mix').value = 'balanced';
    startTestSession();
  });

  // Add concepts as cards into current deck
  $('#add-concepts-as-cards')?.addEventListener('click', () => {
    const deckId = $('#deck-select')?.value;
    if (!deckId) return alert('Choose a deck first (Flashcards tab).');
    if (!lastConcepts.length) return alert('Extract concepts first.');
    lastConcepts.slice(0, 12).forEach((c) => addCardToDeck(deckId, `Define: ${c}`, `Definition / rule / authority for: ${c}`));
    renderDeckSelect();
    renderDueList();
    renderStats();
    alert('Concept cards added (fill answers as you revise).');
  });

  // ----------------------------
  // Timetable
  // ----------------------------
  function renderTT() {
    const el = $('#timetable');
    if (!el) return;
    const list = timetable
      .filter((t) => t.unitId === activeUnitId)
      .slice()
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    el.innerHTML = '';
    if (!list.length) {
      el.innerHTML = '<div class="muted small">No sessions yet.</div>';
      return;
    }
    list.slice(0, 18).forEach((t) => {
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML = `<div class="row between"><strong>${escapeHtml(t.activity)}</strong><span class="badge">${escapeHtml(t.date)} ${escapeHtml(t.time)}</span></div>`;
      el.appendChild(div);
    });
  }

  $('#add-tt')?.addEventListener('click', () => {
    const date = $('#tt-date')?.value;
    const time = ($('#tt-time')?.value || '').trim();
    const activity = ($('#tt-activity')?.value || '').trim();
    if (!date || !time || !activity) return alert('Add date, time and activity.');
    timetable.push({ id: uid(), unitId: activeUnitId, date, time, activity, created: now() });
    save(KEY.TT, timetable);
    $('#tt-time').value = '';
    $('#tt-activity').value = '';
    renderTT();
    renderYearCalendar($('#tt-year-select').value || new Date().getFullYear());
  });

  function populateYearSelector() {
    const sel = $('#tt-year-select');
    if (!sel) return;
    const nowY = new Date().getFullYear();
    sel.innerHTML = '';
    for (let y = nowY - 2; y <= nowY + 2; y++) {
      const o = document.createElement('option');
      o.value = y;
      o.textContent = y;
      sel.appendChild(o);
    }
    sel.value = nowY;
  }

  $('#tt-year-select')?.addEventListener('change', () => renderYearCalendar($('#tt-year-select').value));

  function renderYearCalendar(year) {
    const container = $('#year-calendar');
    if (!container) return;
    const y = parseInt(year || new Date().getFullYear(), 10);
    container.innerHTML = '';
    for (let m = 0; m < 12; m++) {
      const monthDiv = document.createElement('div');
      monthDiv.className = 'month';
      const dt = new Date(y, m, 1);
      const monthName = dt.toLocaleString(undefined, { month: 'long' });
      const heading = document.createElement('h4');
      heading.textContent = `${monthName} ${y}`;
      monthDiv.appendChild(heading);

      const days = document.createElement('div');
      days.className = 'days';

      const monthEvents = timetable.filter((t) => {
        if (t.unitId !== activeUnitId) return false;
        const d = new Date(t.date);
        return d.getFullYear() === y && d.getMonth() === m;
      });

      const daysInMonth = new Date(y, m + 1, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const cell = document.createElement('div');
        cell.className = 'daycell';
        const dayLabel = document.createElement('div');
        dayLabel.className = 'daylabel';
        dayLabel.textContent = d;
        cell.appendChild(dayLabel);

        const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        monthEvents.filter((ev) => ev.date === dateStr).slice(0, 2).forEach((ev) => {
          const s = document.createElement('div');
          s.className = 'day-event';
          s.textContent = `${ev.time} ${ev.activity}`;
          cell.appendChild(s);
        });

        days.appendChild(cell);
      }
      monthDiv.appendChild(days);
      container.appendChild(monthDiv);
    }
  }

  // ----------------------------
  // Todos
  // ----------------------------
  function renderTodos() {
    const el = $('#todo-list');
    if (!el) return;
    const list = todos
      .filter((t) => t.unitId === activeUnitId)
      .slice()
      .sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
    el.innerHTML = '';
    if (!list.length) {
      el.innerHTML = '<div class="muted small">No tasks yet.</div>';
      return;
    }
    list.forEach((t) => {
      const div = document.createElement('div');
      div.className = 'item';
      const due = t.due ? `<span class="badge">Due ${escapeHtml(t.due)}</span>` : '';
      const pri = `<span class="badge">${t.priority.toUpperCase()}</span>`;
      div.innerHTML = `
        <div class="row between">
          <div class="row gap">
            <input type="checkbox" ${t.done ? 'checked' : ''} data-id="${t.id}">
            <strong>${escapeHtml(t.text)}</strong>
          </div>
          <div class="row gap">${pri}${due}</div>
        </div>
        <div class="row gap" style="margin-top:8px">
          <button class="ghost danger" data-del="${t.id}">Remove</button>
        </div>
      `;
      el.appendChild(div);
    });

    $$('#todo-list input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const t = todos.find((x) => x.id === cb.dataset.id);
        if (!t) return;
        t.done = cb.checked;
        save(KEY.TODOS, todos);
        renderTodos();
      });
    });

    $$('#todo-list button[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.del;
        todos = todos.filter((x) => x.id !== id);
        save(KEY.TODOS, todos);
        renderTodos();
      });
    });
  }

  $('#add-todo')?.addEventListener('click', () => {
    const text = ($('#todo-input')?.value || '').trim();
    if (!text) return;
    const priority = $('#todo-priority')?.value || 'med';
    const due = $('#todo-due')?.value || '';
    todos.unshift({ id: uid(), unitId: activeUnitId, text, done: false, priority, due, created: now() });
    save(KEY.TODOS, todos);
    $('#todo-input').value = '';
    $('#todo-due').value = '';
    renderTodos();
  });

  $('#gen-plan')?.addEventListener('click', () => {
    const days = clamp(parseInt($('#plan-days')?.value || '7', 10), 1, 30);
    const pending = todos.filter((t) => t.unitId === activeUnitId && !t.done);
    const out = $('#plan-output');
    out.innerHTML = '';
    if (!pending.length) {
      out.textContent = 'No pending tasks — schedule revision blocks or practice tests.';
      return;
    }
    const lines = [];
    for (let i = 0; i < days; i++) {
      const t = pending[i % pending.length];
      lines.push(`Day ${i + 1}: ${t.text}`);
    }
    out.innerHTML = `<ol class="small">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ol>`;
  });

  // ----------------------------
  // Exam pack
  // ----------------------------
  function renderIssues() {
    const el = $('#issue-checklist');
    if (!el) return;
    const list = issues.filter((it) => it.unitId === activeUnitId);
    el.innerHTML = '';
    if (!list.length) {
      el.innerHTML = '<div class="muted small">No checklist items yet.</div>';
      return;
    }
    list.forEach((it) => {
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML = `
        <div class="row between">
          <div class="row gap">
            <input type="checkbox" ${it.done ? 'checked' : ''} data-id="${it.id}">
            <strong>${escapeHtml(it.text)}</strong>
          </div>
          <button class="ghost danger" data-del="${it.id}">Remove</button>
        </div>
      `;
      el.appendChild(div);
    });

    $$('#issue-checklist input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const it = issues.find((x) => x.id === cb.dataset.id);
        if (!it) return;
        it.done = cb.checked;
        save(KEY.ISSUES, issues);
        renderIssues();
      });
    });

    $$('#issue-checklist button[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.del;
        issues = issues.filter((x) => x.id !== id);
        save(KEY.ISSUES, issues);
        renderIssues();
      });
    });
  }

  $('#add-issue')?.addEventListener('click', () => {
    const t = prompt('Add an issue (e.g., Duty / Breach / Causation)');
    if (!t) return;
    issues.unshift({ id: uid(), unitId: activeUnitId, text: t.trim(), done: false, created: now() });
    save(KEY.ISSUES, issues);
    renderIssues();
  });

  $('#load-checklist-template')?.addEventListener('click', () => {
    const templates = {
      'Case brief (generic)': [
        'Parties + court + date',
        'Material facts',
        'Issue(s)',
        'Holding',
        'Reasoning',
        'Rule / principle',
        'Ratio decidendi',
        'Obiter (if any)',
        'Disposition / order',
        'Relevance to unit'
      ],
      'Problem question (IRAC)': [
        'Issues',
        'Relevant law (rules, tests)',
        'Application to facts',
        'Conclusion',
        'Counter‑arguments',
        'Remedies / orders'
      ]
    };
    const pick = prompt('Template name:\n- ' + Object.keys(templates).join('\n- '), 'Case brief (generic)');
    if (!pick || !templates[pick]) return;
    templates[pick].forEach((t) => issues.unshift({ id: uid(), unitId: activeUnitId, text: t, done: false, created: now() }));
    save(KEY.ISSUES, issues);
    renderIssues();
  });

  function renderPackList() {
    const el = $('#pack-list');
    if (!el) return;

    const pinned = unitItems().filter((it) => it.pinned);
    el.innerHTML = '';
    if (!pinned.length) {
      el.innerHTML = '<div class="muted small">No pinned items yet. Pin key cases/notes from the Library.</div>';
      return;
    }
    pinned.forEach((it) => {
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML = `<div class="row between"><strong>${escapeHtml(it.title)}</strong><span class="badge">${escapeHtml(it.type)}</span></div>`;
      el.appendChild(div);
    });
  }

  $('#download-pack')?.addEventListener('click', () => {
    const pinned = unitItems().filter((it) => it.pinned);
    if (!pinned.length) return alert('Pin items from Library first.');
    const content = pinned.map((it) => `--- ${it.title} (${it.type}) ---\nTags: ${(it.tags || []).join(', ')}\n\n${it.content}\n\n`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `exam-pack-${activeUnitName().replace(/\s+/g,'-').toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#clear-pack')?.addEventListener('click', () => {
    if (!confirm('Unpin all items for this unit?')) return;
    items.forEach((it) => { if (it.unitId === activeUnitId) it.pinned = false; });
    save(KEY.ITEMS, items);
    renderPackList();
    renderLibrary();
  });

  // ----------------------------
  // Global search
  // ----------------------------
  let searchTimer = null;
  $('#global-search')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = (e.target.value || '').trim();
    searchTimer = setTimeout(() => renderSearchResults(q), 200);
  });

  function snippetOf(text, q) {
    const t = (text || '').replace(/\s+/g, ' ');
    const idx = t.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return t.slice(0, 160);
    const start = Math.max(0, idx - 50);
    return (start > 0 ? '…' : '') + t.slice(start, start + 220) + (t.length > start + 220 ? '…' : '');
  }

  function renderSearchResults(query) {
    const container = $('#search-results');
    if (!container) return;
    container.style.display = query ? 'block' : 'none';
    container.innerHTML = '';
    if (!query) return;

    const q = query.toLowerCase();
    const results = items
      .filter((it) =>
        (it.title || '').toLowerCase().includes(q) ||
        (it.content || '').toLowerCase().includes(q) ||
        (it.tags || []).some((t) => t.toLowerCase().includes(q))
      )
      .slice(0, 40);

    if (!results.length) {
      container.innerHTML = '<div class="search-item muted">No results.</div>';
      return;
    }

    results.forEach((it) => {
      const div = document.createElement('div');
      div.className = 'search-item';
      div.innerHTML = `
        <strong>${escapeHtml(it.title)}</strong>
        <div class="muted small">${escapeHtml(it.type.toUpperCase())} • ${escapeHtml(units.find(u=>u.id===it.unitId)?.name || '')}</div>
        <div class="snippet">${escapeHtml(snippetOf(it.content, query))}</div>
      `;
      div.addEventListener('click', () => {
        $('#global-search').value = '';
        container.style.display = 'none';
        show('library');
        activeUnitId = it.unitId;
        renderUnitSelect();
        openLibraryItem(it.id);
        renderLibrary();
        renderTags();
        renderPackList();
        renderIssues();
        renderStats();
        renderUnitCards();
      });
      container.appendChild(div);
    });
  }

  // ----------------------------
  // Stats + streak
  // ----------------------------
  function bumpStreak() {
    const today = toISODate(new Date());
    if (!streak.lastDayISO) {
      streak.lastDayISO = today;
      streak.count = 1;
    } else if (streak.lastDayISO === today) {
      // no-op
    } else {
      const last = new Date(streak.lastDayISO);
      const diffDays = Math.round((new Date(today) - last) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) streak.count += 1;
      else streak.count = 1;
      streak.lastDayISO = today;
    }
    save(KEY.STREAK, streak);
  }

  function renderStats() {
    const unitCount = unitItems().length;
    $('#stat-items').textContent = unitCount;

    const today = toISODate(new Date());
    let due = 0;
    unitDecks().forEach((dk) => (dk.cards || []).forEach((c) => { if (!c.due || c.due <= today) due += 1; }));
    $('#stat-due').textContent = due;

    $('#stat-streak').textContent = streak.count || 0;
  }

  // ----------------------------
  // Unit dashboard cards
  // ----------------------------
  function activeUnitName() {
    return units.find((u) => u.id === activeUnitId)?.name || 'Unit';
  }

  function renderUnitCards() {
    const el = $('#unit-cards');
    if (!el) return;

    const cards = units.map((u) => {
      const uItems = items.filter((it) => it.unitId === u.id);
      const uDecks = decks.filter((d) => d.unitId === u.id);
      const today = toISODate(new Date());
      let uDue = 0;
      uDecks.forEach((dk) => (dk.cards || []).forEach((c) => { if (!c.due || c.due <= today) uDue += 1; }));

      const m = mastery[u.id] || {};
      const skills = Object.keys(m).length;
      const avg = skills ? Math.round(Object.values(m).reduce((a, b) => a + b, 0) / skills) : 0;

      return { unit: u, count: uItems.length, due: uDue, skills, avg };
    });

    el.innerHTML = '';
    cards.forEach((c) => {
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML = `
        <div class="row between">
          <strong>${escapeHtml(c.unit.name)}</strong>
          <span class="badge">${c.count} items</span>
        </div>
        <div class="row gap wrap" style="margin-top:8px">
          <span class="badge">${c.due} due</span>
          <span class="badge">${c.skills} skills</span>
          <span class="badge">avg ${c.avg}%</span>
        </div>
      `;
      div.addEventListener('click', () => {
        activeUnitId = c.unit.id;
        renderUnitSelect();
        refreshAll();
        show('library');
      });
      el.appendChild(div);
    });
  }

  // Quick actions
  $('#qa-upload')?.addEventListener('click', () => {
    show('library');
    $('#file-input')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  $('#qa-generate-test')?.addEventListener('click', () => {
    show('tests');
  });

  // ----------------------------
  // Settings: import/export/wipe
  // ----------------------------
  $('#export-data')?.addEventListener('click', () => {
    const payload = {
      version: VERSION,
      exportedAt: new Date().toISOString(),
      units,
      items,
      decks,
      todos,
      timetable,
      issues,
      mastery,
      streak
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jd-study-hub-export-${toISODate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#import-data')?.addEventListener('change', async (e) => {
    const file = (e.target.files || [])[0];
    if (!file) return;
    try {
      const raw = await file.text();
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.units)) throw new Error('Invalid file format.');
      if (!confirm('Import will replace your current local data. Continue?')) return;

      units = data.units || [];
      items = data.items || [];
      decks = data.decks || [];
      todos = data.todos || [];
      timetable = data.timetable || [];
      issues = data.issues || [];
      mastery = data.mastery || {};
      streak = data.streak || { lastDayISO: null, count: 0 };

      save(KEY.UNITS, units);
      save(KEY.ITEMS, items);
      save(KEY.DECKS, decks);
      save(KEY.TODOS, todos);
      save(KEY.TT, timetable);
      save(KEY.ISSUES, issues);
      save(KEY.MASTERY, mastery);
      save(KEY.STREAK, streak);
      save(KEY.V, VERSION);

      activeUnitId = units[0]?.id || null;
      refreshAll();
      alert('Import complete.');
    } catch (err) {
      alert('Import failed: ' + err.message);
    } finally {
      e.target.value = '';
    }
  });

  $('#wipe-data')?.addEventListener('click', () => {
    if (!confirm('This wipes all local study data in this browser. Continue?')) return;
    Object.values(KEY).forEach((k) => localStorage.removeItem(k));
    localStorage.removeItem('sd_units');
    localStorage.removeItem('sd_docs');
    localStorage.removeItem('sd_lectures');
    localStorage.removeItem('sd_decks');
    localStorage.removeItem('sd_timetable');
    localStorage.removeItem('sd_todos');
    localStorage.removeItem('sd_issues');
    location.reload();
  });

  // ----------------------------
  // Refresh / init
  // ----------------------------
  function refreshAll() {
    // reload from storage (in case other tabs modified)
    units = load(KEY.UNITS, units);
    items = load(KEY.ITEMS, items);
    decks = load(KEY.DECKS, decks);
    timetable = load(KEY.TT, timetable);
    todos = load(KEY.TODOS, todos);
    issues = load(KEY.ISSUES, issues);
    mastery = load(KEY.MASTERY, mastery);
    streak = load(KEY.STREAK, streak);
    selectedForTest = load(KEY.SELECTED_FOR_TEST, selectedForTest);
    citations = load(KEY.CITATIONS, citations);

    ensureDefaultUnit();
    ensureDefaultDeck();
    renderUnitSelect();
    renderUnitCards();

    renderLibrary();
    renderTags();

    renderDeckSelect();
    currentDeckId = $('#deck-select')?.value || unitDecks()[0]?.id || null;
    loadDeck(currentDeckId);

    renderDueList();
    renderDeckStats();

    populateYearSelector();
    renderYearCalendar($('#tt-year-select')?.value || new Date().getFullYear());
    renderTT();

    renderTodos();
    renderIssues();
    renderPackList();

    renderStats();
    renderTestBuilderUI();
  }

  // Init
  ensureDefaultUnit();
  renderUnitSelect();
  refreshAll();
  initCitations();
  show('units');

})();
