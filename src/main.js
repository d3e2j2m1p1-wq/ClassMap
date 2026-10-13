// ClassMap — entry point.
// Loads the styles, makes the functions used by onclick="…" attributes global,
// then starts the app (same start-up order as the original single file).

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

import { store } from './core/store.js';
import { autoAssign, clearAssignments, toggleAssignPanel } from './assign/autoAssign.js';
import { initAssignInteractions } from './assign/interactions.js';
import { closeViolationBanner } from './assign/rulesEngine.js';
import { esc } from './core/state.js';
import { closeModal } from './core/ui.js';
import { closeMoreMenu, switchPanel, toggleMoreMenu } from './editor/panels.js';
import { initPrint, openPresent, printChart } from './editor/present.js';
import { initUndo, redo, undo } from './editor/undo.js';
import { createSampleClass, initErrorBanner, snoozeBackupReminder } from './landing/welcome.js';
import { renderRoster } from './editor/roster.js';
import { addTempRule, removeTempRule, updateTempFormFields } from './editor/rules.js';
import { createNewChart, deleteChart, duplicateChart, goHome, goHomeToRoster } from './landing/chartOpen.js';
import { addLandingClass, deleteClass, showLanding, switchLandingTab } from './landing/landing.js';
import { exportNameList, importNameListFile, learnFromRosters, openNameList, renderNameList } from './landing/nameListViewer.js';
import { ldAddStudent, ldClearRoster, ldDeleteGroup, ldParseRoster, ldToggleGender } from './landing/roster.js';
import { ldAddRule, ldDeleteRule } from './landing/rules.js';
import { initLayoutCanvas, setTool } from './layout/canvas.js';
import { handleLayoutImg, layoutUploadImg, shrinkStoredImages } from './layout/image.js';
import { toggleTableToolMenu, updateTableToolBadge } from './layout/tableGroups.js';
import { clearLayout } from './layout/tables.js';
import { flushSave, manualSave, markDirty } from './storage/autosave.js';
import { exportEverything, restoreEverything } from './storage/backup.js';
import { initDrive, signIn as driveSignIn, signOut as driveSignOut, syncNow as driveSyncNow } from './storage/drive.js';
import { initStorage } from './storage/landingData.js';
import { exportData, importDataFromFile } from './storage/chartFile.js';
import { toggleTheme } from './ui/theme.js';

// index.html (and HTML built in JS strings) calls these from onclick/onchange/… attributes,
// which only see global names — so they are put on window.
Object.assign(window, {
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
  undo,
  updateTempFormFields,
});

// Dev/test only: every module's exports in one place (used by tests/ and handy in the console)
if (import.meta.env.DEV) {
  const all = import.meta.glob(['./**/*.js', '!./main.js'], { eager: true });
  window.__cm = Object.assign({ store }, ...Object.values(all));
}

// ═══════════════════════════════════════════════
//  START-UP
// ═══════════════════════════════════════════════
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

initErrorBanner();

initLayoutCanvas();

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
  if (localStorage.getItem('classmap_theme') === 'light') {
    document.body.classList.add('light');
    document.getElementById('themeBtn').textContent = '🌙';
  }
} catch(e) {}

// Load saved data (IndexedDB), then show the home page
(async () => {
  await initStorage();
  window.__cm_refreshLanding = showLanding;     // Drive sync redraws the home page with new data
  showLanding();
  shrinkStoredImages();
  initDrive();
  // index.html shows a "couldn't start" screen if this line is never reached
  window.__classmapStarted = true;
})();

// ── PWA: Register real service worker ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('../sw.js', location.href))
    .then(() => console.log('ClassMap SW registered'))
    .catch(e => console.warn('SW registration failed:', e));
}
