#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const htmlPath = path.join(root, "dist", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");

if (html.includes('/index.tsx')) {
  throw new Error("dist/index.html references /index.tsx; Vercel would serve the source entry instead of built assets.");
}

if (!/\/assets\/index-[^"]+\.js/.test(html)) {
  throw new Error("dist/index.html does not reference the built Vite JavaScript asset.");
}

if (!/\/assets\/index-[^"]+\.css/.test(html)) {
  throw new Error("dist/index.html does not reference the built Vite CSS asset.");
}

console.log("[verify-vite-dist] dist asset references ok");
