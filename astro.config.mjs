// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  i18n: {
    locales: ['he', 'en'],
    defaultLocale: 'he',
    routing: {
      prefixDefaultLocale: false
    }
  },
  image: {
    remotePatterns: [{ protocol: 'https', hostname: 'placehold.co' }]
  },
  vite: {
    plugins: [tailwindcss()]
  }
});