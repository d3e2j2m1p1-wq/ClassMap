// Pasted text → list of student names
//  • One student per line.
//  • Spreadsheet rows (cells split by tabs) become ONE student: a header row such as
//    "First Name | Last Name | ID" is skipped and says which columns hold the name;
//    without a header, columns containing numbers (IDs, grades) are dropped and the rest joined.
//  • "Last, First" stays one student. Three or more commas on one line = a list of names.
//  • Leading list numbers ("1. ", "2) ") are removed.
export function parseRosterText(text) {
  const out = [];
  let cols = null;          // { first, last } or { name } from a header row
  let firstLine = true;
  text.split(/\r?\n/).forEach(line => {
    if (!line.trim()) return;
    const isFirst = firstLine;
    firstLine = false;

    if (line.includes('\t')) {
      const cells = line.split('\t').map(c => c.trim());
      if (isFirst) {
        const low = cells.map(c => c.toLowerCase());
        const fi = low.findIndex(c => /\b(first|given|preferred)\b/.test(c));
        const li = low.findIndex(c => /\b(last|surname|family)\b/.test(c));
        const ni = low.findIndex(c => /\bnames?\b/.test(c));
        if (fi >= 0 || li >= 0 || ni >= 0) {
          cols = (fi >= 0 && li >= 0) ? { first: fi, last: li } : { name: ni >= 0 ? ni : (fi >= 0 ? fi : li) };
          return;
        }
      }
      let name = '';
      if (cols && cols.first !== undefined) name = [cells[cols.first], cells[cols.last]].filter(Boolean).join(' ');
      else if (cols && cells[cols.name]) name = cells[cols.name];
      else name = cells.filter(c => c && !/\d/.test(c)).join(' ');
      if (name) out.push(name);
      return;
    }

    let t = line.trim().replace(/^\d+\s*[.)]\s+/, '');
    if (isFirst && /^(student\s+)?names?:?$|\bfirst\s+name\b|\blast\s+name\b/i.test(t)) return;
    const parts = t.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 3) out.push(...parts);
    else if (t) out.push(t);
  });
  return out;
}
