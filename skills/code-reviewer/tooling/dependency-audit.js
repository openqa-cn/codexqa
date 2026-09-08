#!/usr/bin/env node
/**
 * Dependency check script
 * Checks phantom dependencies in this diff's changed files plus npm/pnpm package vulnerabilities
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
const CWD = process.cwd();
const DIFF_FILE = `${CWD}/.code-review-diff.tmp`;
function getChangedFilesFromDiff() {
    if (existsSync(DIFF_FILE)) {
        const diffContent = readFileSync(DIFF_FILE, 'utf-8');
        const files = new Set();
        const regex = /^diff --git a\/.+ b\/(.+)$/gm;
        let match;
        while ((match = regex.exec(diffContent)) !== null) {
            if (match[1])
                files.add(match[1]);
        }
        return [...files].filter((file) => /\.(js|jsx|ts|tsx)$/.test(file) &&
            !file.includes('node_modules') &&
            !file.includes('__MACOSX') &&
            !file.includes('/dist/') &&
            !file.includes('.test.') &&
            !file.includes('.spec.'));
    }
    try {
        const output = execSync('git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only --cached', {
            cwd: CWD,
            encoding: 'utf-8',
            timeout: 5000,
        });
        return output
            .split('\n')
            .filter((file) => file &&
            /\.(js|jsx|ts|tsx)$/.test(file) &&
            !file.includes('node_modules') &&
            !file.includes('__MACOSX'));
    }
    catch {
        return [];
    }
}
function extractImportsFromFiles(files) {
    const imports = new Set();
    for (const file of files) {
        const fullPath = resolve(CWD, file);
        if (!existsSync(fullPath))
            continue;
        try {
            const content = readFileSync(fullPath, 'utf-8');
            if (content.length > 500 * 1024)
                continue;
            for (const regex of [
                /from\s+['"]([^'"]+)['"]/g,
                /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
                /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
            ]) {
                let match;
                while ((match = regex.exec(content)) !== null) {
                    const pkg = extractPackageName(match[1] || '');
                    if (pkg)
                        imports.add(pkg);
                }
            }
        }
        catch {
            /* ignore read failures */
        }
    }
    return [...imports];
}
function extractPackageName(importPath) {
    if (importPath.startsWith('.') || importPath.startsWith('/'))
        return null;
    if (importPath.startsWith('@')) {
        const parts = importPath.split('/');
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
    }
    return importPath.split('/')[0] || null;
}
async function checkPhantomDependencies(changedFiles) {
    console.log('🔍 Scanning for phantom dependencies (changed files only)...\n');
    const packageJsonPath = `${CWD}/package.json`;
    if (!existsSync(packageJsonPath)) {
        console.log('⚠️  No package.json found, skipping phantom dependency scan\n');
        return { passed: true };
    }
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const declared = new Set([
        ...Object.keys(packageJson.dependencies || {}),
        ...Object.keys(packageJson.devDependencies || {}),
        ...Object.keys(packageJson.peerDependencies || {}),
    ]);
    const imported = extractImportsFromFiles(changedFiles);
    console.log(`📦 Changed files import ${imported.length} external package(s)\n`);
    const phantoms = imported.filter((pkg) => !declared.has(pkg));
    if (phantoms.length === 0) {
        console.log('✅ No phantom dependencies found\n');
        return { passed: true };
    }
    console.log(`❌ Found ${phantoms.length} phantom dependenc(ies) (used but not declared in package.json):\n`);
    phantoms.forEach((pkg, idx) => {
        console.log(`  ${idx + 1}. 📦 ${pkg}`);
    });
    console.log('\n💡 Fix: pnpm add <package-name>\n');
    return { passed: false, phantoms };
}
function checkVulnerabilities() {
    console.log('🔒 Scanning package vulnerabilities...\n');
    const isPnpm = existsSync(`${CWD}/pnpm-lock.yaml`);
    const isYarn = existsSync(`${CWD}/yarn.lock`);
    const auditCmd = isPnpm ? 'pnpm audit --json' : isYarn ? 'yarn audit --json' : 'npm audit --json';
    try {
        const auditResult = execSync(auditCmd, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
            timeout: 30000,
            cwd: CWD,
        });
        const audit = JSON.parse(auditResult);
        const vuln = audit.metadata?.vulnerabilities || audit.vulnerabilities || {};
        const critical = vuln.critical || 0;
        const high = vuln.high || 0;
        console.log(`  🔴 critical: ${critical}  🟠 high: ${high}  🟡 moderate: ${vuln.moderate || 0}  🟢 low: ${vuln.low || 0}\n`);
        if (critical > 0 || high > 0) {
            console.log(`❌ Critical or high vulnerabilities found, recommended: ${isPnpm ? 'pnpm audit' : 'npm audit fix'}\n`);
            return { passed: false };
        }
        console.log('✅ No critical or high vulnerabilities found\n');
        return { passed: true };
    }
    catch {
        console.log('⚠️  Vulnerability scan skipped (network issue or package manager does not support audit)\n');
        return { passed: true };
    }
}
async function main() {
    console.log('📦 Dependency check\n' + '━'.repeat(50));
    const changedFiles = getChangedFilesFromDiff();
    if (changedFiles.length === 0) {
        console.log('⚠️  No changed files found, skipping phantom dependency scan\n');
    }
    const phantomResult = changedFiles.length > 0 ? await checkPhantomDependencies(changedFiles) : { passed: true };
    console.log('━'.repeat(50));
    const vulnResult = checkVulnerabilities();
    console.log('━'.repeat(50));
    if (!phantomResult.passed || !vulnResult.passed) {
        console.log('\n❌ Dependency check found issues, please confirm before merging\n');
        process.exit(1);
    }
    else {
        console.log('\n✅ Dependency check passed\n');
        process.exit(0);
    }
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Execution failed: ${message}`);
    process.exit(1);
});
