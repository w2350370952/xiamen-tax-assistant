import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "node:fs";

function emitRuntimeAssets() {
  return {
    name: "emit-local-runtime-assets",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "assets/pdf.worker.js",
        source: readFileSync(new URL("./node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)),
      });
      this.emitFile({
        type: "asset",
        fileName: "assets/ocr/worker.min.js",
        source: readFileSync(new URL("./node_modules/tesseract.js/dist/worker.min.js", import.meta.url)),
      });
      this.emitFile({
        type: "asset",
        fileName: "assets/ocr/tesseract-core-lstm.wasm.js",
        source: readFileSync(new URL("./node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", import.meta.url)),
      });
      this.emitFile({
        type: "asset",
        fileName: "assets/ocr/chi_sim.traineddata.gz",
        source: readFileSync(new URL("./node_modules/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz", import.meta.url)),
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    emitRuntimeAssets(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        // 预缓存只保留核心外壳（HTML+主包JS/CSS+图标），懒加载块（图表/财经/管理端）按需再取，
        // 避免首次访问时后台下载大文件抢占带宽（微信内置浏览器尤为敏感）
        globPatterns: ["index.html", "assets/index-*.js", "assets/index-*.css", "*.png", "*.ico", "manifest.webmanifest"],
        // 单页应用子路由刷新不404；API与OCR大文件不走页面回退
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/assets\/ocr\//],
        runtimeCaching: [
          {
            // 财经行情：NetworkFirst，缓存不超过60秒，不得伪装成实时数据
            urlPattern: /^https?:\/\/[^/]+\/api\/nasdaq100.*$/,
            handler: "NetworkFirst",
            method: "GET",
            options: {
              cacheName: "finance-api",
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 8, maxAgeSeconds: 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // 课程与菜单：NetworkFirst，失败时回退最近一次成功数据（由页面显示更新时间）
            urlPattern: /^https?:\/\/[^/]+\/api\/(live-courses|live-menu|courses).*$/,
            handler: "NetworkFirst",
            method: "GET",
            options: {
              cacheName: "content-api",
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 20, maxAgeSeconds: 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // 管理端、登录、行为上报、设备识别、IP调试等：永不缓存
            urlPattern: /^https?:\/\/[^/]+\/api\/.*$/,
            handler: "NetworkOnly",
            method: "GET",
            options: { cacheName: "api-no-store" },
          },
        ],
      },
      manifest: {
        id: "/",
        name: "厦国会生活助手",
        short_name: "厦国会生活助手",
        description: "厦门国家会计学院课程、菜单、校园生活与财经信息助手，支持四个专业的课表查看。",
        display: "standalone",
        start_url: "/",
        scope: "/",
        orientation: "portrait",
        lang: "zh-CN",
        theme_color: "#17335f",
        background_color: "#f4f7fc",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  build: { outDir: "dist" },
});
