import { isSpanish, translate } from '../i18n/i18n.js';
import { dist } from './understand.js';
// ═══════════════════════════════════════════════
//  HELP SEARCH
//  Short answers about the app, plus every section of the guides on classmap.dev.
//  Matches whole words, word beginnings, and words with a small typo.
// ═══════════════════════════════════════════════

// `do`: what to type into the helper to have it done for you
export const FAQ = [
  { q: 'How do I add a class?', a: 'On the home page, type the class name in the “New class name…” box at the bottom of the class list (left side), then press Add.', k: 'add class create new class make period section', do: 'Make a class called ' },
  { q: 'How do I add students?', a: 'Pick a class on the home page, open the Roster tab, and paste your list (one name per line) or type names one at a time.', k: 'add students roster paste list names import', do: 'Add students: ' },
  { q: 'How do I make a new chart?', a: 'Pick a class on the home page and press + New Chart. A new chart starts from the same room as the class’s last chart, with nobody seated.', k: 'new chart create start' },
  { q: 'How do I build the room?', a: 'In a chart, open the Layout tab. Place tables one at a time with the Table tool, then add the board, teacher’s desk, doors and windows. Drag to move, use the corner handle to resize, and rotate in 45° steps (hold Shift for free rotation).', k: 'layout room tables desk board door window build resize rotate walls' },
  { q: 'How do I change the shape of the room?', a: 'In the Layout tab, open Walls. You can draw an L-shape or other outline instead of a rectangle.', k: 'walls shape room outline l-shaped' },
  { q: 'How do I keep two students apart?', a: 'Open the Rules tab (on the home page for rules that always apply, or in a chart for this chart only) and add “Keep apart”. Or type it into the helper: “Keep Liam and Owen apart.”', k: 'keep apart separate rule distract not together', do: 'Keep  and  apart' },
  { q: 'How do I seat students automatically?', a: 'Open Auto-Assign in a chart and press Assign. It follows your rules and tag settings, and keeps pinned students where they are.', k: 'auto assign automatic seat everyone shuffle random', do: 'Auto-assign seats' },
  { q: 'How do I keep a student in their seat when I re-assign?', a: 'Pin them: click their seat and press P, or use the pin next to their name in the Auto-Assign panel. Auto-Assign leaves pinned students alone.', k: 'pin lock keep seat' },
  { q: 'What are tags?', a: 'Tags (IEP, 504, ELL, Strong reader …) mark students so rules can use them, like spreading IEP students across groups or seating ELL students with a strong reader. Add them with 🏷 next to a name in the Roster tab, or tell the helper: “Tag Owen as IEP.” Tags never show on the projector or the printed chart; private tags also stay off the substitute page.', k: 'tags iep 504 ell label mark private badge' },
  { q: 'How do I show the chart on the projector?', a: 'In a chart, press Present. It opens full screen with names only; tags and notes stay hidden. Press Esc to leave.', k: 'present projector full screen show class' },
  { q: 'How do I print the chart or make a sub plan?', a: 'In a chart, use Print. You can print the seating chart, and a substitute page with the class’s rules (private tags left out).', k: 'print substitute sub plan paper pdf' },
  { q: 'How do I move a chart to another device or teacher?', a: 'Press “Send or receive classes” in the left bar of the home page (or ⇡ Send in a chart). The other device opens classmap.dev/app and types the code into “Got a code?”. It’s encrypted from end to end and nothing is stored on a server.', k: 'send receive share transfer another device teacher airdrop code phone' },
  { q: 'Where is my data stored?', a: 'On this device, in your browser. There are no ClassMap accounts. To keep a copy, sign in with Google (the G at the top of the home page) to save it in your own Google Drive, or use ⚙ → Back up everything now and then.', k: 'data stored saved privacy backup where cloud account google drive' },
  { q: 'How do I back up or restore?', a: 'On the home page, open ⚙ → Back up everything to download every class and chart as one file, and ⚙ → Import file to restore it on any device. Or sign in with Google (the G at the top) and it’s saved to your Google Drive automatically.', k: 'backup restore export import file google drive sync' },
  { q: 'How do I use ClassMap on more than one device?', a: 'Sign in with Google (the G at the top of the home page) on each device: your classes are kept in your own Google Drive and stay in sync. For a one-time move, use “Send or receive classes” in the left bar.', k: 'sync devices laptop phone ipad home school google drive sign in account' },
  { q: 'How do I undo?', a: 'Press Ctrl+Z (⌘Z on a Mac) or the ↶ button at the top. Deleted charts and classes also show an Undo button for a few seconds.', k: 'undo mistake deleted back' },
  { q: 'Can ClassMap arrange the tables for me?', a: 'Yes. In the Layout tab, Room check points out blocked doors and walkways, Tidy up straightens tables, and Arrange for me suggests a whole layout. Nothing moves until you press Apply.', k: 'arrange tidy room check walkway smart layout suggest' },
  { q: 'How do I track participation?', a: 'Open a chart, go to Assign and press ★ Points (bottom left). Tap a student each time they take part; the bar lists who hasn’t had a turn yet today. In the Name picker you can “Favor fewer points” so quieter students get called on more. Points stay on this device and never show on the projector.', k: 'participation points tally called on quiet students turn engagement', do: '' },
  { q: 'Is there a timer or voice level sign?', a: 'Yes. Open the 🧰 Tools tab (or ⋯ in a chart) and choose Timer or Voice level. Both are full screen for the projector. Or tell the helper “5 minute timer” or “voice level 0”.', k: 'timer countdown clock voice level noise quiet sign projector', do: '5 minute timer' },
  { q: 'Can I print name tents or desk labels?', a: 'Yes. In the 🧰 Tools tab choose “Name tents & desk labels”. Name tents fold to show the name on both sides (two per page). Desk labels print twelve per page; from an open chart they come out in seat order with each table’s name.', k: 'name tents tags labels desk print first day cards', do: '' },
  { q: 'How do I take attendance?', a: 'Open a chart, go to Assign and press ✓ Attendance (bottom left). Tap a student once for absent, twice for late, again for here, then Copy the list for your school’s system. You can also use “Here” in the 🧰 Tools tab. Attendance stays on this device and never shows on the projector.', k: 'attendance absent late tardy roll call present missing', do: 'Take attendance' },
  { q: 'Can I leave students out of the name picker?', a: 'Yes. In the Name picker, press “Skip list” and tap the students who shouldn’t be called on at random. They stay in groups and everything else. Absent students are skipped automatically.', k: 'skip exclude leave out name picker random call on anxious', do: '' },
  { q: 'How do I pick a random student or make groups?', a: 'Open a class on the home page and choose the 🧰 Tools tab (or ⋯ in a chart). The Name picker gives everyone a turn before anyone repeats; the Group maker makes groups that follow your class rules. Mark absent students with “Here” at the top.', k: 'random name picker call on student groups group maker activity partners absent', do: 'Make groups of ' },
  { q: 'What can Ask ClassMap do?', a: 'Type what you want in everyday words. It can make classes, add and tag students, set seating rules (“Keep Liam and Owen apart”), swap or move seats, pin students, auto-assign, start a timer, take attendance, and answer questions like “Who’s tagged IEP?” or “Who sits next to Owen?”. Answers come from your real class data, and nothing changes until you press Apply. Everything stays on this device.', k: 'ask classmap helper assistant chat what can you do bubble' },
  { q: 'How do I switch between light and dark?', a: 'Tap the little scene at the top right (or drag the lens across it). Your choice is remembered on this device.', k: 'dark mode light theme night colors switch' },
  { q: 'How do I use ClassMap in Spanish?', a: 'Press “Español” at the top of the home page. Press it again (“English”) to switch back.', k: 'spanish español language english translate idioma' },
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

const STOP = new Set(('a an the to of in on for and or i my do does how what can is it be with at from this that me you your we our help please need want get ' +
  'el la los las un una unos unas de del al y o en con por para que qué cómo como mi mis tu tus se es son lo le me puedo hago hacer').split(' '));
const plain = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const words = s => plain(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w));
const stem = w => w.replace(/(ing|ed|es|s|ar|er|ir|o|a)$/, '');

