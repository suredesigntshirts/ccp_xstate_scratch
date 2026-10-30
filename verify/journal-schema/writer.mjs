// Helper process for the journal-schema verifier tests: appends N rows to one file as one writer.
// usage: node writer.mjs <file> <writer-name> <count> <release>
import { append } from '../../packages/journal/src/index.js';

const [file, name, count, release = '0.1.0'] = process.argv.slice(2);
for (let i = 0; i < Number(count); i++) {
  append(file, {
    kind: 'hook.run',
    source: { system: 'verifier', ref: `${name}-${i}` },
    session: `verify-${name}`,
    release,
    payload: { writer: name, n: i, pad: 'x'.repeat(200) },
  });
}
