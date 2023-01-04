import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import resolve from '@rollup/plugin-node-resolve';

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    rollupOptions: {
      // without this vite build fails
      // related to: https://github.com/aws-amplify/amplify-js/issues/9866
      external: ['mapbox-gl'],
    },
  },
  define: {
    // https://stackoverflow.com/a/73541205/18550269
    global: 'window',
  },
  plugins: [
    react(),
    // https://github.com/aws/aws-sdk-js/issues/3673#issuecomment-1130779518
    {
      ...resolve({
        preferBuiltins: false,
        browser: true,
      }),
      enforce: 'pre',
      apply: 'build',
    },
  ],
});
