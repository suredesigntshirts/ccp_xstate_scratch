#!/usr/bin/env node
// Installs the harness in this project: creates the journal root (<harness dir>/journal/sessions) and writes the
// install marker (<harness dir>/install.json). Run by the install skill when the person asks. Until the marker
// exists, every hook in the plugin does nothing. Running it again changes nothing and says so.
// Prints one line; exits 1 only when the marker could not be written.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gate, harnessDir, journalDir, markerPath, release, sessionName } from './host.mjs';

const marker = markerPath();
if ((await gate(process.env, 5000)) === 'installed') {
  console.log(`ccp-harness is already installed in this project (${marker}); nothing changed.`);
  process.exit(0);
}
try {
  const { name, version, tag, commit } = release();
  mkdirSync(join(journalDir(), 'sessions'), { recursive: true });
  const body = {
    installed_at: new Date().toISOString(),
    session: sessionName(),
    release: { name, version, tag, commit },
    journal: journalDir()
  };
  writeFileSync(marker, `${JSON.stringify(body, null, 2)}\n`, { flag: 'wx' });
  console.log(`ccp-harness ${version} installed in this project: marker ${marker}, journal ${journalDir()}. It takes effect from the next session.`);
} catch (error) {
  console.log(`ccp-harness was not installed: ${error.message} (harness folder ${harnessDir()}).`);
  process.exit(1);
}
