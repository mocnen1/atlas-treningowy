import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Cała aplikacja w jednym pliku HTML: działa i w Electronie (file://), i jako podgląd w przeglądarce.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: { outDir: 'dist', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 10_000 },
});
