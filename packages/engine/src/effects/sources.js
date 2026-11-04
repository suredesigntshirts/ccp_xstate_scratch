// Tourney lane E (option B part, research): the source check, the run of a workflow's `checkSources` actor. The host
// fetches every URL the report cites (fetch(url) -> { status, body }) and records each one's status and content hash,
// which catches an invented source. The output is the host's: { ok, report, checked }.
import { createHash } from 'node:crypto';

export const sources = ({ fetch }) => ({
  async start(effect) {
    const urls = Array.isArray(effect.input?.urls) ? effect.input.urls : [];
    const checked = [];
    for (const url of urls) {
      let got;
      try {
        got = await fetch(url);
      } catch (error) {
        got = { status: 0, body: '' };
      }
      checked.push({ url, status: got.status, hash: createHash('sha256').update(String(got.body ?? '')).digest('hex') });
    }
    const ok = urls.length > 0 && checked.every((c) => c.status === 200);
    return { ref: `checked ${checked.length}`, output: { ok, report: effect.input?.report ?? null, checked: checked.length, failed: checked.filter((c) => c.status !== 200).map((c) => c.url).join(',') || null } };
  }
});
