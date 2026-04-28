import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  turbopack: {
    root: rootDir,
  },
};

export default nextConfig;
