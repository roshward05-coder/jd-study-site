(() => {
  'use strict';

  // ============================================
  // JD Law Exam Prep - Simplified App
  // Focus: Upload PDFs → Auto-Generate Flashcards & Quizzes
  // ============================================

  // DOM Helpers
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const now = () => Date.now();
  const uid = () => now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const toISODate = (d = new Date()) => d.toISOString().slice(0, 10);

  // Storage
  const KEY = {
    UNITS: 'jdh_units',
    MATERIALS: 'jdh_materials',
    FLASHCARD_DECKS: 'jdh_decks',
    FLASHCARDS: 'jdh_cards',
    QUIZ_RESULTS: 'jdh_quiz_results'
  };

  function load(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch (_) {
      return fallback;
    }
  }

  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // State
  let units = load(KEY.UNITS, []);
  let materials = load(KEY.MATERIALS, []);
  let decks = load(KEY.FLASHCARD_DECKS, []);
  let cards = load(KEY.FLASHCARDS, []);
  let activeUnitId = null;
  let currentOpenMaterialId = null;

  // ============================================
  // UNIT MANAGEMENT
  // ============================================
  
  function ensureDefaultUnit() {
    if (units.length === 0) {
      units.push({ id: uid(), name: 'Contracts', created: now() });
      save(KEY.UNITS, units);
      activeUnitId = units[0].id;
    }
    if (!activeUnitId && units.length > 0) {
      activeUnitId = units[0].id;
    }
  }

  function renderUnitSelect() {
    const sel = $('#active-unit');
    if (!sel) return;
    sel.innerHTML = units.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
    if (activeUnitId) sel.value = activeUnitId;
  }

  $('#active-unit')?.addEventListener('change', (e) => {
    activeUnitId = e.target.value;
    renderMaterials();
  });

  $('#add-unit')?.addEventListener('click', () => {
    const name = $('#new-unit-input')?.value?.trim();
    if (!name) return alert('Enter subject name');
    units.push({ id: uid(), name, created: now() });
    save(KEY.UNITS, units);
    $('#new-unit-input').value = '';
    renderUnitSelect();
  });

  $('#delete-unit')?.addEventListener('click', async () => {
    if (!activeUnitId) return;
    if (!confirm('Delete this subject and all its materials?')) return;
    units = units.filter(u => u.id !== activeUnitId);
    materials = materials.filter(m => m.unitId !== activeUnitId);
    save(KEY.UNITS, units);
    save(KEY.MATERIALS, materials);
    activeUnitId = units[0]?.id || null;
    renderUnitSelect();
    renderMaterials();
  });

  // ============================================
  // MATERIAL UPLOAD & EXTRACTION
  // ============================================

  async function extractTextFromPDF(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const pdf = await pdfjsLib.getDocument(data).promise;
          let text = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(item => item.str).join(' ') + '\n';
          }
          resolve(text);
        } catch (err) {
          console.error('PDF extraction error:', err);
          resolve('');
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  $('#file-input')?.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files.length || !activeUnitId) return;

    const progress = $('#upload-progress');
    for (const file of files) {
      progress.textContent = `Processing ${file.name}...`;
      let text = '';
      if (file.type === 'application/pdf') {
        text = await extractTextFromPDF(file);
      } else {
        text = await file.text();
      }

      const material = {
        id: uid(),
        unitId: activeUnitId,
        title: file.name.replace(/\.[^.]+$/, ''),
        type: 'lecture',
        content: text,
        created: now()
      };
      materials.push(material);
      
      // Auto-generate flashcards from material
      autoGenerateFlashcards(material);
    }

    save(KEY.MATERIALS, materials);
    save(KEY.FLASHCARD_DECKS, decks);
    save(KEY.FLASHCARDS, cards);
    
    progress.textContent = `✅ Processed ${files.length} file(s)`;
    $('#file-input').value = '';
    renderMaterials();
    renderStats();
    setTimeout(() => progress.textContent = '', 2000);
  });

  // ============================================
  // AUTO-GENERATE FLASHCARDS FROM PDF
  // ============================================

  function autoGenerateFlashcards(material) {
    // Extract key sentences/concepts from material
    const sentences = material.content.split(/[.!?]+/).filter(s => s.trim().length > 20);
    const deckId = uid();
    
    const deck = {
      id: deckId,
      unitId: material.unitId,
      name: `${material.title} - Auto Generated`,
      sourceId: material.id,
      created: now()
    };
    decks.push(deck);

    // Generate Q&A pairs from sentences (simple heuristic)
    const generatedCards = [];
    for (let i = 0; i < Math.min(sentences.length, 15); i++) {
      const sentence = sentences[i].trim();
      if (sentence.length < 30) continue;

      // Simple Q&A generation heuristic
      let question = sentence;
      let answer = sentence;

      // Try to identify a question pattern
      if (sentence.includes('is ')) {
        const parts = sentence.split(' is ');
        question = `What is ${parts[0]}?`;
        answer = parts[1] || sentence;
      } else if (sentence.includes('are ')) {
        const parts = sentence.split(' are ');
        question = `What are ${parts[0]}?`;
        answer = parts[1] || sentence;
      } else if (sentence.includes('can ')) {
        question = `${sentence}?`;
        answer = 'True/False: ' + sentence;
      }

      generatedCards.push({
        id: uid(),
        deckId,
        q: question.substring(0, 200),
        a: answer.substring(0, 300),
        box: 1,
        due: now(),
        stats: { seen: 0, correct: 0 }
      });
    }

    cards.push(...generatedCards);
  }

  // ============================================
  // MATERIAL MANAGEMENT
  // ============================================

  function unitMaterials() {
    return materials.filter(m => m.unitId === activeUnitId);
  }

  function renderMaterials() {
    const list = $('#library-list');
    if (!list) return;

    const unitMats = unitMaterials();
    list.innerHTML = unitMats.map(m => `
      <div class="item" data-id="${m.id}" onclick="openMaterial('${m.id}')">
        <strong>${m.title}</strong>
        <div class="muted small">${new Date(m.created).toLocaleDateString()}</div>
      </div>
    `).join('');
  }

  window.openMaterial = (id) => {
    currentOpenMaterialId = id;
    const material = materials.find(m => m.id === id);
    if (!material) return;

    const body = $('#doc-body');
    if (body) {
      body.textContent = material.content.substring(0, 2000);
    }
  };

  // ============================================
  // FLASHCARD MANAGEMENT
  // ============================================

  function renderDeckSelect() {
    const sel = $('#deck-select');
    if (!sel) return;

    const unitDecks = decks.filter(d => d.unitId === activeUnitId);
    sel.innerHTML = unitDecks.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
  }

  let currentDeckId = null;
  let currentCardIdx = 0;

  $('#deck-select')?.addEventListener('change', (e) => {
    currentDeckId = e.target.value;
    currentCardIdx = 0;
    showCard();
  });

  function getDeckCards(deckId) {
    return cards.filter(c => c.deckId === deckId);
  }

  function showCard() {
    const deckCards = getDeckCards(currentDeckId);
    if (!deckCards.length) {
      $('#question').textContent = 'No cards in this deck';
      return;
    }

    const card = deckCards[currentCardIdx];
    $('#card-info').textContent = `Card ${currentCardIdx + 1} of ${deckCards.length}`;
    $('#question').textContent = card.q;
    $('#answer').textContent = card.a;
    $('#answer').style.display = 'none';
    $('#show-answer').style.display = 'inline-block';
  }

  $('#show-answer')?.addEventListener('click', () => {
    $('#answer').style.display = 'block';
    $('#show-answer').style.display = 'none';
  });

  $('#next-card')?.addEventListener('click', () => {
    const deckCards = getDeckCards(currentDeckId);
    currentCardIdx = (currentCardIdx + 1) % deckCards.length;
    showCard();
  });

  $('#mark-correct')?.addEventListener('click', () => {
    const deckCards = getDeckCards(currentDeckId);
    const card = deckCards[currentCardIdx];
    card.stats.correct++;
    card.stats.seen++;
    save(KEY.FLASHCARDS, cards);
    $('#next-card').click();
  });

  $('#mark-wrong')?.addEventListener('click', () => {
    const deckCards = getDeckCards(currentDeckId);
    const card = deckCards[currentCardIdx];
    card.stats.seen++;
    save(KEY.FLASHCARDS, cards);
    $('#next-card').click();
  });

  // ============================================
  // QUIZ BUILDER
  // ============================================

  function generateQuizQuestions(material, count = 10) {
    const sentences = material.content.split(/[.!?]+/).filter(s => s.trim().length > 30);
    const questions = [];

    for (let i = 0; i < Math.min(count, sentences.length); i++) {
      const sentence = sentences[i].trim();
      
      questions.push({
        id: uid(),
        type: i % 3 === 0 ? 'mcq' : i % 3 === 1 ? 'short' : 'essay',
        question: `Q${i + 1}: ${sentence.substring(0, 150)}...?`,
        content: sentence,
        userAnswer: '',
        correct: false
      });
    }

    return questions;
  }

  let currentQuizQuestions = [];
  let currentQuizIdx = 0;

  $('#start-quiz')?.addEventListener('click', async () => {
    const sourceId = $('#quiz-source').value;
    const count = parseInt($('#quiz-count').value) || 10;

    const material = materials.find(m => m.id === sourceId);
    if (!material) return alert('Select a material');

    currentQuizQuestions = generateQuizQuestions(material, count);
    currentQuizIdx = 0;
    renderQuizQuestion();
  });

  function renderQuizQuestion() {
    if (currentQuizIdx >= currentQuizQuestions.length) {
      $('#quiz-session').innerHTML = '<div class="muted">✅ Quiz completed! Review your answers.</div>';
      return;
    }

    const q = currentQuizQuestions[currentQuizIdx];
    $('#quiz-session').innerHTML = `
      <div class="quiz-q">
        <div class="muted small">Question ${currentQuizIdx + 1} of ${currentQuizQuestions.length}</div>
        <strong>${q.question}</strong>
        <textarea id="quiz-answer" style="width:100%; min-height:80px; margin-top:10px" placeholder="Your answer..."></textarea>
        <div class="row gap wrap" style="margin-top:10px">
          <button onclick="submitQuizAnswer()" class="secondary">Submit</button>
          <button onclick="nextQuizQuestion()" class="ghost">Skip</button>
        </div>
      </div>
    `;
  }

  window.submitQuizAnswer = () => {
    const answer = $('#quiz-answer').value.trim();
    if (answer) {
      currentQuizQuestions[currentQuizIdx].userAnswer = answer;
    }
    nextQuizQuestion();
  };

  window.nextQuizQuestion = () => {
    currentQuizIdx++;
    renderQuizQuestion();
  };

  // ============================================
  // STATS & UI
  // ============================================

  function renderStats() {
    const unitMats = unitMaterials();
    $('#stat-items').textContent = unitMats.length;
    
    const unitDecks = decks.filter(d => d.unitId === activeUnitId);
    const unitCards = cards.filter(c => unitDecks.some(d => d.id === c.deckId));
    $('#stat-flashcards').textContent = unitCards.length;

    // Dashboard stats
    $('#total-materials').textContent = materials.length;
    $('#total-flashcards').textContent = cards.length;
    $('#total-quizzes').textContent = load('quiz_count', 0);
  }

  // ============================================
  // ROUTER
  // ============================================

  const views = {
    dashboard: $('#view-dashboard'),
    library: $('#view-library'),
    flashcards: $('#view-flashcards'),
    quiz: $('#view-quiz'),
    settings: $('#view-settings')
  };

  function show(viewName) {
    Object.values(views).forEach(v => v && (v.style.display = 'none'));
    views[viewName] && (views[viewName].style.display = '');
  }

  async function go(viewName) {
    show(viewName);
    
    if (viewName === 'library') {
      renderMaterials();
    } else if (viewName === 'flashcards') {
      renderDeckSelect();
      if (currentDeckId) showCard();
    } else if (viewName === 'quiz') {
      const unitMats = unitMaterials();
      const sel = $('#quiz-source');
      if (sel) {
        sel.innerHTML = unitMats.map(m => `<option value="${m.id}">${m.title}</option>`).join('');
      }
    }
  }

  $$('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      $$('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      go(btn.dataset.view);
    });
  });

  // ============================================
  // THEME TOGGLE
  // ============================================

  $('#theme-toggle')?.addEventListener('click', () => {
    document.body.classList.toggle('theme-light');
    localStorage.setItem('theme', document.body.className);
  });

  // ============================================
  // UPLOAD ZONE DRAG & DROP
  // ============================================

  const uploadZone = $('#upload-zone');
  if (uploadZone) {
    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.style.opacity = '0.7';
    });
    uploadZone.addEventListener('dragleave', () => {
      uploadZone.style.opacity = '1';
    });
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.style.opacity = '1';
      const files = e.dataTransfer.files;
      $('#file-input').files = files;
      const event = new Event('change', { bubbles: true });
      $('#file-input').dispatchEvent(event);
    });
  }

  $('#browse-btn')?.addEventListener('click', () => {
    $('#file-input').click();
  });

  $('#add-material')?.addEventListener('click', () => {
    $('#file-input').click();
  });

  // ============================================
  // EXPORT/IMPORT
  // ============================================

  $('#export-data')?.addEventListener('click', () => {
    const data = {
      units,
      materials,
      decks,
      cards,
      exported: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jd-exam-prep-${toISODate()}.json`;
    a.click();
  });

  $('#wipe-data')?.addEventListener('click', () => {
    if (!confirm('Delete all data? This cannot be undone.')) return;
    Object.values(KEY).forEach(k => localStorage.removeItem(k));
    location.reload();
  });

  // ============================================
  // INIT
  // ============================================

  ensureDefaultUnit();
  renderUnitSelect();
  renderMaterials();
  renderDeckSelect();
  renderStats();
  show('dashboard');

  // Restore theme
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) document.body.className = savedTheme;

})();
