// ClassMap — entry point.
// Loads the styles, makes the functions used by onclick="…" attributes global,
// then starts the app (same start-up order as the original single file).

// Fonts are bundled with the app (no calls to Google Fonts)
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-500.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/nunito/latin-900.css';
import '@fontsource/caveat/latin-700.css';
import './styles/base.css';
import './styles/app-shell.css';
import './styles/editor-roster.css';
import './styles/editor-rules.css';
import './styles/layout.css';
import './styles/assign.css';
import './styles/components.css';
import './styles/assign-panel.css';
import './styles/landing.css';
import './styles/notices-namelist.css';
import './styles/table-groups.css';
import './styles/touch.css';
import './styles/dialogs.css';
import './styles/features.css';
import './styles/ai.css';
import './styles/paper.css';
import './styles/theme-switch.css';
import './styles/mobile.css';

import { store } from './core/store.js';
import { autoAssign, clearAssignments, toggleAssignPanel } from './assign/autoAssign.js';
import { initAssignInteractions } from './assign/interactions.js';
import { closeViolationBanner } from './assign/rulesEngine.js';
import { esc } from './core/state.js';
import { closeModal, showToast } from './core/ui.js';
import { closeMoreMenu, switchPanel, toggleMoreMenu } from './editor/panels.js';
import { initPrint, openPresent, printChart } from './editor/present.js';
import { initUndo, redo, undo } from './editor/undo.js';
import { createSampleClass, initErrorBanner, snoozeBackupReminder } from './landing/welcome.js';
import { renderRoster } from './editor/roster.js';
import { addTempRule, removeTempRule, updateTempFormFields } from './editor/rules.js';
import { createNewChart, deleteChart, duplicateChart, goHome, goHomeToRoster } from './landing/chartOpen.js';
import { addLandingClass, deleteClass, renderClassList, selectClass, showLanding, switchLandingTab } from './landing/landing.js';
import { exportNameList, importNameListFile, learnFromRosters, openNameList, renderNameList } from './landing/nameListViewer.js';
import { ldAddStudent, ldClearRoster, ldDeleteGroup, ldParseRoster, ldToggleGender } from './landing/roster.js';
import { ldAddRule, ldDeleteRule } from './landing/rules.js';
import { initLayoutCanvas, setTool, toggleRotateSnap, updateRotateButton } from './layout/canvas.js';
import { addWalls, openTemplateMenu } from './layout/templates.js';
import { initRoomCheck, toggleRoomCheck } from './layout/roomCheck.js';
import { openArrange } from './layout/arrange.js';
import { openWallsMenu } from './layout/roomEditor.js';
import { openReceive, openShare, receiveFromLink, sendChart, sendClass, sendCurrentChart } from './share/shareUI.js';
import { closeHomeMore, toggleHomeMore } from './landing/homeMore.js';
import { alignSelection, deleteSelection, distributeSelection, duplicateSelection, editItemName, initLayoutKeys, numberTables, toggleMultiTap } from './layout/selection.js';
import { handleLayoutImg, layoutUploadImg, shrinkStoredImages } from './layout/image.js';
import { toggleTableToolMenu, updateTableToolBadge } from './layout/tableGroups.js';
import { clearLayout } from './layout/tables.js';
import { flushSave, manualSave, markDirty } from './storage/autosave.js';
import { exportEverything, restoreEverything } from './storage/backup.js';
import { initDrive, signIn as driveSignIn, signOut as driveSignOut, syncNow as driveSyncNow, toggleSyncMenu } from './storage/drive.js';
import { CLASS_COLORS, initStorage, saveLandingData } from './storage/landingData.js';
import { guessGroupForClass } from './roster/nameList.js';
import { exportData, importDataFromFile } from './storage/chartFile.js';
import { initThemeSwitch, toggleTheme } from './ui/themeSwitch.js';
import { initAssistant, openPanel as openAssistant } from './ai/assistant.js';
import { getLang, initLanguage, setLanguage } from './i18n/i18n.js';
import { fitZoom, initZoom, setZoom, zoomOf } from './ui/zoom.js';
import { classPanelTab, toggleClassPanel } from './assign/sidePanel.js';
import { closeTools, openTools } from './tools/tools.js';
import { classroomEnabled, openClassroomImport } from './storage/classroom.js';
import { initAttendanceMode, setAttendanceMode } from './assign/attendanceMode.js';
import { initParticipationMode, setPointsMode } from './assign/participationMode.js';
import './styles/tools.css';

