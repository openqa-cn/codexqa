#!/usr/bin/env node
/**
 * Bundle size analysis script
 * Analyzes the build output and finds large dependencies
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
function formatSize(bytes) {
    if (bytes === 0)
        return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
function getAllFiles(dirPath, arrayOfFiles = []) {
    const files = readdirSync(dirPath);
    files.forEach((file) => {
        const filePath = join(dirPath, file);
        if (statSync(filePath).isDirectory()) {
            getAllFiles(filePath, arrayOfFiles);
        }
        else {
            arrayOfFiles.push(filePath);
        }
    });
    return arrayOfFiles;
}
function analyzeWebpackStats(statsPath) {
    console.log('📊 Analyzing Webpack Stats...\n');
    const stats = JSON.parse(readFileSync(statsPath, 'utf-8'));
    const modules = stats.modules || [];
    const largeModules = modules
        .filter((module) => module.size > 100 * 1024)
        .sort((a, b) => b.size - a.size)
        .slice(0, 10);
    if (largeModules.length > 0) {
        console.log('🔍 Top 10 largest modules:\n');
        largeModules.forEach((module, i) => {
            console.log(`${i + 1}. ${module.name}`);
            console.log(`   Size: ${formatSize(module.size)}\n`);
        });
    }
    const assets = stats.assets || [];
    const jsAssets = assets.filter((asset) => asset.name.endsWith('.js'));
    const totalSize = jsAssets.reduce((sum, asset) => sum + asset.size, 0);
    console.log(`📦 Total bundle size: ${formatSize(totalSize)}`);
    return { totalSize, largeModules };
}
function analyzeBuildDir(buildDir) {
    console.log(`📂 Analyzing build directory: ${buildDir}\n`);
    const files = getAllFiles(buildDir);
    const jsFiles = files
        .filter((file) => file.endsWith('.js') && !file.includes('.map'))
        .map((file) => ({
        path: file.replace(`${buildDir}/`, ''),
        size: statSync(file).size,
    }))
        .sort((a, b) => b.size - a.size);
    if (jsFiles.length === 0) {
        console.log('⚠️  No JS files found\n');
        return { totalSize: 0, files: [] };
    }
    console.log('📦 JS file list:\n');
    jsFiles.slice(0, 10).forEach((file, i) => {
        console.log(`${i + 1}. ${file.path}`);
        console.log(`   Size: ${formatSize(file.size)}\n`);
    });
    const totalSize = jsFiles.reduce((sum, file) => sum + file.size, 0);
    console.log(`📊 Total size: ${formatSize(totalSize)}`);
    return { totalSize, files: jsFiles };
}
async function main() {
    console.log('📦 Bundle size analysis\n');
    console.log('━'.repeat(50));
    const cwd = process.cwd();
    const statsPath = join(cwd, 'dist/stats.json');
    let result;
    if (existsSync(statsPath)) {
        result = analyzeWebpackStats(statsPath);
    }
    else {
        const buildDirs = ['dist', 'build', '.next/static'];
        let buildDir = null;
        for (const dir of buildDirs) {
            const path = join(cwd, dir);
            if (existsSync(path)) {
                buildDir = path;
                break;
            }
        }
        if (!buildDir) {
            console.log('⚠️  Build directory not found (dist/build/.next)');
            console.log('💡 Hint:');
            console.log('   - Run the build command first (npm run build)');
            console.log('   - Or generate webpack stats: webpack --profile --json > dist/stats.json\n');
            process.exit(0);
        }
        result = analyzeBuildDir(buildDir);
    }
    console.log(`\n${'━'.repeat(50)}`);
    const THRESHOLD = 500 * 1024;
    const WARN_THRESHOLD = 300 * 1024;
    if (result.totalSize > THRESHOLD) {
        console.log(`\n❌ Bundle size exceeds the ${formatSize(THRESHOLD)} limit!`);
        console.log('\n💡 Optimization suggestions:');
        console.log('   1. Use dynamic import() for code splitting');
        console.log('   2. Check for unnecessary large libraries');
        console.log('   3. Use webpack-bundle-analyzer to inspect dependencies');
        console.log('   4. Enable tree shaking');
        console.log('   5. Minify and uglify the code\n');
        process.exit(1);
    }
    else if (result.totalSize > WARN_THRESHOLD) {
        console.log(`\n⚠️  Bundle size is approaching the ${formatSize(THRESHOLD)} limit`);
        console.log('   Consider optimizing\n');
        process.exit(0);
    }
    else {
        console.log('\n✅ Bundle size is within limits\n');
        process.exit(0);
    }
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Execution failed: ${message}`);
    console.error(error);
    process.exit(1);
});
