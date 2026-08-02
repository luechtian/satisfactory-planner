import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build works from any subpath without being told the
  // repo name — GitHub Pages serves project sites from /<repo>/, where the default
  // absolute /assets/... would resolve to the domain root and 404.
  base: "./",
  // Plans live in localStorage, which is scoped to the origin — so the port is part of
  // where your data lives. Pinned, and strict so a clash fails loudly rather than
  // hopping to 5200 and silently opening an empty planner.
  server: { port: 5199, strictPort: true },
  preview: { port: 5199, strictPort: true },
})
