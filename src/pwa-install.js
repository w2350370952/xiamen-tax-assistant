// PWA 安装引导：横幅状态、平台识别、系统安装弹窗封装
export const BANNER_KEY = "xnai_life_app_install_banner_dismissed";

let deferredPrompt = null;
let initialized = false;

export function initInstallPrompt() {
  if (initialized) return;
  initialized = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    dismissInstallBanner();
  });
}

export function canNativeInstall() {
  return Boolean(deferredPrompt);
}

// 调用系统安装弹窗；deferredPrompt 一次性使用，绝不重复调用失效对象
export async function promptInstall() {
  if (!deferredPrompt) return false;
  const promptEvent = deferredPrompt;
  deferredPrompt = null;
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    return choice?.outcome === "accepted";
  } catch {
    return false;
  }
}

export function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export function isIOS() {
  const ua = navigator.userAgent || "";
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isWeChat() {
  return /micromessenger/i.test(navigator.userAgent || "");
}

export function installBannerDismissed() {
  try {
    return Boolean(JSON.parse(localStorage.getItem(BANNER_KEY)));
  } catch {
    return false;
  }
}

export function dismissInstallBanner() {
  try {
    localStorage.setItem(BANNER_KEY, JSON.stringify({ dismissed: true, dismissedAt: new Date().toISOString() }));
  } catch { /* localStorage 不可用时静默 */ }
}

// 根据平台返回引导类型：native(系统弹窗) / ios / wechat / guide(通用说明)
export function installChannel() {
  if (isWeChat()) return "wechat";
  if (isIOS()) return "ios";
  if (canNativeInstall()) return "native";
  return "guide";
}
