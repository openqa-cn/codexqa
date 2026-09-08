#!/usr/bin/env node
/**
 * Code review automated check entrypoint
 * Detects project type and runs the matching checks
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CWD = process.cwd();
const TOOLING_DIR = dirname(fileURLToPath(import.meta.url));

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
} as const;

type ColorName = keyof typeof colors;

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface ProjectInfo {
  type: string;
  framework: string | null;
  deps?: Record<string, string>;
}

interface CheckSpec {
  script: string;
  name: string;
  required: boolean;
}

interface CheckResult {
  success: boolean;
  skipped: boolean;
  error?: unknown;
}

function log(message: string, color: ColorName = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function separator(char = '━', length = 50): void {
  console.log(char.repeat(length));
}

function detectProjectType(): ProjectInfo {
  const packageJsonPath = join(CWD, 'package.json');

  if (!existsSync(packageJsonPath)) {
    return { type: 'unknown', framework: null };
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    if (deps.react || deps['react-dom']) {
      return { type: 'frontend', framework: 'react', deps };
    }
    if (deps.vue || deps['@vue/cli-service']) {
      return { type: 'frontend', framework: 'vue', deps };
    }
    if (deps.next) {
      return { type: 'frontend', framework: 'next', deps };
    }

    return { type: 'javascript', framework: null, deps };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`⚠️  Failed to read package.json: ${message}`, 'yellow');
    return { type: 'unknown', framework: null };
  }
}

function runCheck(scriptName: string, description: string): CheckResult {
  try {
    log(`\n🔍 ${description}...`, 'cyan');
    const scriptPath = join(TOOLING_DIR, scriptName);

    if (!existsSync(scriptPath)) {
      log(`⚠️  Script not found: ${scriptName}`, 'yellow');
      return { success: true, skipped: true };
    }

    execSync(`node "${scriptPath}"`, {
      stdio: 'inherit',
      cwd: CWD,
    });

    return { success: true, skipped: false };
  } catch (error) {
    return { success: false, skipped: false, error };
  }
}

async function main(): Promise<void> {
  separator('━', 60);
  log('🤖 Code review automated checks', 'blue');
  separator('━', 60);

  const project = detectProjectType();
  log(`\n📦 Project type: ${project.type}`, 'cyan');
  if (project.framework) {
    log(`🎨 Framework: ${project.framework}`, 'cyan');
  }

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
  };

  const checks: CheckSpec[] = [
    { script: 'dependency-audit.js', name: 'Dependency check', required: true },
  ];

  if (existsSync(join(CWD, 'dist')) || existsSync(join(CWD, 'build'))) {
    checks.push({ script: 'bundle-size-audit.js', name: 'Bundle analysis', required: false });
  }

  separator('─', 60);

  for (const check of checks) {
    results.total += 1;
    const result = runCheck(check.script, check.name);

    if (result.skipped) {
      results.skipped += 1;
      log(`⏭️  ${check.name}: skipped`, 'yellow');
    } else if (result.success) {
      results.passed += 1;
      log(`✅ ${check.name}: passed`, 'green');
    } else {
      results.failed += 1;
      log(`❌ ${check.name}: failed`, 'red');
      if (!check.required) {
        log(`   (optional check, continuing)`, 'yellow');
      }
    }
  }

  separator('━', 60);
  log('\n📊 Check results summary:', 'blue');
  log(`   Total: ${results.total}`, 'cyan');
  log(`   Passed: ${results.passed}`, 'green');
  log(`   Failed: ${results.failed}`, 'red');
  log(`   Skipped: ${results.skipped}`, 'yellow');
  separator('━', 60);

  if (results.failed > 0) {
    log('\n❌ Issues found, please fix before submitting', 'red');
    process.exit(1);
  }
  log('\n✅ All checks passed!', 'green');
  process.exit(0);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  log(`\n❌ Execution failed: ${message}`, 'red');
  console.error(error);
  process.exit(1);
});
