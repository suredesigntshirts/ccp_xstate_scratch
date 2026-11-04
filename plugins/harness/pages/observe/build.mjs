#!/usr/bin/env node
// Builds the observe page (plan item obs-page): page.html with the data layer and the derived views it uses inlined as
// one script, so the published page runs the same code the tests run. Usage:
//   node plugins/harness/pages/observe/build.mjs [--release x.y.z] [--out <file>]
// It writes observe.html beside this file unless --out says otherwise. --release stamps the page's own release, shown
// on the page and in its page.refresh rows; it defaults to the release the committed observe.html carries.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DERIVE = join(HERE, '..', '..', '..', '..', 'packages', 'journal', 'src', 'derive');
export const OUT = join(HERE, 'observe.html');

// The modules the page needs, in dependency order. Each runs in its own scope with its imports dropped, and hands its
// exports to the ones after it by name; attention.js's readAll import is only used by attentionOf, which the page never calls.
const MODULES = [join(DERIVE, 'time.js'), join(DERIVE, 'attention.js'), join(HERE, 'data.js')];
const EXPOSED = ['parseJournal', 'scopes', 'inScope', 'items', 'itemView', 'lastFinishes', 'tokensByAgent', 'timeByKind', 'refusals', 'asks', 'freshness', 'observe', 'refreshRow'];

const EXPORT = /^export (?:const|function|class|async function) (\w+)/gm;
const wrap = (src) => {
  const names = [...src.matchAll(EXPORT)].map((m) => m[1]);
  const body = src.replace(/^import [\s\S]*? from '[^']+';\n/gm, '').replace(/^export (const|function|class|async function) /gm, '$1 ');
  return `const { ${names.join(', ')} } = (() => {\n${body}\nreturn { ${names.join(', ')} };\n})();`;
};

/** The built page's text for `release`. */
export function build(release) {
  if (!/^\d+\.\d+\.\d+$/.test(release)) throw new Error(`build: release must be x.y.z, not ${release}`);
  const body = MODULES.map((p) => `// ${p.slice(join(HERE, '..', '..', '..', '..').length + 1)}\n${wrap(readFileSync(p, 'utf8'))}`).join('\n');
  const script = `<script>\n// Built by plugins/harness/pages/observe/build.mjs; edit the sources, not this script.\nwindow.ObserveData = (() => {\n${body}\nconst PAGE_RELEASE = ${JSON.stringify(release)};\nreturn Object.freeze({ PAGE_RELEASE, ${EXPOSED.join(', ')} });\n})();\n</script>`;
  const page = readFileSync(join(HERE, 'page.html'), 'utf8');
  if (!page.includes('<!--DATA-->')) throw new Error('build: page.html has no <!--DATA--> marker');
  return page.replace('<!--DATA-->', () => script);
}

/** The release a built page carries, or null. */
export const releaseOf = (html) => html.match(/const PAGE_RELEASE = "(\d+\.\d+\.\d+)";/)?.[1] ?? null;

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const release = opt('release') ?? (existsSync(OUT) ? releaseOf(readFileSync(OUT, 'utf8')) : null);
  if (!release) { console.error('build: no --release given and no built page to take one from'); process.exit(2); }
  const out = opt('out') ?? OUT;
  writeFileSync(out, build(release));
  console.log(`${out} (release ${release})`);
}
