export default {
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  preview: { host: true, port: 5173, strictPort: true },
};
