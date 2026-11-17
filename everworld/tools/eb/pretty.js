#!/usr/bin/env node
/* A small formatter for READING minified JavaScript (not a parser): new lines after ; { } outside strings, templates, regular
 * expressions and round brackets. Made to read GG Winner's data-server bundle, which ships minified with the app:
 *   node tools/eb/pretty.js gg/static/server/gg.mjs /tmp/gg.pretty.mjs      (3,458 lines; the model starts at "var G={n0:6")
 */
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
let out = '', i = 0; const st = [];
const depth = () => st.filter((x) => x === '{').length;
const nl = () => { out = out.replace(/[ \t]+$/, ''); out += '\n' + '  '.repeat(depth()); };
while (i < src.length) {
  const c = src[i];
  if (c === '"' || c === "'") { let j = i + 1; while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; } out += src.slice(i, j + 1); i = j + 1; continue; }
  if (c === '`') { let j = i + 1, d = 0; while (j < src.length) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '$' && src[j + 1] === '{') { d++; j += 2; continue; } if (src[j] === '}' && d > 0) { d--; j++; continue; } if (src[j] === '`' && d === 0) break; j++; } out += src.slice(i, j + 1); i = j + 1; continue; }
  if (c === '/' && src[i + 1] !== '/' && src[i + 1] !== '*') { // a regular expression literal (after an operator or bracket), skipped whole
    const prev = out.replace(/\s+$/, '').slice(-1);
    if (!prev || '(,=:[!&|?{};+-*%<>~^'.includes(prev) || /\b(return|typeof|case|in|of)$/.test(out.replace(/\s+$/, ''))) {
      let j = i + 1, cls = false; while (j < src.length) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; j++; }
      j++; while (/[a-z]/.test(src[j] || '')) j++;
      out += src.slice(i, j); i = j; continue;
    }
  }
  if (c === '(' || c === '[') { st.push(c); out += c; i++; continue; }
  if (c === ')' || c === ']') { st.pop(); out += c; i++; continue; }
  if (c === '{') { out += c; st.push(c); nl(); i++; continue; }
  if (c === '}') { st.pop(); nl(); out += c; i++; if (!',;)`.'.includes(src[i] || '')) nl(); continue; }
  if (c === ';' && (st.length === 0 || st[st.length - 1] === '{')) { out += c; nl(); i++; continue; }
  out += c; i++;
}
fs.writeFileSync(process.argv[3], out);
console.log(out.split('\n').length, 'lines');
