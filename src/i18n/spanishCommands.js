// ═══════════════════════════════════════════════
//  The helper in Spanish: the usual ways a teacher asks, rewritten into the English phrasing
//  the command reader knows ("Separa a Liam y Owen" → "Keep Liam and Owen apart").
//  Anything not covered goes to the help search, which also reads Spanish.
// ═══════════════════════════════════════════════
const NUM = { uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, diez: 10, quince: 15, veinte: 20, treinta: 30 };
const n = w => (w && (+w || NUM[w.toLowerCase()])) || '';
// "Ana, Luis y Mia" → "Ana, Luis and Mia"
const names = s => s.replace(/\s+(?:y|e)\s+/gi, ' and ').replace(/^(?:a|al)\s+/i, '').replace(/\s+a\s+/gi, ' ').trim();

const RULES = [
  // how-to questions → help
  [/^¿?\s*c[oó]mo\s+(.+?)\??$/i, m => `How do I ${m[1]}`],
  // classes
  [/^(?:crea|haz|hazme|crear|hacer|agrega|añade|nueva)\s+(?:una\s+)?(?:nueva\s+)?clase(?:\s+(?:llamada|que se llame|de nombre))?\s+(.+?)(?:\s+con\s+(.+))?$/i, m => `Make a class called ${m[1]}${m[2] ? ' with ' + names(m[2]) : ''}`],
  [/^(?:abre|ve a|cambia a|muestra)\s+(?:la\s+)?clase\s+(.+)$/i, m => `Open ${m[1]}`],
  [/^¿?\s*qu[eé]\s+clases\s+tengo\??$|^(?:mis\s+)?clases\??$/i, () => 'What classes do I have'],
  // roster
  [/^(?:agrega|añade|agregar|añadir)\s+(?:estos\s+|los\s+siguientes\s+)?(?:estudiantes|alumnos|nombres)?\s*(?:a\s+(?:la\s+)?(?:clase|lista)\s+([^:]+?))?\s*:\s*([\s\S]+)$/i, m => `Add students${m[1] ? ' to ' + m[1] : ''}: ${names(m[2])}`],
  [/^(?:agrega|añade)\s+(?:a\s+)?(.+?)\s+a\s+la\s+(?:clase|lista)$/i, m => `Add ${names(m[1])} to the class`],
  [/^(?:etiqueta|marca)\s+(?:a\s+)?(.+?)\s+(?:como|con)\s+(?!ausente|tarde|retardo|presente)(.+)$/i, m => `Tag ${names(m[1])} as ${m[2]}`],
  [/^(?:quita|quítale)\s+(?:la\s+etiqueta\s+)?(.+?)\s+a\s+(.+)$/i, m => `Remove ${m[1]} from ${names(m[2])}`],
  // rules
  [/^(?:separa|aleja)\s+(?:a\s+)?(.+)$/i, m => `Keep ${names(m[1])} apart`],
  [/^(?:mant[eé]n|deja)\s+(?:a\s+)?(.+?)\s+(?:separados|separadas|lejos|apartados)$/i, m => `Keep ${names(m[1])} apart`],
  [/^(.+?)\s+no\s+(?:deben|pueden|tienen que)\s+(?:sentarse|estar|trabajar)\s+juntos$/i, m => `Keep ${names(m[1])} apart`],
  [/^(?:sienta|pon|mueve)\s+(?:a\s+)?(.+?)\s+(?:junto a|al lado de|cerca de|con)\s+(?:a\s+)?(.+)$/i, m => `Seat ${names(m[1])} next to ${names(m[2])}`],
  [/^(?:pon|mant[eé]n)\s+(?:a\s+)?(.+?)\s+en\s+el\s+mismo\s+grupo$/i, m => `Put ${names(m[1])} in the same group`],
  [/^(.+?)\s+(?:necesita|debe|tiene que)\s+(?:sentarse|estar|ir)\s+(?:al\s+frente|adelante|en\s+la\s+fila\s+de\s+adelante|cerca\s+de\s+la\s+pizarra)$/i, m => `${names(m[1])} needs the front`],
  [/^(.+?)\s+(?:necesita|debe|tiene que)\s+(?:sentarse|estar|ir)\s+(?:atr[aá]s|al\s+fondo|en\s+la\s+fila\s+de\s+atr[aá]s)$/i, m => `${names(m[1])} in the back`],
  [/^(?:reparte|separa)\s+a\s+(?:los|las)\s+(?:estudiantes\s+)?(?:de|con)\s+(.+)$/i, m => `Spread out the ${m[1]} students`],
  [/^¿?\s*(?:cu[aá]les\s+son\s+las|muestra\s+las|qu[eé])\s+reglas\??$/i, () => 'What are the rules'],
  [/^(?:revisa|checa|verifica)\s+(?:las\s+)?reglas$/i, () => 'Check the rules'],
  // seats
  [/^(?:intercambia|cambia)\s+(?:de\s+lugar\s+)?(?:a\s+)?(.+?)\s+(?:y|con)\s+(?:a\s+)?(.+)$/i, m => `Swap ${m[1]} and ${m[2]}`],
  [/^(?:fija|ancla)\s+(?:a\s+)?(.+)$/i, m => `Pin ${names(m[1])}`],
  [/^(?:suelta|desfija)\s+(?:a\s+)?(.+)$/i, m => `Unpin ${names(m[1])}`],
  [/^(?:saca|quita)\s+(?:a\s+)?(.+?)\s+de\s+su\s+asiento$/i, m => `Unseat ${names(m[1])}`],
  [/asigna(?:r)?\s+(?:los\s+)?asientos|asignaci[oó]n\s+autom[aá]tica|acomoda\s+a\s+todos|revuelve\s+(?:la\s+clase|los\s+asientos)/i, () => 'Auto-assign seats'],
  [/^(?:empieza|crea|haz|nuevo)\s+(?:un\s+)?(?:nuevo\s+)?mapa/i, () => 'Start a new chart'],
  // questions
  [/^¿?\s*cu[aá]ntos\s+(?:estudiantes|alumnos)/i, () => 'How many students'],
  [/^¿?\s*qui[eé]n(?:es)?\s+(?:tiene|tienen|est[aá]n?\s+etiquetad[oa]s?\s+(?:como|con))\s+(?:un\s+|una\s+)?(.+?)\??$/i, m => `Who is tagged ${m[1]}`],
  [/^¿?\s*d[oó]nde\s+(?:se\s+sienta|est[aá])\s+(.+?)\??$/i, m => `Where is ${m[1]} sitting`],
  [/^¿?\s*qui[eé]n(?:es)?\s+(?:se\s+sienta|se\s+sientan|est[aá]n?)\s+(?:junto\s+a|al\s+lado\s+de|cerca\s+de|con)\s+(.+?)\??$/i, m => `Who sits next to ${m[1]}`],
  [/^¿?\s*qui[eé]n(?:es)?\s+no\s+tiene[n]?\s+asiento\??$/i, () => 'Who doesn’t have a seat'],
  [/^¿?\s*qui[eé]n(?:es)?\s+(?:falta[n]?|est[aá]n?\s+ausentes?)(?:\s+hoy)?\??$/i, () => 'Who is absent'],
  [/^¿?\s*qui[eé]n(?:es)?\s+(?:lleg[oó]|llegaron)\s+tarde(?:\s+hoy)?\??$/i, () => 'Who is late'],
  // attendance
  [/^(?:marca|pon)\s+(?:a\s+)?(.+?)\s+(?:como\s+)?(ausente|ausentes|presente|presentes|tarde|con\s+retardo)(?:\s+hoy)?$/i, m => `Mark ${names(m[1])} ${/ausente/i.test(m[2]) ? 'absent' : /presente/i.test(m[2]) ? 'here' : 'late'}`],
  [/^(.+?)\s+(?:est[aá]n?|vino|vinieron)\s+(ausentes?|presentes?|tarde)(?:\s+hoy)?$/i, m => `${names(m[1])} is ${/ausente/i.test(m[2]) ? 'absent' : /presente/i.test(m[2]) ? 'here' : 'late'}`],
  [/^(?:pasa|pasar|tomar|toma)\s+(?:la\s+)?(?:lista|asistencia)$/i, () => 'Take attendance'],
  // tools
  [/(?:elige|escoge|saca)\s+(?:un\s+)?(?:nombre|estudiante|alumno|a\s+alguien)(?:\s+al\s+azar)?|nombre\s+al\s+azar/i, () => 'Pick a name'],
  [/(?:haz|forma|arma|divide\s+(?:la\s+clase\s+)?en)\s+(\w+)\s+grupos/i, m => `Make ${n(m[1])} groups`],
  [/(?:haz|forma|arma)\s+grupos\s+de\s+(\w+)/i, m => `Make groups of ${n(m[1])}`],
  [/temporizador\s+(?:de\s+)?(\w+)\s+min|(\w+)\s+minutos?\s+(?:de\s+)?temporizador|cron[oó]metro\s+(?:de\s+)?(\w+)\s+min/i, m => `${n(m[1] || m[2] || m[3])} minute timer`],
  [/nivel\s+de\s+voz\s+([0-3])/i, m => `Voice level ${m[1]}`],
  [/letreros?\s+de\s+nombres?|etiquetas?\s+(?:para|de)\s+(?:los\s+)?pupitres/i, () => 'Print name tents'],
];

export function fromSpanish(text) {
  const t = String(text).trim().replace(/^(?:por\s+favor,?\s+|puedes\s+|podr[ií]as\s+)/i, '').replace(/,?\s+por\s+favor[.!]?$/i, '').replace(/[.!]+$/, '');
  for (const [re, f] of RULES) { const m = re.exec(t); if (m) return f(m); }
  return null;
}
