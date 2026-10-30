Probes that need a red CI run add a file such as `test/red.test.js` containing
`import { test } from 'node:test'; test('red on purpose', () => { throw new Error('red on purpose'); });`
in their PR, and remove it to go green again.
