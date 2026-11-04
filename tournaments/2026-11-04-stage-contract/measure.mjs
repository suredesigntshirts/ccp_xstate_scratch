// This tournament's measure: the first tournament's measure (chart primitives, spec lines, engine files changed
// against the base snapshot), plus the prompt wording left in engine code.
//
//   promptInEngine  string and template literals of five or more words in packages/engine/src/**/*.js, comments
//                   excluded: { bytes, literals, byFile: { file: bytes } }. Template ${...} parts are not counted.
import fs from 'node:fs';
import path from 'node:path';
import { measure as base } from '../2026-11-03-context/measure.mjs';

/** The string and template literal texts in JS source, comments skipped. Regex literals are not parsed. */
export function literals(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i < 0) break; i += 2; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < n && src[j] !== c) { if (src[j] === '\\') { s += src[j + 1]; j += 2; } else s += src[j++]; }
      out.push(s); i = j + 1; continue;
    }
    if (c === '`') {
      let j = i + 1, s = '';
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') { s += src[j + 1]; j += 2; }
        else if (src[j] === '$' && src[j + 1] === '{') {
          let depth = 1; j += 2;
          while (j < n && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
          s += ' ';
        } else s += src[j++];
      }
      out.push(s); i = j + 1; continue;
    }
    i++;
  }
  return out;
}

const words = (s) => s.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length;

export function promptInEngine(checkout) {
  const root = path.join(checkout, 'packages/engine/src');
  const byFile = {};
  let bytes = 0, count = 0;
  const walk = (d) => {
    for (const f of fs.readdirSync(d).sort()) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.js')) {
        const prose = literals(fs.readFileSync(p, 'utf8')).filter((s) => words(s) >= 5);
        const b = prose.reduce((a, s) => a + Buffer.byteLength(s), 0);
        if (b) byFile[path.relative(checkout, p)] = b;
        bytes += b; count += prose.length;
      }
    }
  };
  walk(root);
  return { bytes, literals: count, byFile };
}

export function measure(opts) {
  return { ...base(opts), promptInEngine: promptInEngine(opts.checkout) };
}
