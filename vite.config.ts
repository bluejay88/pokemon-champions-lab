import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
  },
  build: {
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
          if (id.includes('src/data/champions-data.json')) {
            return 'champions-data';
          }
          if (id.includes('src/lib/champions')) {
            return 'champions-foundation';
          }
          if (id.includes('src/lib/online') || id.includes('netlify/functions/arena')) {
            return 'online-battles';
          }
          if (id.includes('src/lib/usage')) {
            return 'usage-intel';
          }
          if (id.includes('src/lib/abilityParity')) {
            return 'ability-parity';
          }
          if (id.includes('src/lib/simulator') || id.includes('src/lib/damage') || id.includes('src/lib/moveParity')) {
            return 'battle-core';
          }
          if (id.includes('src/lib/ai')) {
            return 'team-ai';
          }
          return undefined;
        },
      },
    },
  },
});