function score(qWords, text, boost = 1) {
  const t = words(text).map(stem);
  const set = new Set(t);
  let n = 0;
  qWords.forEach(w => {
    if (set.has(w)) n += 2;
    else if (w.length > 3 && t.some(x => x.startsWith(w.slice(0, 4)))) n += 1;
    else if (w.length >= 5 && t.some(x => x.length >= 4 && dist(w, x, 1) <= 1)) n += 1;   // a small typo
  });
  return n * boost;
}

// [{ kind: 'faq'|'guide', title, text, url? , score }]
export async function searchHelp(query, limit = 5, minScore = 2) {
  const q = words(query).map(stem);
  if (!q.length) return [];
  // in Spanish, the Spanish wording of each answer is searched too
  const es = s => (isSpanish() ? ' ' + translate(s) : '');
  const faq = FAQ.map(f => ({ kind: 'faq', title: f.q, text: f.a, score: score(q, f.q + es(f.q) + ' ' + f.k, 1.5) + score(q, f.a + es(f.a), 0.5) }));
  const guides = (await loadGuides()).map(g => ({ kind: 'guide', title: g.heading ? `${g.title} — ${g.heading}` : g.title, text: g.text.trim(), url: g.url, score: score(q, g.heading, 1.2) + score(q, g.text, 0.4) + score(q, g.title, 0.6) }));
  return [...faq, ...guides].filter(r => r.score >= minScore).sort((a, b) => b.score - a.score).slice(0, limit);
}
