// Opens the built observe page in Chromium with a stand-in viewer (plan item obs-page): `files` serves a local folder
// as the project's files and `db` keeps the page's rows in memory. It presses Refresh and prints what the page shows
// and the page.refresh rows it recorded, so the page's script can be checked before it is published. Usage:
//   node plugins/harness/pages/observe/test/browser-check.mjs <project files folder> [--shot <png>] [--item <id>]
// With --item it then picks that item as the scope and prints the item panel too (plan item engine-item-views).
// Needs Playwright (the cloud container has it); it is a check to run by hand, not part of npm test.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { OUT } from '../build.mjs';

const [root, ...flags] = process.argv.slice(2);
const opt = (name) => { const i = flags.indexOf(`--${name}`); return i >= 0 ? flags[i + 1] : undefined; };
const shot = opt('shot');
const item = opt('item');
if (!root) { console.error('usage: browser-check.mjs <project files folder> [--shot <png>] [--item <id>]'); process.exit(2); }
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? [{ path: relative(root, p), isDirectory: true, size: 0 }, ...walk(p)] : [{ path: relative(root, p), isDirectory: false, size: statSync(p).size }];
});
const entries = walk(root);
const contents = Object.fromEntries(entries.filter((e) => !e.isDirectory).map((e) => [e.path, readFileSync(join(root, e.path), 'utf8')]));

const stub = `window.claude = { use: async (name) => {
  const E = ${JSON.stringify(entries)}, C = ${JSON.stringify(contents)};
  window.__db ??= {};
  if (name === 'files') return Object.freeze({
    list: async ({ path = '', recursive = false } = {}) => ({ entries: E.filter((e) => path ? e.path.startsWith(path + '/') && (recursive || !e.path.slice(path.length + 1).includes('/')) : !e.path.includes('/')) }),
    read: async (p, { offset = 0 } = {}) => { const b = new TextEncoder().encode(C[p]); return { bytes: b.slice(offset), size: b.length, revision: 'r' }; },
  });
  if (name === 'db') return Object.freeze({ collection: (c) => ({
    doc: (id) => ({ set: async (d) => { (window.__db[c] ??= {})[id] = d; } }),
    orderBy: (f, dir) => ({ limit: (n) => ({ get: async () => ({ docs: Object.values(window.__db[c] ?? {}).sort((a, b) => dir === 'desc' ? b[f].localeCompare(a[f]) : a[f].localeCompare(b[f])).slice(0, n).map((d) => ({ data: () => d })) }) }) }),
  }) });
  if (name === 'user') return Object.freeze({ id: async () => 'viewer-1' });
  return null;
} };`;

const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
await page.addInitScript(stub);
await page.route('https://observe.test/', (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${readFileSync(OUT, 'utf8')}</body></html>` }));
await page.goto('https://observe.test/');
await page.waitForFunction(() => Object.keys(window.__db?.refresh ?? {}).length >= 1, null, { timeout: 10000 }).catch(async () => { console.error(errors, await page.textContent('#status')); });
await page.click('#refresh');
await page.waitForFunction(() => Object.keys(window.__db?.refresh ?? {}).length >= 2);
const shown = await page.evaluate(() => Object.fromEntries(['status', 'page-release', 'release', 'newest', 'refreshed', 'read', 'tokens-total', 'time-wall', 'refusals-count', 'refusals-rules', 'asks-cards', 'asks-sub']
  .map((id) => [id, document.getElementById(id).textContent])));
if (item) {
  await page.selectOption('#scope', `item:${item}`);
  Object.assign(shown, await page.evaluate(() => ({
    'item-panel-hidden': document.getElementById('item-panel').hidden,
    ...Object.fromEntries(['h-item', 'item-state', 'item-sub'].map((id) => [id, document.getElementById(id).textContent])),
    'item-rows': [...document.querySelectorAll('#item tbody tr')].map((tr) => [...tr.cells].map((c) => c.textContent)),
    'item-asks': [...document.querySelectorAll('#item-asks tbody tr')].map((tr) => [...tr.cells].map((c) => c.textContent)),
  })));
}
const refreshes = await page.evaluate(() => Object.values(window.__db.refresh));
if (shot) await page.screenshot({ path: shot, fullPage: true });
await browser.close();
console.log(JSON.stringify({ shown, refreshes, errors }, null, 2));
process.exit(errors.length ? 1 : 0);
