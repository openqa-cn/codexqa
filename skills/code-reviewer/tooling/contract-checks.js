#!/usr/bin/env node
/**
 * Offline CLI contract checks for the compiled tooling/*.js entrypoints.
 * Does not call the network. Run from tooling/: npm test
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
const TOOLING = dirname(fileURLToPath(import.meta.url));
const INTEGRATION_NAMES = ['prMetadata', 'notify', 'telemetry', 'extraKnowledge'];
function isolatedEnv(extra = {}) {
    const env = { ...process.env };
    delete env.CODE_REVIEWER_CONFIG;
    delete env.CODE_REVIEWER_TOKEN;
    delete env.CODE_REVIEWER_USER;
    delete env.CODE_REVIEWER_PASSWORD;
    return { ...env, ...extra };
}
function makeWorkspace() {
    return mkdtempSync(join(tmpdir(), 'code-reviewer-contract-'));
}
function run(script, args, cwd, env = isolatedEnv()) {
    return spawnSync(process.execPath, [join(TOOLING, script), ...args], {
        encoding: 'utf-8',
        cwd,
        env,
    });
}
function lastJsonLine(stdout) {
    const lines = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const last = lines.at(-1);
    assert.ok(last, `expected JSON on stdout, got: ${stdout}`);
    return JSON.parse(last);
}
test('load-config prints built-in defaults when no project file exists', () => {
    const cwd = makeWorkspace();
    try {
        const result = run('load-config.js', [], cwd);
        assert.equal(result.status, 0, result.stderr);
        const loaded = JSON.parse(result.stdout);
        assert.equal(loaded.source, '(built-in defaults)');
        assert.deepEqual(loaded.sources, []);
        assert.equal(loaded.config.version, 1);
        assert.equal(loaded.config.git.defaultBaseBranch, 'main');
        assert.equal(loaded.config.git.codeBrowseUrlTemplate, '');
        assert.deepEqual(loaded.config.layers.ui, ['src/pages/', 'src/components/']);
        assert.deepEqual(loaded.config.layers.store, ['src/stores/']);
        assert.deepEqual(loaded.config.layers.api, ['src/api/']);
        assert.deepEqual(loaded.config.layers.backend, [
            'src/main/java/',
            'src/main/kotlin/',
            'src/main/resources/',
        ]);
        assert.deepEqual(loaded.config.layers.exclude, [
            '**/*.test.*',
            '**/*.spec.*',
            '**/*.stories.*',
            '**/__mocks__/**',
            '**/__MACOSX/**',
            '**/.DS_Store',
            '**/._*',
        ]);
        assert.equal(loaded.config.conventions.stateLibrary, '');
        assert.equal(loaded.config.conventions.backendLanguage, '');
        assert.deepEqual(loaded.config.conventions.generatedMarkers, [
            '@generated',
            'This file is auto-generated',
            'Code generated',
        ]);
        for (const name of INTEGRATION_NAMES) {
            assert.equal(loaded.config.integrations[name]?.enabled, false);
            assert.equal(loaded.config.integrations[name]?.url, '');
        }
    }
    finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});
test('invoke-integration skips a disabled extraKnowledge endpoint', () => {
    const cwd = makeWorkspace();
    try {
        const result = run('invoke-integration.js', ['extraKnowledge', '--repo', 'demo'], cwd);
        assert.equal(result.status, 0, result.stderr);
        const body = lastJsonLine(result.stdout);
        assert.equal(body.ok, true);
        assert.equal(body.skipped, true);
        assert.equal(body.reason, 'integrations.extraKnowledge is disabled or has no url');
        assert.equal(body.source, '(built-in defaults)');
    }
    finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});
