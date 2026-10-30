// The journal: append-only JSONL files, one writer per file, every row carrying its format version (v) and the
// release that wrote it. append() is the hot path and touches one known file; readAll() lists folders and is for
// offline tools only. See docs/journal.md.
import nodeFs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { check } from './validate.js';
import { KINDS } from './kinds.js';

export { KINDS };

export const VERSION = 1;

// One appended line must reach the file in a single write, so its size is capped.
export const MAX_LINE_BYTES = 1024 * 1024;

const TAIL_BYTES = 64 * 1024;

export const schema = JSON.parse(nodeFs.readFileSync(new URL('../schema/row.schema.json', import.meta.url), 'utf8'));

// Upcasters turn a row of version n into version n + 1, keyed by n. There are none until the first version bump.
export const UPCASTERS = Object.freeze({});

export class JournalError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'JournalError';
    Object.assign(this, details);
  }
}

export class OlderWriterError extends JournalError {
  constructor(writer, newest, path) {
    super(`refused: this writer's release ${writer} is older than release ${newest}, which already wrote to ${path}`,
      { writer, newest, path });
    this.name = 'OlderWriterError';
  }
}

export function validate(row) {
  return check(schema, row);
}

// Compares two x.y.z releases: negative when a is older than b, zero when equal, positive when newer.
export function compareReleases(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// Appends one row to the file at path, creating the file but not its folder. It stamps v, and id and at when they
// are missing, refuses an invalid row or an unknown kind, and refuses a writer older than the file's newest row.
// It opens only this one file and lists no folder.
export function append(path, row, { fs = nodeFs } = {}) {
  if (row.v !== undefined && row.v !== VERSION) {
    throw new JournalError(`refused: this writer writes v${VERSION} rows, not v${row.v}`, { path });
  }
  const full = { v: VERSION, id: row.id ?? randomUUID(), at: row.at ?? new Date().toISOString(), ...row };
  const errors = validate(full);
  if (errors.length) throw new JournalError(`refused an invalid row: ${errors.join('; ')}`, { errors, path });
  if (!KINDS.includes(full.kind)) {
    throw new JournalError(`refused: unknown kind ${full.kind}; add it to KINDS and docs/journal.md first`, { path });
  }
  const line = Buffer.from(`${JSON.stringify(full)}\n`);
  if (line.length > MAX_LINE_BYTES) {
    throw new JournalError(`refused: the row is ${line.length} bytes, over the ${MAX_LINE_BYTES} byte limit`, { path });
  }
  const fd = fs.openSync(path, 'a+');
  try {
    const newest = lastRelease(fs, fd);
    if (newest && compareReleases(full.release, newest) < 0) throw new OlderWriterError(full.release, newest, path);
    const written = fs.writeSync(fd, line);
    if (written !== line.length) {
      throw new JournalError(`wrote ${written} of ${line.length} bytes to ${path}; the line is torn`, { path });
    }
  } finally {
    fs.closeSync(fd);
  }
  return full;
}

// The release of the last complete row in an open file, read from its tail, or null for an empty file. Older
// writers are refused, so the last row carries the newest release.
function lastRelease(fs, fd) {
  const size = fs.fstatSync(fd).size;
  let want = TAIL_BYTES;
  while (size > 0) {
    const length = Math.min(size, want);
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, size - length);
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim());
    const complete = length === size ? lines : lines.slice(1);
    for (let i = complete.length - 1; i >= 0; i--) {
      try {
        const release = JSON.parse(complete[i]).release;
        if (typeof release === 'string') return release;
      } catch {
        // A torn or foreign line: look at the one before it.
      }
    }
    if (length === size) return null;
    want *= 4;
  }
  return null;
}

// Brings a row up to the reader's version with the upcasters, without touching the file it came from.
export function upcast(row, { version = VERSION, upcasters = UPCASTERS } = {}) {
  let current = row;
  while (current.v < version) {
    const step = upcasters[current.v];
    if (!step) throw new JournalError(`no upcaster from v${current.v} to v${current.v + 1}`);
    current = { ...step(current), v: current.v + 1 };
  }
  return current;
}

// Reads one known file. Returns its rows, upcast and in time order, and the lines it could not use with the reason,
// so a torn line or a row from a newer format is counted, never dropped silently. It never writes.
export function readFile(path, { fs = nodeFs, version = VERSION, upcasters = UPCASTERS } = {}) {
  const rows = [];
  const bad = [];
  const lines = fs.readFileSync(path, 'utf8').split('\n');
  lines.forEach((text, index) => {
    if (!text.trim()) return;
    const line = index + 1;
    let row;
    try {
      row = JSON.parse(text);
    } catch {
      bad.push({ path, line, reason: 'not JSON (a torn or partial line)' });
      return;
    }
    if (!Number.isInteger(row?.v)) {
      bad.push({ path, line, reason: 'no version (v)' });
      return;
    }
    if (row.v > version) {
      bad.push({ path, line, reason: `row is v${row.v}, newer than this reader's v${version}` });
      return;
    }
    try {
      row = upcast(row, { version, upcasters });
    } catch (error) {
      bad.push({ path, line, reason: error.message });
      return;
    }
    const errors = validate(row);
    if (errors.length) {
      bad.push({ path, line, reason: errors.join('; ') });
      return;
    }
    rows.push(row);
  });
  return { rows: byTime(rows), bad };
}

// Reads every .jsonl file under root and merges their rows in time order. It lists folders, so it is for offline
// tools only, never a hook or any other hot path (ledger L-library-mount-slow).
export function readAll(root, options = {}) {
  const fs = options.fs ?? nodeFs;
  const files = fs.readdirSync(root, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .map((name) => join(root, name));
  const rows = [];
  const bad = [];
  for (const file of files) {
    const result = readFile(file, options);
    rows.push(...result.rows);
    bad.push(...result.bad);
  }
  return { files, rows: byTime(rows), bad };
}

// A stable sort by at, so rows written in the same millisecond keep their file order.
function byTime(rows) {
  return rows.toSorted((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
