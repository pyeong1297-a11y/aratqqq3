import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(dashboardDir, '..');
const sourceDir = path.join(repoRoot, 'data', 'us');
const targetDir = path.join(dashboardDir, 'public', 'data', 'us');

await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, { recursive: true });

console.log(`Synced CSV data to ${targetDir}`);
