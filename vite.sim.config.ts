import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

/** Збірка правил бою в один файл для серверної логіки HGS: server/sim-node.cjs (без залежностей). */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  ssr: { noExternal: true },
  publicDir: false,
  build: {
    ssr: 'server/sim-entry.ts',
    outDir: 'server',
    emptyOutDir: false,
    target: 'node18',
    minify: true,
    rollupOptions: { output: { entryFileNames: 'sim-node.cjs', format: 'cjs' } },
  },
});
