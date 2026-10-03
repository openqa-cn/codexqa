import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURE_DIR, SKILL_DIR } from './helpers.mjs';

const WIKI = join(SKILL_DIR, 'scripts', 'wiki.mjs');

// A stand-in `codexqa` that replays the fixture export and logs its arguments.
function fakeCli(dir, { failInputs = false } = {}) {
  const bin = join(dir, 'codexqa');
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(dir, 'calls.log'))}, args.join(' ') + '\\n');
if (args[0] === '--version') { console.log('codexqa 9.9.9'); process.exit(0); }
if (args[0] === 'index') { process.exit(0); }
if (args[0] === 'wiki') {
  if (${failInputs}) { console.error('resolve db: not found'); process.exit(1); }
  process.stdout.write(fs.readFileSync(${JSON.stringify(join(FIXTURE_DIR, 'inputs.json'))}, 'utf8'));
  process.exit(0);
}
if (args[0] === 'stats') { console.log(JSON.stringify({ local_nodes: 4000, nodes_total: 4400, stubs: { total: 400 }, collisions: { groups: 0 } })); process.exit(0); }
process.exit(3);
`);
  chmodSync(bin, 0o755);
  return bin;
}

function run(args, { cwd, bin } = {}) {
  const r = spawnSync(process.execPath, [WIKI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CODEXQA_BIN: bin || join(cwd, 'missing-codexqa') },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wiki-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('usage errors exit 2', (t) => {
  const cwd = sandbox(t);
  assert.equal(run([], { cwd }).code, 2);
  assert.equal(run(['--help'], { cwd }).code, 0);
  assert.equal(run(['explode', '.'], { cwd }).code, 2);
  const typo = run(['build', '.', '--drat'], { cwd });
  assert.equal(typo.code, 2);
  assert.match(typo.err, /unknown option --drat/);
  assert.match(run(['build', '.', '--out', '--draft'], { cwd }).err, /--out needs a value/);
  assert.match(run(['check', '.', '--draft'], { cwd }).err, /unknown option --draft/);
  assert.match(run(['brief', '.', '--lang', 'fr'], { cwd }).err, /--lang must be zh or en/);
  assert.match(run(['brief', '.', '--limit', '2.5', '--inputs', 'x'], { cwd }).err, /--limit must be a positive whole number/);
  assert.match(run(['build', '.', '--out'], { cwd }).err, /--out needs a value/);
  assert.match(run(['build', '.', '--source-url', 'javascript:alert(1)//{path}'], { cwd }).err, /--source-url must be an http\(s\) URL/);
  const missing = run(['build', '.'], { cwd });
  assert.equal(missing.code, 2);
  assert.match(missing.err, /inputs\.json not found .* Run `brief` first/);
});

test('missing codexqa binary gives the install command', (t) => {
  const cwd = sandbox(t);
  const r = run(['brief', cwd], { cwd });
  assert.equal(r.code, 2);
  assert.match(r.err, /not found\. Install it with: npm install -g @openqa-cn\/codexqa/);
});

test('brief → check → build with a fake codexqa', (t) => {
  const cwd = sandbox(t);
  const bin = fakeCli(cwd);
  const b = run(['brief', cwd, '--dir', 'w'], { cwd, bin });
  assert.equal(b.code, 0, b.err);
  assert.match(b.out, /12 modules · 4 groups that call each other · 1 standalone/);
  assert.match(b.out, /suggested path/);
  assert.match(b.out, /### P02 /);
  assert.doesNotMatch(b.out, /undefined|NaN/);
  for (const f of ['inputs.json', 'meta.json', 'notes.json', 'brief.md']) assert.ok(existsSync(join(cwd, 'w', f)), f);
  const calls = readFileSync(join(cwd, 'calls.log'), 'utf8');
  assert.match(calls, /^index /m);
  assert.match(calls, /^wiki inputs /m);
  const saved = JSON.parse(readFileSync(join(cwd, 'w', 'inputs.json'), 'utf8'));
  assert.ok(saved.inputs.every((r) => !('system' in r) && !('user' in r)));
  const meta = JSON.parse(readFileSync(join(cwd, 'w', 'meta.json'), 'utf8'));
  assert.equal(meta.cliVersion, 'codexqa 9.9.9');
  assert.equal(meta.localNodes, 4000);

  // Empty notes: strict build refuses, draft builds.
  const strict = run(['build', cwd, '--dir', 'w', '--out', 'a.html'], { cwd });
  assert.equal(strict.code, 1);
  assert.match(strict.err, /fields in notes\.json are not written yet/);
  assert.match(strict.err, /add --draft/);
  assert.ok(!existsSync(join(cwd, 'a.html')));
  assert.equal(run(['check', cwd, '--dir', 'w'], { cwd }).code, 1);
  const draft = run(['build', cwd, '--dir', 'w', '--draft', '--out', 'draft.html'], { cwd });
  assert.equal(draft.code, 0, draft.err);
  assert.match(readFileSync(join(cwd, 'draft.html'), 'utf8'), /class="banner draft"/);

  // Written notes: check and final build pass.
  writeFileSync(join(cwd, 'w', 'notes.json'), readFileSync(join(FIXTURE_DIR, 'notes.json')));
  const ok = run(['check', cwd, '--dir', 'w'], { cwd });
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /notes\.json OK/);
  const final = run(['build', cwd, '--dir', 'w', '--out', 'out/final.html', '--source-url', 'https://code.example.com/r/blob/{commit}/{path}'], { cwd });
  assert.equal(final.code, 0, final.err);
  const html = readFileSync(join(cwd, 'out', 'final.html'), 'utf8');
  assert.doesNotMatch(html, /class="banner draft"/);
  assert.doesNotMatch(final.err, /renderer bug/);

  // Rerunning brief keeps written notes and reports nothing stale.
  const again = run(['brief', cwd, '--dir', 'w', '--skip-index'], { cwd, bin });
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /Notes file \(kept\)/);
  assert.doesNotMatch(again.out, /needs update/);
  assert.equal((readFileSync(join(cwd, 'calls.log'), 'utf8').match(/^index /gm) || []).length, 1, '--skip-index skips indexing');
});

test('wrong facts in notes block the build and name the field', (t) => {
  const cwd = sandbox(t);
  const bin = fakeCli(cwd);
  assert.equal(run(['brief', cwd, '--dir', 'w'], { cwd, bin }).code, 0);
  const notes = JSON.parse(readFileSync(join(FIXTURE_DIR, 'notes.json'), 'utf8'));
  notes.guides[0].steps = [{ module: 'P03', note: 'a' }, { module: 'P08', note: 'b' }];
  notes.modules.P99 = { name: 'x', role: 'y' };
  writeFileSync(join(cwd, 'w', 'notes.json'), JSON.stringify(notes));
  const r = run(['build', cwd, '--dir', 'w', '--draft', '--out', 'x.html'], { cwd });
  assert.equal(r.code, 1);
  assert.match(r.err, /modules\.P99: no such module/);
  assert.match(r.err, /P03 and P08 do not call each other/);
  assert.ok(!existsSync(join(cwd, 'x.html')), 'errors block even draft builds');
});

test('a failing export explains the missing index', (t) => {
  const cwd = sandbox(t);
  const bin = fakeCli(cwd, { failInputs: true });
  const r = run(['brief', cwd, '--dir', 'w', '--skip-index'], { cwd, bin });
  assert.equal(r.code, 1);
  assert.match(r.err, /no index yet\. Drop --skip-index/);
});

test('--inputs reads a saved export without calling codexqa', (t) => {
  const cwd = sandbox(t);
  const inputs = join(FIXTURE_DIR, 'inputs.json');
  const r = run(['brief', cwd, '--dir', 'w', '--inputs', inputs, '--lang', 'en'], { cwd });
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(readFileSync(join(cwd, 'w', 'notes.json'), 'utf8')).lang, 'en');
  const meta = JSON.parse(readFileSync(join(cwd, 'w', 'meta.json'), 'utf8'));
  assert.deepEqual(meta.commands, [], 'no command is recorded that did not run');
  assert.match(r.out, new RegExp(`Build: node \\S+ build \\S+ --dir w`));
  const again = run(['brief', cwd, '--dir', 'w', '--inputs', inputs, '--lang', 'zh'], { cwd });
  assert.match(again.out, /--lang zh ignored: notes\.json is "en"/);
  assert.match(run(['brief', cwd, '--dir', 'w', '--inputs', inputs, '--limit', '4'], { cwd }).err, /--limit has no effect with --inputs/);
});

test('tokens in a remote URL never reach files, names, or the page', (t) => {
  const cwd = sandbox(t);
  const bin = fakeCli(cwd);
  const url = 'https://user:ghp_SECRET@github.com/org/myrepo.git';
  const b = run(['brief', url], { cwd, bin });
  assert.equal(b.code, 0, b.err);
  assert.ok(existsSync(join(cwd, '.codexqa-wiki', 'myrepo', 'meta.json')), 'work dir is named after the repo');
  const out = run(['build', url, '--draft', '--out', 'x.html'], { cwd });
  assert.equal(out.code, 0, out.err);
  for (const f of ['.codexqa-wiki/myrepo/meta.json', '.codexqa-wiki/myrepo/brief.md', 'x.html']) {
    assert.doesNotMatch(readFileSync(join(cwd, f), 'utf8'), /ghp_SECRET|user:/, f);
  }
  assert.doesNotMatch(b.out + b.err + out.out + out.err, /ghp_SECRET/);
  assert.match(readFileSync(join(cwd, 'calls.log'), 'utf8'), /ghp_SECRET/, 'codexqa itself still gets the real URL');
});

test('option values may contain "=", and work dirs are not shared by accident', (t) => {
  const cwd = sandbox(t);
  const bin = fakeCli(cwd);
  assert.equal(run(['brief', cwd, '--dir', 'w'], { cwd, bin }).code, 0);
  // Not a git checkout: a template without {commit} still links, one with {commit} cannot.
  const r = run(['build', cwd, '--dir', 'w', '--draft', '--out', 'x.html', '--source-url=https://h.example/r/{path}?a=b=c'], { cwd });
  assert.equal(r.code, 0, r.err);
  assert.match(readFileSync(join(cwd, 'x.html'), 'utf8'), /href="https:\/\/h\.example\/r\/[^"]+\?a=b=c"/);
  run(['build', cwd, '--dir', 'w', '--draft', '--out', 'y.html', '--source-url=https://h.example/{commit}/{path}'], { cwd });
  assert.doesNotMatch(readFileSync(join(cwd, 'y.html'), 'utf8'), /href="https:\/\/h\.example/);

  const other = mkdtempSync(join(tmpdir(), 'wiki-other-'));
  t.after(() => rmSync(other, { recursive: true, force: true }));
  const clash = run(['brief', other, '--dir', 'w'], { cwd, bin });
  assert.equal(clash.code, 2);
  assert.match(clash.err, /already holds the wiki of .* Pass --dir/);
  assert.match(run(['build', other, '--dir', 'w', '--draft'], { cwd }).err, /holds the wiki of .* not /);
});

test('check does not suggest a flag it rejects; typos in paths are caught', (t) => {
  const cwd = sandbox(t);
  assert.equal(run(['brief', cwd, '--dir', 'w', '--inputs', join(FIXTURE_DIR, 'inputs.json')], { cwd }).code, 0);
  const r = run(['check', cwd, '--dir', 'w'], { cwd });
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.err, /add --draft/);
  const typo = run(['brief', './no-such-folder'], { cwd });
  assert.equal(typo.code, 2);
  assert.match(typo.err, /no such folder: \.\/no-such-folder/);
});