test('invoke-integration skips when bearer token env is missing', () => {
    const cwd = makeWorkspace();
    const configPath = join(cwd, 'enabled-pr.json');
    writeFileSync(configPath, JSON.stringify({
        version: 1,
        integrations: {
            prMetadata: {
                enabled: true,
                method: 'GET',
                url: 'https://example.com/pr/{repo}',
                auth: { type: 'bearer', tokenEnv: 'CODE_REVIEWER_TOKEN', required: true },
            },
        },
    }));
    try {
        const result = run('invoke-integration.js', ['prMetadata', '--repo', 'demo'], cwd, isolatedEnv({
            CODE_REVIEWER_CONFIG: configPath,
        }));
        assert.equal(result.status, 0, result.stderr);
        const body = lastJsonLine(result.stdout);
        assert.equal(body.ok, true);
        assert.equal(body.skipped, true);
        assert.equal(body.reason, 'auth required but CODE_REVIEWER_TOKEN is empty');
        assert.equal(body.name, 'prMetadata');
        assert.equal(body.source, configPath);
    }
    finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});
test('review-progress state machine: init, phases, counts, note, cleanup', () => {
    const cwd = makeWorkspace();
    const progressPath = join(cwd, '.review-progress.json');
    try {
        const init = run('review-progress.js', ['init', '--mode', 'grouped', '--base', 'main'], cwd);
        assert.equal(init.status, 0, init.stderr);
        assert.match(init.stdout, /Created review progress file/);
        assert.equal(existsSync(progressPath), true);
        let data = JSON.parse(readFileSync(progressPath, 'utf-8'));
        assert.equal(data.mode, 'grouped');
        assert.equal(data.base, 'main');
        assert.deepEqual(data.phases, []);
        assert.deepEqual(data.findings_so_far, { p0: 0, p1: 0, p2: 0 });
        const start = run('review-progress.js', ['phase-start', 'load_knowledge'], cwd);
        assert.equal(start.status, 0, start.stderr);
        data = JSON.parse(readFileSync(progressPath, 'utf-8'));
        assert.equal(data.phases[0]?.name, 'load_knowledge');
        assert.equal(data.phases[0]?.status, 'in_progress');
        const done = run('review-progress.js', ['phase-done', 'load_knowledge', '--findings', 'group-1.json'], cwd);
        assert.equal(done.status, 0, done.stderr);
        data = JSON.parse(readFileSync(progressPath, 'utf-8'));
        assert.equal(data.phases[0]?.status, 'done');
        assert.equal(data.phases[0]?.findings_file, 'group-1.json');
        const skipStart = run('review-progress.js', ['phase-start', 'load_knowledge'], cwd);
        assert.equal(skipStart.status, 0, skipStart.stderr);
        assert.match(skipStart.stdout, /already done, skip start/);
        const fail = run('review-progress.js', ['phase-fail', 'verify', '--reason', 'timeout'], cwd);
        assert.equal(fail.status, 0, fail.stderr);
        data = JSON.parse(readFileSync(progressPath, 'utf-8'));
        const verify = data.phases.find((phase) => phase.name === 'verify');
        assert.equal(verify?.status, 'failed');
        assert.equal(verify?.error, 'timeout');
        const counts = run('review-progress.js', ['update-counts', '--p0', '1', '--p1', '2', '--p2', '3'], cwd);
        assert.equal(counts.status, 0, counts.stderr);
        const note = run('review-progress.js', ['note', 'checkpoint'], cwd);
        assert.equal(note.status, 0, note.stderr);
        data = JSON.parse(readFileSync(progressPath, 'utf-8'));
        assert.deepEqual(data.findings_so_far, { p0: 1, p1: 2, p2: 3 });
        assert.equal(data.notes.at(-1)?.text, 'checkpoint');
        const stat = run('review-progress.js', ['stat'], cwd);
        assert.equal(stat.status, 0, stat.stderr);
        assert.match(stat.stdout, /grouped/);
        assert.match(stat.stdout, /P0=1/);
        const cleanup = run('review-progress.js', ['cleanup'], cwd);
        assert.equal(cleanup.status, 0, cleanup.stderr);
        assert.equal(existsSync(progressPath), false);
        const missing = run('review-progress.js', ['phase-start', 'load_knowledge'], cwd);
        assert.equal(missing.status, 1);
        assert.match(missing.stderr, /Progress file does not exist/);
    }
    finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});
