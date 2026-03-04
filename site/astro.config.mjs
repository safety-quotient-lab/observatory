// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Astro integration: regenerate agent-inbox.json from proposal frontmatter at each build */
const agentInboxIntegration = {
  name: 'agent-inbox',
  hooks: {
    'astro:build:start': () => {
      try {
        execSync(`node ${join(__dirname, '../scripts/build-agent-inbox.mjs')}`, { stdio: 'inherit' });
      } catch (e) {
        console.warn('agent-inbox build failed (non-fatal):', e.message);
      }
    },
  },
};

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
  integrations: [tailwind(), agentInboxIntegration],
  vite: {
    define: {
      __BUILD_HASH__: JSON.stringify(gitHash),
      __BUILD_TIME__: JSON.stringify(buildTime),
    },
  },
});
