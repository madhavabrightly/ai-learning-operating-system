import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'

// Custom plugin to handle ?import&react syntax (alias to ?react)
const svgImportPlugin = () => ({
  name: 'svg-import-alias',
  resolveId(id: string) {
    // Transform ?import&react to ?react for vite-plugin-svgr
    if (id.includes('?import&react')) {
      return id.replace('?import&react', '?react');
    }
    return null;
  },
});

// https://vite.dev/config/
export default defineConfig(() => ({
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    svgImportPlugin(),
    svgr({
      // Support named ReactComponent export (for ?react syntax)
      svgrOptions: {
        exportType: 'named',
        namedExport: 'ReactComponent',
        ref: true,
        svgo: false,
        titleProp: true,
      },
      include: '**/*.svg?react',
    }),
  ],
  server: {
    // Bind to all interfaces so the preview proxy can always reach the dev
    // server regardless of how the sandbox is networked. Also guarantees the
    // server is reachable if the sandbox is re-provisioned mid-boot.
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true as const,
    hmr: false,
    // Pre-transform the app's entry modules while the server boots (i.e.
    // during the platform's install→dev scheduling gap) so the preview's
    // first request after each sandbox rebuild renders the app immediately
    // instead of waiting for on-demand transforms.
    warmup: {
      clientFiles: ['./src/main.tsx', './src/App.tsx'],
    },
  },
  // Pre-bundle the app's real dependencies up front so a cold dev-server boot
  // (fresh sandbox, no .vite cache) doesn't trigger a heavy on-demand esbuild
  // pass while the preview is health-checking the port.
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      'react-error-boundary',
      'react-markdown',
      'remark-gfm',
      'remark-math',
      'katex',
      'lucide-react',
      'zustand',
      'clsx',
      'tailwind-merge',
      'uuid',
      '@supabase/supabase-js',
    ],
  },
}))
