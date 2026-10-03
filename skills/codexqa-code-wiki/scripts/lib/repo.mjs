import { execFileSync } from 'node:child_process';
import { existsSync, statSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';

const SOURCE_EXT = ['.py', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.mts', '.cts', '.go', '.java', '.kt', '.rs',
  '.rb', '.php', '.cs', '.swift', '.scala', '.vue', '.c', '.h', '.cc', '.cpp', '.hpp', '.m', '.dart', '.lua', '.sh'];

function git(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export function isLocalPath(repo) {
  return Boolean(repo) && existsSync(repo) && statSync(repo).isDirectory();
}

// `./x`, `../x`, `/x`, `~/x`, `C:\\x`: meant as a folder on disk, never a repo id.
export function looksLikePath(repo) {
  return /^(\.{1,2}([\\/]|$)|[\\/]|~|[A-Za-z]:[\\/])/.test(String(repo || ''));
}

// Tokens in clone URLs (`https://user:token@host/…`) never reach files or pages.
export function redact(text) {
  return String(text ?? '').replace(/([a-z][\w+.-]*:\/\/)[^@\/\s]+@/gi, '$1');
}

export function gitInfo(dir) {
  const info = { name: basename(realpathSync(dir)), path: realpathSync(dir) };
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  if (!top) return info;
  info.gitRoot = top;
  info.subdir = realpathSync(top) !== info.path;
  info.commit = git(dir, ['rev-parse', 'HEAD']) || undefined;
  const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  info.branch = branch && branch !== 'HEAD' ? branch : undefined;
  info.commitDate = git(dir, ['log', '-1', '--format=%cI']) || undefined;
  // The skill's own output (work dir, built pages) does not make a checkout dirty.
  info.dirty = git(dir, ['status', '--porcelain']).split('\n')
    .map((line) => line.slice(3).replace(/^"|"$/g, ''))
    .some((path) => path && !/(^|\/)\.codexqa-wiki(\/|$)/.test(path) && !/(^|\/)codexqa-code-wiki-[^/]*\.html$/.test(path));
  const remote = git(dir, ['remote', 'get-url', 'origin']);
  if (remote) info.remote = redact(remote);
  return info;
}

// Only hosts whose blob URL shape is certain get links; anything else needs --source-url.
export function webLinks(remote) {
  if (!remote) return null;
  let host;
  let path;
  let m = /^[\w.-]+@([^:/]+):(.+)$/.exec(remote);
  if (m) [, host, path] = m;
  else {
    m = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/.exec(remote);
    if (!m) return null;
    [, host, path] = m;
  }
  path = path.replace(/\.git$/, '').replace(/\/+$/, '');
  const base = `https://${host}/${path}`;
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  if (host === 'github.com' || host === 'gitee.com') {
    return { file: (ref, p) => `${base}/blob/${ref}/${enc(p)}`, commit: (sha) => `${base}/commit/${sha}` };
  }
  if (/(^|\.)gitlab\./.test(host) || host === 'gitlab.com') {
    return { file: (ref, p) => `${base}/-/blob/${ref}/${enc(p)}`, commit: (sha) => `${base}/-/commit/${sha}` };
  }
  if (host === 'bitbucket.org') {
    return { file: (ref, p) => `${base}/src/${ref}/${enc(p)}`, commit: (sha) => `${base}/commits/${sha}` };
  }
  return null;
}

export function templateLinks(template) {
  if (!template || !template.includes('{path}')) return null;
  return {
    file: (ref, p) => template.split('{commit}').join(encodeURIComponent(ref || '')).split('{path}').join(p.split('/').map(encodeURIComponent).join('/')),
    commit: null,
    needsRef: template.includes('{commit}'),
  };
}

// The index lists some files without their extension (Python modules); find the real file.
export function fileResolver(dir, prefix = '') {
  const cache = new Map();
  return (raw) => {
    if (!dir) return raw;
    if (cache.has(raw)) return cache.get(raw);
    let found = raw;
    const abs = join(dir, prefix, raw);
    const isFile = (p) => existsSync(p) && statSync(p).isFile();
    if (!isFile(abs)) {
      const ext = SOURCE_EXT.find((e) => isFile(abs + e));
      if (ext) found = raw + ext;
    }
    cache.set(raw, found);
    return found;
  };
}

export function slugOf(repo) {
  let base;
  if (isLocalPath(repo)) base = basename(realpathSync(repo));
  else {
    // github.com/org/name@branch, https://host/org/name.git, git@host:org/name.git
    const clean = redact(repo).replace(/^[\w.-]+@([^:/]+):/, '$1/').replace(/@[^/@]*$/, '');
    base = clean.replace(/\.git$/, '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  }
  return (base || 'repo').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'repo';
}
