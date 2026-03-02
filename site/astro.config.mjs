// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';
import { execSync } from 'child_process';

let gitHash = 'dev';
try {
  gitHash = execSync('git rev-parse --short HEAD').toString().trim();
  // Append dirty marker if there are uncommitted changes
  const status = execSync('git status --porcelain').toString().trim();
  if (status) {
    // Use timestamp-based suffix so each deploy gets a unique build ID
    const ts = Date.now().toString(36).slice(-4);
    gitHash = `${gitHash}+${ts}`;
  }
} catch {}
const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  site: 'https://observatory.unratified.org',
  output: 'server',
  adapter: cloudflare({
    platformProxy: {
      enabled: true,
    },
  }),
  integrations: [tailwind()],
  vite: {
    define: {
      __BUILD_HASH__: JSON.stringify(gitHash),
      __BUILD_TIME__: JSON.stringify(buildTime),
    },
  },
});
