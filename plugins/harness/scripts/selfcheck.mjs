// The start-of-session self-check: is this session running what the setup script should have given it? Each check
// is pure over the facts fingerprint.mjs collected, and says what is wrong in one plain sentence, so a thread knows
// at once to label its results or ask for a new thread (plan/decisions/2026-10-30-setup-script-vs-sessionstart.md).
// It only checks. It never writes settings: a session placing its own rules is what L-rules-before-session warns of.
import { DEPTH_ENV, allowRules, byVersion } from './fingerprint.mjs';

export const WANT_DEPTH = '3';

const pass = (id, detail) => ({ id, status: 'pass', detail });
const fail = (id, sentence) => ({ id, status: 'fail', detail: sentence });
const unknown = (id, sentence) => ({ id, status: 'unknown', detail: sentence });

export const CHECKS = {
  settings(f) {
    if (f.user.value) return pass('settings', '~/.claude/settings.json is present');
    return fail('settings', `~/.claude/settings.json is ${f.user.error}, so the setup script did not run in this container; start a new thread to get one that ran it.`);
  },

  rules(f) {
    if (!f.repoSettings.value) return unknown('rules', `The repo's settings at ${f.repo}/.claude/settings.json are ${f.repoSettings.error}, so the allow rules could not be compared.`);
    const want = allowRules(f.repoSettings.value);
    const have = new Set(allowRules(f.user.value));
    const missing = want.filter((r) => !have.has(r));
    if (!missing.length) return pass('rules', `all ${want.length} of the repo's allow rules are in force`);
    return fail('rules', `${missing.length} of the repo's ${want.length} allow rules are not in ~/.claude/settings.json, so auto mode may refuse what they cover; start a new thread after the setup script runs.`);
  },

  depth(f) {
    const depth = f.user.value?.env?.[DEPTH_ENV];
    if (depth === WANT_DEPTH) return pass('depth', `subagent depth is ${WANT_DEPTH}`);
    return fail('depth', `Subagent depth is ${depth ?? 'unset (1)'}, not ${WANT_DEPTH}, so subagents can't start their own subagents.`);
  },

  files(f) {
    const { checked, missing } = f.files;
    if (!missing.length) return pass('files', `all ${checked} files the plugin's hooks and skills need are present`);
    const list = missing.map((m) => `${m.file} (needed by ${m.by})`).join(', ');
    return fail('files', `The plugin at ${f.plugin.root} is missing ${list}, so part of it can't run; a new thread gets a fresh copy of the release, and if it is missing there too the release itself is broken.`);
  },

  copy(f) {
    if (f.plugin.installed && !f.pluginIsLink && !f.pluginInRepo) return pass('copy', `running the installed copy at ${f.plugin.root}`);
    return fail('copy', `The plugin runs from ${f.plugin.root}, which is not an installed release copy, so edits to the repo could change it under a running session.`);
  },

  release(f) {
    const mine = f.plugin.version;
    if (f.latest.state === 'unknown') return unknown('release', `The newest release could not be read from origin in time, so release ${mine} was not compared with it.`);
    if (f.latest.state === 'none') return unknown('release', `Origin has no harness release yet, so release ${mine} (commit ${f.plugin.commit ?? 'unknown'}) was not compared with one.`);
    // An install of a commit that is not itself a release (tag null) is behind only if it lacks the newest release.
    if (byVersion(mine, f.latest.version) < 0 && !f.plugin.tag && f.latest.contained !== false) {
      if (f.latest.contained) return pass('release', `commit ${f.plugin.commit?.slice(0, 12)} (manifest version ${mine}) already contains the newest release, ${f.latest.tag}`);
      return unknown('release', `This session runs commit ${f.plugin.commit?.slice(0, 12) ?? 'unknown'} (manifest version ${mine}), not a release, and the clone can't tell whether it contains ${f.latest.tag}.`);
    }
    if (byVersion(mine, f.latest.version) < 0) {
      return fail('release', `This session runs release ${mine} but ${f.latest.version} is out, so it runs older code; a new thread will load the newer release.`);
    }
    return pass('release', `release ${mine} is the newest (${f.latest.tag})`);
  }
};

/** Runs every check. `passed` is false when any check failed; an unknown doesn't fail the self-check. */
export function selfcheck(facts) {
  const checks = Object.values(CHECKS).map((check) => check(facts));
  return { passed: checks.every((c) => c.status !== 'fail'), checks };
}

/** The line the session sees: a pass with the release, or each failed check's sentence. */
export function summary(result, plugin) {
  const name = `${plugin.name} ${plugin.version}${plugin.tag ? ` (${plugin.tag})` : ''}`;
  const failed = result.checks.filter((c) => c.status === 'fail');
  const unsure = result.checks.filter((c) => c.status === 'unknown');
  if (!failed.length) {
    const note = unsure.length ? ` Not checked: ${unsure.map((c) => c.detail).join(' ')}` : '';
    return `${name}: self-check passed (${result.checks.length - unsure.length} of ${result.checks.length} checks).${note}`;
  }
  return `${name}: self-check FAILED. ${failed.map((c) => c.detail).join(' ')}`;
}
