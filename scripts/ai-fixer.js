#!/usr/bin/env node
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Simple watcher that runs `npx tsc --noEmit` on changes and attempts to run prettier if available.
// This is a lightweight local assistant/skeleton — integrate a real LLM via a service for automatic code transforms.

const root = path.resolve(__dirname, '..');
let timer = null;

function runChecks() {
  console.log('\n[ai-fixer] Running static type check...');
  const tsc = exec('npx tsc --noEmit', { cwd: root });
  tsc.stdout.pipe(process.stdout);
  tsc.stderr.pipe(process.stderr);
  tsc.on('close', (code) => {
    if (code === 0) {
      console.log('[ai-fixer] Type check passed. Running Prettier (if available) to normalize formatting...');
      const p = exec('npx prettier --write .', { cwd: root });
      p.stdout.pipe(process.stdout);
      p.stderr.pipe(process.stderr);
      p.on('close', () => console.log('[ai-fixer] Done.'));
    } else {
      console.log('[ai-fixer] Type check failed. Fixes require developer review or an integrated LLM fixer.');
    }
  });
}

function scheduleRun() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(runChecks, 400);
}

console.log('[ai-fixer] Watching project files for changes...');

function walk(dir) {
  fs.readdir(dir, { withFileTypes: true }, (err, entries) => {
    if (err) return;
    entries.forEach((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', '.git', 'dist'].includes(e.name)) return;
        walk(full);
      } else if (e.isFile()) {
        if (/\.tsx?$/.test(e.name) || /\.ts$/.test(e.name) || /\.json$/.test(e.name) || /\.jsx?$/.test(e.name)) {
          fs.watchFile(full, { interval: 500 }, scheduleRun);
        }
      }
    });
  });
}

walk(root);

// Run once initially
runChecks();
