export const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = String(text); if (className) el.className = className; return el; };
export const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-GB') : '—';
export const duration = value => { const seconds = Math.max(0, Math.floor(Number(value || 0) / 1000)); return `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}m ${String(seconds % 60).padStart(2, '0')}s`; };
export function table(container, headings, rows, empty = 'No records yet.') {
  container.replaceChildren(); if (!rows.length) { container.append(node('p', empty, 'empty')); return; }
  const result = node('table'), head = node('thead'), tr = node('tr'), body = node('tbody');
  for (const title of headings) { const cell = node('th', title); cell.scope = 'col'; tr.append(cell); } head.append(tr);
  for (const values of rows) { const row = node('tr'); for (const value of values) { const cell = node('td'); if (value instanceof Node) cell.append(value); else cell.textContent = String(value ?? '—'); row.append(cell); } body.append(row); }
  result.append(head, body); container.append(result);
}
export const uncertain = error => ['TimeoutError','TypeError','SyntaxError','AbortError'].includes(error.name);
