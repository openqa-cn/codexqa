#!/usr/bin/env node
/**
 * Build a portable skill zip from packaging-inventory.txt.
 * Root entry is always `code-reviewer/SKILL.md`.
 * Never packs `.git`, `__MACOSX`, `.DS_Store`, `._*`, or `node_modules`.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const TOOLING = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TOOLING, '..');
const SKILL_DIR = 'code-reviewer';
const JUNK = /(^|[\\/])(\.git|__MACOSX|node_modules)([\\/]|$)|(^|[\\/])\.DS_Store$|(^|[\\/])\._/;
function inventoryPaths() {
    const listing = readFileSync(join(ROOT, 'packaging-inventory.txt'), 'utf8');
    return listing
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));
}
function isJunk(relPath) {
    return JUNK.test(relPath.replace(/\\/g, '/'));
}
function main() {
    const outArg = process.argv[2];
    const outZip = resolve(process.cwd(), outArg ?? 'code-reviewer.zip');
    const stageParent = mkdtempSync(join(tmpdir(), 'code-reviewer-pack-'));
    const stage = join(stageParent, SKILL_DIR);
    try {
        mkdirSync(stage, { recursive: true });
        let copied = 0;
        for (const rel of inventoryPaths()) {
            if (isJunk(rel)) {
                continue;
            }
            const src = join(ROOT, rel);
            if (!existsSync(src)) {
                throw new Error(`inventory path missing: ${rel}`);
            }
            const dest = join(stage, rel);
            mkdirSync(dirname(dest), { recursive: true });
            copyFileSync(src, dest);
            copied += 1;
        }
        if (!existsSync(join(stage, 'SKILL.md'))) {
            throw new Error('staged skill is missing SKILL.md');
        }
        if (existsSync(outZip)) {
            rmSync(outZip);
        }
        execFileSync('zip', ['-r', '-X', '-q', outZip, SKILL_DIR], {
            cwd: stageParent,
            stdio: 'inherit',
        });
        const relativeOut = relative(process.cwd(), outZip) || outZip;
        process.stdout.write(`Packed ${copied} files → ${relativeOut} (root ${SKILL_DIR}/SKILL.md; skipped .git / __MACOSX)\n`);
    }
    finally {
        rmSync(stageParent, { recursive: true, force: true });
    }
}
try {
    main();
}
catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
}
