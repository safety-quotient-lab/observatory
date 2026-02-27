/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        surface: {
          0: '#002d38',
          1: '#093946',
          2: '#0d4655',
          3: '#1a5568',
        },
        accent: '#2b90d8',
      },
    },
  },
  plugins: [],
};
