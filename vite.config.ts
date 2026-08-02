import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Plans live in localStorage, which is scoped to the origin — so the port is part of
  // where your data lives. Pinned, and strict so a clash fails loudly rather than
  // hopping to 5200 and silently opening an empty planner.
  server: { port: 5199, strictPort: true },
  preview: { port: 5199, strictPort: true },
})
