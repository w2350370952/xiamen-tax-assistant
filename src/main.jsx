import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./admin.css";

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);

// PWA：注册 Service Worker，检测到新版本时询问用户是否更新（只重载一次，绝不无限刷新）
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((registration) => {
      // 新SW接管后只刷新一次
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
      // 每次进入页面检查一次更新
      registration.update().catch(() => {});
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            if (window.confirm("厦国会生活助手发现新版本，是否立即更新？")) {
              worker.postMessage({ type: "SKIP_WAITING" });
            }
          }
        });
      });
    }).catch((error) => console.error("Service Worker 注册失败", error));
  });
}
