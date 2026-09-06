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
    plugins: [tailwindcss()],
    resolve: {
      // Tetrament imports bare `three` in some modules and `three/webgpu` in
      // others. Bundled separately those become two different copies of the
      // core classes, and the three-mesh-bvh prototype patch its tetrahedralizer
      // installs then lands on the wrong BufferGeometry. Funnel everything
      // through the WebGPU build, as Tetrament's own examples do.
      alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
      dedupe: ['three', 'three-mesh-bvh']
    }
  }
});