test('security-scan partitions languages and ignores JS template ${} plus placeholder secrets', () => {
    const cwd = makeWorkspace();
    try {
        writeFileSync(join(cwd, 'app.ts'), [
            'const name = "customer";',
            'const greeting = `hello ${name}`;',
            "const apiKey = 'changeme-changeme-changeme-x';",
            '',
        ].join('\n'));
        writeFileSync(join(cwd, 'secrets.ts'), "const apiKey = 'sk-live-abcdefghijklmnopqrstuvwxyz';\n");
        writeFileSync(join(cwd, 'OrderMapper.xml'), '<select id="find">SELECT id FROM orders WHERE id = ${id}</select>\n');
        writeFileSync(join(cwd, '.cr-files.txt'), ['app.ts', 'secrets.ts', 'OrderMapper.xml'].join('\n'));
        const result = run('security-scan.js', ['--files', '.cr-files.txt'], cwd);
        assert.equal(result.status, 0, result.stderr);
        const body = JSON.parse(result.stdout);
        assert.equal(body.files, 3);
        const ids = body.findings.map((item) => `${item.id}:${item.file}`);
        assert.ok(ids.includes('S1:secrets.ts'), result.stdout);
        assert.ok(ids.includes('S9:OrderMapper.xml'), result.stdout);
        assert.equal(body.findings.some((item) => item.file === 'app.ts' && (item.id === 'S9' || item.id === 'S1')), false, result.stdout);
        assert.ok(body.critical >= 2);
    }
    finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});
test('security-scan skips macOS zip junk under __MACOSX', () => {
    const cwd = makeWorkspace();
    try {
        mkdirSync(join(cwd, '__MACOSX'), { recursive: true });
        writeFileSync(join(cwd, '__MACOSX', 'secrets.ts'), "const apiKey = 'sk-live-abcdefghijklmnopqrstuvwxyz';\n");
        writeFileSync(join(cwd, '.DS_Store'), 'junk');
        writeFileSync(join(cwd, '.cr-files.txt'), ['__MACOSX/secrets.ts', '.DS_Store'].join('\n'));
        const result = run('security-scan.js', ['--files', '.cr-files.txt'], cwd);
        assert.equal(result.status, 0, result.stderr);
        const body = JSON.parse(result.stdout);
        assert.equal(body.files, 0);
        assert.equal(body.findings.length, 0);
        assert.ok(body.skipped.some((item) => item.path.includes('__MACOSX')));
    }
    finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});
test('pack-skill zip is code-reviewer/SKILL.md without .git or __MACOSX', () => {
    const cwd = makeWorkspace();
    const zipPath = join(cwd, 'skill.zip');
    try {
        const result = run('pack-skill.js', [zipPath], cwd);
        assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
        assert.match(result.stdout, /code-reviewer\/SKILL.md/);
        const listing = spawnSync('unzip', ['-Z', '-1', zipPath], { encoding: 'utf-8' });
        assert.equal(listing.status, 0, listing.stderr);
        assert.match(listing.stdout, /^code-reviewer\/SKILL.md$/m);
        assert.equal(listing.stdout.includes('.git/'), false);
        assert.equal(listing.stdout.includes('__MACOSX'), false);
        assert.equal(listing.stdout.includes('.DS_Store'), false);
    }
    finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});
test('dependency-audit skips phantom scan when no diff file and git is isolated', () => {
    const cwd = makeWorkspace();
    try {
        const result = run('dependency-audit.js', [], cwd, isolatedEnv({
            GIT_DIR: join(cwd, '.not-a-git-dir'),
            GIT_WORK_TREE: cwd,
        }));
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /No changed files found, skipping phantom dependency scan/);
        assert.match(result.stdout, /Dependency check passed/);
    }
    finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});
