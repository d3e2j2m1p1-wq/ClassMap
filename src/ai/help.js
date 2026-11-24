// ═══════════════════════════════════════════════
//  HELP SEARCH — works with the AI off.
//  Short answers about the app, plus every section of the guides on classmap.dev.
//  With the AI on, the best matches are handed to the model as its only source.
// ═══════════════════════════════════════════════

export const FAQ = [
  { q: 'How do I add students?', a: 'Pick a class on the home page, open the Roster tab, and paste your list (one name per line) or type names one at a time.', k: 'add students roster paste list names import' },
  { q: 'How do I make a new chart?', a: 'Pick a class on the home page and press + New Chart. A new chart starts from the same room as the class’s last chart, with nobody seated.', k: 'new chart create start' },
  { q: 'How do I build the room?', a: 'In a chart, open the Layout tab. Place tables one at a time with the Table tool, then add the board, teacher’s desk, doors and windows. Drag to move, use the corner handle to resize, and rotate in 45° steps (hold Shift for free rotation).', k: 'layout room tables desk board door window build resize rotate walls' },
  { q: 'How do I change the shape of the room?', a: 'In the Layout tab, open Walls. You can draw an L-shape or other outline instead of a rectangle.', k: 'walls shape room outline l-shaped' },
  { q: 'How do I keep two students apart?', a: 'Open the Rules tab (on the home page for rules that always apply, or in a chart for this chart only) and add “Keep apart”. Or type it into the helper: “Keep Liam and Owen apart.”', k: 'keep apart separate rule distract not together' },
  { q: 'How do I seat students automatically?', a: 'Open Auto-Assign in a chart and press Assign. It follows your rules and tag settings, and keeps pinned students where they are.', k: 'auto assign automatic seat everyone shuffle random' },
  { q: 'How do I keep a student in their seat when I re-assign?', a: 'Pin them: click their seat and press P, or use the pin next to their name in the Auto-Assign panel. Auto-Assign leaves pinned students alone.', k: 'pin lock keep seat' },
  { q: 'What are tags?', a: 'Tags (IEP, 504, ELL, Strong reader …) mark students so rules can use them, like spreading IEP students across groups or seating ELL students with a strong reader. Add them with 🏷 in the Roster tab. Tags never show on the projector or the printed chart; private tags also stay off the substitute page.', k: 'tags iep 504 ell label mark private badge' },
  { q: 'How do I show the chart on the projector?', a: 'In a chart, press Present. It opens full screen with names only; tags and notes stay hidden. Press Esc to leave.', k: 'present projector full screen show class' },
  { q: 'How do I print the chart or make a sub plan?', a: 'In a chart, use Print. You can print the seating chart, and a substitute page with the class’s rules (private tags left out).', k: 'print substitute sub plan paper pdf' },
  { q: 'How do I move a chart to another device or teacher?', a: 'Use ⋯ → Send to another device. The other device opens classmap.dev, chooses Receive, and enters the code. It’s encrypted from end to end and nothing is stored on a server.', k: 'send receive share transfer another device teacher airdrop code' },
  { q: 'Where is my data stored?', a: 'On this device, in your browser. There are no accounts. Use “Back up everything” on the home page now and then to keep a copy.', k: 'data stored saved privacy backup where cloud account' },
  { q: 'How do I back up or restore?', a: 'On the home page, use “Back up everything” to download every class and chart as one file, and Import file to restore it on any device.', k: 'backup restore export import file' },
  { q: 'How do I undo?', a: 'Press Ctrl+Z (⌘Z on a Mac) or the ↶ button at the top. Deleted charts and classes also show an Undo button for a few seconds.', k: 'undo mistake deleted back' },
  { q: 'Can ClassMap arrange the tables for me?', a: 'Yes. In the Layout tab, Room check points out blocked doors and walkways, Tidy up straightens tables, and Arrange for me suggests a whole layout. Nothing moves until you press Apply.', k: 'arrange tidy room check walkway smart layout suggest' },
  { q: 'What does the on-device AI do?', a: 'It turns plain-English seating wishes into rules, polishes emails to parents, and summarizes accommodations into seating notes. It runs in your browser; student information never leaves this device.', k: 'ai assistant helper model on-device private chat' },
];

const GUIDES = [
  'how-to-make-a-seating-chart', 'separating-students', 'group-seating-pairs-and-tables',
  'classroom-seating-arrangements', 'boy-girl-seating-chart', 'seating-chart-for-substitute-teachers',
];

let guideSections = null;
async function loadGuides() {
  if (guideSections) return guideSections;
  const out = [];
  await Promise.all(GUIDES.map(async slug => {
    try {
      const res = await fetch(`/guides/${slug}/`);
      if (!res.ok) return;
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const title = (doc.querySelector('h1')?.textContent || slug).trim();
      const main = doc.querySelector('main') || doc.body;
      let cur = { title, heading: '', text: '', url: `/guides/${slug}/` };
      const push = () => { if (cur.text.trim()) out.push(cur); };
      main.querySelectorAll('h2, h3, p, li').forEach(el => {
        if (/^H[23]$/.test(el.tagName)) { push(); cur = { title, heading: el.textContent.trim(), text: '', url: `/guides/${slug}/` }; }
        else cur.text += ' ' + el.textContent.trim();
      });
      push();
    } catch { /* offline: the short answers still work */ }
  }));
  guideSections = out;
  return out;
}

const STOP = new Set('a an the to of in on for and or i my do does how what can is it be with at from this that me you your we our'.split(' '));
const words = s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w));
const stem = w => w.replace(/(ing|ed|es|s)$/, '');

function score(qWords, text, boost = 1) {
  const t = words(text).map(stem);
  const set = new Set(t);
  let n = 0;
  qWords.forEach(w => { if (set.has(w)) n += 2; else if (w.length > 3 && t.some(x => x.startsWith(w.slice(0, 4)))) n += 1; });
  return n * boost;
}

// [{ kind: 'faq'|'guide', title, text, url? , score }]
export async function searchHelp(query, limit = 5) {
  const q = words(query).map(stem);
  if (!q.length) return [];
  const faq = FAQ.map(f => ({ kind: 'faq', title: f.q, text: f.a, score: score(q, f.q + ' ' + f.k, 1.5) + score(q, f.a, 0.5) }));
  const guides = (await loadGuides()).map(g => ({ kind: 'guide', title: g.heading ? `${g.title} — ${g.heading}` : g.title, text: g.text.trim(), url: g.url, score: score(q, g.heading, 1.2) + score(q, g.text, 0.4) + score(q, g.title, 0.6) }));
  return [...faq, ...guides].filter(r => r.score >= 2).sort((a, b) => b.score - a.score).slice(0, limit);
}

export function helpPrompt(question, hits) {
  const ctx = hits.slice(0, 3).map((h, i) => `[${i + 1}] ${h.title}\n${h.text.slice(0, 700)}`).join('\n\n');
  return [
    { role: 'system', content: `You answer questions about ClassMap, a seating chart app for teachers. Use only the notes below. If they don't answer the question, say you're not sure and suggest the closest note. Two to four sentences, plain words.\n\nNotes:\n${ctx || '(none)'}` },
    { role: 'user', content: question },
  ];
}
