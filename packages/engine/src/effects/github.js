// GitHub as the effects reach it: the REST calls behind the GitHub MCP tools, made from the host's own process.
// No shell and no gh: a cloud session reaches api.github.com only through its HTTPS proxy, and Node's fetch ignores
// HTTPS_PROXY, so this opens the proxy tunnel itself with node:http and node:tls (ledger L-graphql-blocked: REST only).
// Repo-scoped reads and writes work with the proxy's credentials; GITHUB_TOKEN is sent when set.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as tlsConnect } from 'node:tls';

/** A GitHub REST error: status, and GitHub's message. */
export class GitHubError extends Error {
  constructor(status, message, url) {
    super(`GitHub answered ${status} for ${url}: ${message}`);
    this.name = 'GitHubError';
    this.status = status;
    this.github = message;
  }
}

const proxyOf = (env, url) => {
  const raw = url.protocol === 'https:' ? env.HTTPS_PROXY ?? env.https_proxy : env.HTTP_PROXY ?? env.http_proxy;
  if (!raw) return null;
  const skip = String(env.NO_PROXY ?? env.no_proxy ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  if (skip.some((h) => h === url.hostname || (h.startsWith('.') && url.hostname.endsWith(h)))) return null;
  return new URL(raw);
};

// One HTTPS request, through a CONNECT tunnel when a proxy is set. Resolves { status, body }.
function send(url, { method, headers, body }, env) {
  return new Promise((resolve, reject) => {
    const finish = (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    };
    const options = { method, headers, hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search };
    const proxy = url.protocol === 'https:' ? proxyOf(env, url) : null;
    const go = (extra = {}) => {
      const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)({ ...options, ...extra }, finish);
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    };
    if (!proxy) return go();
    const auth = proxy.username ? { 'proxy-authorization': `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}` } : {};
    const target = `${url.hostname}:${url.port || 443}`;
    const tunnel = httpRequest({ hostname: proxy.hostname, port: proxy.port || 80, method: 'CONNECT', path: target, headers: { host: target, ...auth } });
    tunnel.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(new Error(`the proxy refused the tunnel to ${target}: ${res.statusCode}`));
      }
      go({ createConnection: () => tlsConnect({ socket, servername: url.hostname }) });
    });
    tunnel.on('error', reject);
    tunnel.end();
  });
}

/**
 * A GitHub REST client: { pull, merge }, each taking the GitHub MCP tool's own arguments. `api` points it at
 * another server (tests); `env` is where the proxy and token are read.
 */
export function github({ api = 'https://api.github.com', env = process.env } = {}) {
  const call = async (method, path, payload) => {
    const url = new URL(path, api);
    const headers = { accept: 'application/vnd.github+json', 'user-agent': 'ccp-engine-effects', 'x-github-api-version': '2022-11-28' };
    if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
    const body = payload === undefined ? null : JSON.stringify(payload);
    if (body) headers['content-type'] = 'application/json';
    const res = await send(url, { method, headers, body }, env);
    let json = null;
    try {
      json = res.body ? JSON.parse(res.body) : null;
    } catch {
      json = { message: res.body.slice(0, 200) };
    }
    if (res.status < 200 || res.status > 299) throw new GitHubError(res.status, json?.message ?? 'no message', url.href);
    return json;
  };
  const at = ({ owner, repo, pullNumber }) => `/repos/${owner}/${repo}/pulls/${pullNumber}`;
  return {
    /** pull_request_read: the PR as GitHub has it now. */
    pull: (args) => call('GET', at(args)),
    /** merge_pull_request: expectedHeadSha is REST's sha, so GitHub refuses the merge when the head moved. */
    merge: ({ expectedHeadSha, merge_method = 'merge', commit_title, commit_message, ...args }) =>
      call('PUT', `${at(args)}/merge`, { sha: expectedHeadSha, merge_method, commit_title, commit_message })
  };
}
