import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function addDownloadHeaders(server) {
  server.middlewares.use((req, res, next) => {
    if (req.url && req.url.startsWith('/downloads/')) {
      const rawFilename = req.url.split('/').pop().split('?')[0];
      const filename = decodeURIComponent(rawFilename);
      if (filename.endsWith('.AppImage')) {
        res.setHeader('Content-Type', 'application/x-executable');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      } else if (filename.endsWith('.apk')) {
        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      }
    }
    next();
  });
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'downloads-attachment-headers',
      configureServer(server) {
        addDownloadHeaders(server);
      },
      configurePreviewServer(server) {
        addDownloadHeaders(server);
      }
    }
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});

