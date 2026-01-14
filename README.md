JD Study Hub (Client-side MVP)

What you have now
- A single-page study website inspired by:
  - Khan Academy: skill/topic “mastery” and practice flow
  - Quizlet: decks + flashcards + spaced repetition
- Runs fully in the browser; saves everything to localStorage.

Key features
- Units dashboard
- Library (upload PDF/TXT, tag by topic, revise, highlight, summarise, extract concepts)
- Learn (topics/tags become “skills” with mastery %)
- Flashcards (decks + Leitner spaced repetition with due dates)
- Tests (MCQ + short answer + cloze questions generated from your materials)
- AGLC4 citations (generate common AGLC4-style footnotes + keep a history + create subsequent references)
- Timetable (year calendar)
- To-do list (priority + due date)
- Exam pack (pin key items + issue checklist templates)
- Export/Import JSON (move your data between devices until you add a backend)

How to run locally (recommended)
From this folder:
  python -m http.server 8000

Then open:
  http://localhost:8000

PDF support
- PDF text extraction uses pdf.js (loaded via CDN). This requires serving over HTTP(S),
  so do NOT open the HTML file via file:// if you want PDF uploads to work.

Wallpaper
- The background pattern is loaded from: assets/wallpaper/floral-pattern.jpg

How to use
1) Add units (left sidebar)
2) Choose your current unit
3) Upload lectures/cases/notes into Library and tag by topic
4) Summarise, extract concepts, and create decks
5) Use Flashcards → Study due each day
6) Use Tests to build mastery; Learn tab shows progress by topic

Next upgrades (cloud)
- Supabase auth + storage (sync across devices, store original PDFs, share decks)
- Server-side PDF parsing for more reliable extraction
- AI-powered case briefs and more accurate question generation

Wallpaper
- The UI uses a repeating wallpaper image at: assets/wallpaper/floral-pattern.jpg
