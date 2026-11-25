// Guides, privacy and contact pages: the back-to-top button, and the contact form
const up = document.querySelector('.to-top');
if (up) {
  const show = () => up.classList.toggle('show', scrollY > innerHeight * 0.8);
  addEventListener('scroll', show, { passive: true });
  show();
}
document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });

// ── Contact: the message opens in the teacher's own email app (nothing goes through a server) ──
const EMAIL = 'MiguelDavila94@gmail.com';
const form = document.getElementById('contactForm');
if (form) {
  form.addEventListener('submit', e => {
    e.preventDefault();
    const topic = form.querySelector('input[name=topic]:checked')?.value || 'Question';
    const name = form.name.value.trim(), school = form.school.value.trim(), msg = form.message.value.trim();
    if (!msg) { form.message.focus(); return; }
    const body = [msg, '', '—', name && `From: ${name}`, school && `School / role: ${school}`, `Sent from classmap.dev/contact · ${navigator.userAgent}`]
      .filter(x => x !== false && x !== '').join('\n');
    const url = `mailto:${EMAIL}?subject=${encodeURIComponent(`ClassMap: ${topic}`)}&body=${encodeURIComponent(body)}`;
    (window.__cmOpenMail || (u => { location.href = u; }))(url);   // the hook is for tests
    document.getElementById('contactSent').hidden = false;
  });
  document.querySelector('.copy-btn')?.addEventListener('click', async e => {
    try { await navigator.clipboard.writeText(EMAIL); e.target.textContent = 'Copied ✓'; } catch { e.target.textContent = 'Select & copy'; }
    setTimeout(() => { e.target.textContent = 'Copy'; }, 2000);
  });
}
