import { mkdir, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const source = resolve(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
const targetDir = resolve(root, "public");
const target = resolve(targetDir, "pdf.worker.min.mjs");

await mkdir(targetDir, { recursive: true });
await copyFile(source, target);
console.log(`PDF.js worker copied to ${target}`);