// index.html (and HTML built in JS strings) calls these from onclick/onchange/… attributes,
// which only see global names — so they are put on window.
Object.assign(window, {
  openWallsMenu,
  openShare,
  openReceive,
  sendClass,
  sendChart,
  sendCurrentChart,
  toggleHomeMore,
  closeHomeMore,
  toggleRoomCheck,
  openArrange,
  addWalls,
  openTemplateMenu,
  toggleRotateSnap,
  editItemName,
  numberTables,
  alignSelection,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  toggleMultiTap,
  addLandingClass,
  addTempRule,
  autoAssign,
  clearAssignments,
  clearLayout,
  closeModal,
  closeMoreMenu,
  closeViolationBanner,
  createNewChart,
  createSampleClass,
  deleteChart,
  deleteClass,
  driveSignIn,
  driveSignOut,
  driveSyncNow,
  toggleSyncMenu,
  duplicateChart,
  esc,
  exportData,
  exportEverything,
  exportNameList,
  goHome,
  goHomeToRoster,
  handleLayoutImg,
  importDataFromFile,
  importNameListFile,
  layoutUploadImg,
  ldAddRule,
  ldAddStudent,
  ldClearRoster,
  ldDeleteGroup,
  ldDeleteRule,
  ldParseRoster,
  ldToggleGender,
  learnFromRosters,
  manualSave,
  openNameList,
  openPresent,
  printChart,
  redo,
  removeTempRule,
  renderNameList,
  restoreEverything,
  setTool,
  snoozeBackupReminder,
  switchLandingTab,
  switchPanel,
  toggleAssignPanel,
  toggleMoreMenu,
  toggleTableToolMenu,
  toggleTheme,
  openAssistant,
  toggleLanguage,
  classPanelTab,
  openTools,
  openClassroomImport,
  setAttendanceMode,
  setPointsMode,
  closeTools,
  toggleClassPanel,
  undo,
  updateTempFormFields,
});

// Dev/test only: every module's exports in one place (used by tests/ and handy in the console)
if (import.meta.env.DEV) {
  const all = import.meta.glob(['./**/*.js', '!./main.js', '!./ai/aiWorker.js', '!./site/**'], { eager: true });
  window.__cm = Object.assign({ store }, ...Object.values(all));
}

// ═══════════════════════════════════════════════
//  START-UP
// ═══════════════════════════════════════════════
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

initErrorBanner();
initLanguage();     // English or Spanish (🌐 on the home page)
langButtons();

initLayoutCanvas();
initLayoutKeys();
updateRotateButton();
initRoomCheck();

initAssignInteractions();

initUndo();

initPrint();

updateTableToolBadge();

renderRoster();

// Autosave hooks
document.getElementById('classNameInput').addEventListener('input', markDirty);

document.getElementById('sessionNotes').addEventListener('input', markDirty);

window.addEventListener('beforeunload', flushSave);

window.addEventListener('pagehide', flushSave);

document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

// Restore saved theme
try {
  // Light (cream paper) is the default; dark only if the teacher picked it
  if (localStorage.getItem('classmap_theme') !== 'dark') document.body.classList.add('light');
  initThemeSwitch();
} catch(e) {}

// Load saved data (IndexedDB), then show the home page
(async () => {
  await initStorage();
  window.__cm_refreshLanding = showLanding;     // Drive sync redraws the home page with new data
  showLanding();
  takeHandoff();       // names typed into "Try it" on the home page
  shrinkStoredImages();
  initDrive();
  receiveFromLink();   // opened from a "Receive" link or QR code
  window.addEventListener('hashchange', receiveFromLink);   // …or a link opened while ClassMap was already open
  initZoom();            // − / Fit / + and pinch on the room
  initAttendanceMode();  // ✓ Attendance in the Assign view
  initParticipationMode(); // ★ Points in the Assign view
  if (classroomEnabled()) document.querySelectorAll('.gc-import-btn').forEach(b => { b.hidden = false; });
  initAssistant();       // help + on-device AI (lower right)
  // index.html shows a "couldn't start" screen if this line is never reached
  window.__classmapStarted = true;
})();

// ── PWA: Register real service worker ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('../sw.js', location.href))
    .then(() => console.log('ClassMap SW registered'))
    .catch(e => console.warn('SW registration failed:', e));
}

// ── Language (🌐 on the home page and in ⋯) ──
function langButtons() {
  document.querySelectorAll('.lang-btn').forEach(b => {
    const label = getLang() === 'es' ? '🌐 English' : '🌐 Español';
    const span = b.querySelector('span');
    (span || b).textContent = label;
  });
}
function toggleLanguage() {
  setLanguage(getLang() === 'es' ? 'en' : 'es');
  langButtons();
}

// ── "Try it" on the home page → a class here (same browser; nothing is sent anywhere) ──
function takeHandoff() {
  let h = null;
  try { h = JSON.parse(localStorage.getItem('cm-handoff') || 'null'); localStorage.removeItem('cm-handoff'); } catch { return; }
  if (!h || !Array.isArray(h.names) || !h.names.length || Date.now() - (h.at || 0) > 30 * 60000) return;
  const classes = store.landingData.classes;
  let name = 'My class', n = 2;
  while (classes.some(c => c.name === name)) name = `My class ${n++}`;
  const cls = { id: 'cls_' + Date.now(), name, color: CLASS_COLORS[classes.length % CLASS_COLORS.length], students: [], hardRules: [], genderMode: false };
  h.names.slice(0, 60).map(x => String(x).trim().slice(0, 60)).filter(Boolean).forEach((nm, i) =>
    cls.students.push({ id: 'st_' + Date.now() + '_' + i, name: nm, gender: guessGroupForClass(cls, nm) || null }));
  classes.push(cls);
  saveLandingData();
  renderClassList();
  selectClass(cls.id);
  switchLandingTab('roster');
  showToast(`✓ ${name} is ready with ${cls.students.length} students. Next: + New Chart to build your room.`);
}
