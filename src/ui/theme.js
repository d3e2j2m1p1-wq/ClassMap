// ── Theme toggle ──
export function toggleTheme() {
  const isLight = document.body.classList.toggle('light');
  document.getElementById('themeBtn').textContent = isLight ? '🌙' : '☀️';
  try { localStorage.setItem('classmap_theme', isLight ? 'light' : 'dark'); } catch(e) {}
}
