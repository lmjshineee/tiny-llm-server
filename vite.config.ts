import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Relative assets work both under Vite preview and a GitHub Pages project path.
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
  },
})
