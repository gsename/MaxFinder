import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// On GitHub Pages a project site is served from /<repo>/, so every asset URL must
// be prefixed. The sync workflow sets VITE_BASE from the repository name; local
// dev and user/org sites fall back to the root.
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 900 },
})
