import { useEffect, useState } from "react";
import { Download, Share, Smartphone, X, CheckCircle2, Globe, MoreHorizontal } from "lucide-react";
import {
  initInstallPrompt, promptInstall, isStandalone, installChannel,
  installBannerDismissed, dismissInstallBanner, isWeChat, isIOS,
} from "./pwa-install";

function useInstallState() {
  const [installed, setInstalled] = useState(isStandalone());
  const [channel, setChannel] = useState(() => installChannel());
  useEffect(() => {
    initInstallPrompt();
    const refresh = () => setChannel(installChannel());
    const onInstalled = () => { setInstalled(true); dismissInstallBanner(); };
    window.addEventListener("beforeinstallprompt", refresh);
    window.addEventListener("appinstalled", onInstalled);
    const media = window.matchMedia?.("(display-mode: standalone)");
    const onMode = () => setInstalled(isStandalone());
    media?.addEventListener?.("change", onMode);
    return () => {
      window.removeEventListener("beforeinstallprompt", refresh);
      window.removeEventListener("appinstalled", onInstalled);
      media?.removeEventListener?.("change", onMode);
    };
  }, []);
  const install = async () => {
    if (channel === "native") {
      const accepted = await promptInstall();
      if (accepted) { setInstalled(true); dismissInstallBanner(); }
      return accepted ? "done" : "cancel";
    }
    return "guide";
  };
  return { installed, channel, install };
}

function guideContent(channel) {
  if (channel === "wechat") {
    if (isIOS()) {
      return { icon: <MoreHorizontal />, title: "请在 Safari 中打开", steps: ["点击微信右上角「···」", "选择「在 Safari 中打开」", "点击底部分享按钮", "选择「添加到主屏幕」，再点右上角「添加」"] };
    }
    return { icon: <MoreHorizontal />, title: "请在浏览器中打开", steps: ["点击微信右上角「···」", "选择「在浏览器中打开」（Chrome 或系统浏览器）", "打开浏览器菜单，选择「添加到主屏幕」"] };
  }
  if (channel === "ios") {
    return { icon: <Share />, title: "iPhone 添加方式", steps: ["① 点击浏览器底部「分享」按钮", "② 点击「添加到主屏幕」", "③ 点击「添加」"] };
  }
  return { icon: <Globe />, title: "如何添加到桌面", steps: ["电脑端：使用 Chrome / Edge 打开本站，地址栏右侧点击「安装」图标", "Android：浏览器菜单中选择「添加到主屏幕」", "iPhone：Safari 底部分享按钮 →「添加到主屏幕」"] };
}

export function InstallGuideModal({ channel, onClose }) {
  const guide = guideContent(channel);
  return (
    <div className="install-guide-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="install-guide">
        <button className="install-guide-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        <div className="install-guide-icon">{guide.icon}</div>
        <h3>{guide.title}</h3>
        <ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        <button className="install-guide-ok" onClick={onClose}>我知道了</button>
      </section>
    </div>
  );
}

// 首页顶部安装横幅：可关闭，关闭状态持久化到 localStorage
export function InstallBanner() {
  const { installed, channel, install } = useInstallState();
  const [visible, setVisible] = useState(() => !installBannerDismissed() && !isStandalone());
  const [showGuide, setShowGuide] = useState(false);
  if (!visible || installed) return showGuide ? <InstallGuideModal channel={channel} onClose={() => setShowGuide(false)} /> : null;
  const close = () => { dismissInstallBanner(); setVisible(false); };
  const onAdd = async () => { const result = await install(); if (result === "done") { setVisible(false); return; } if (result === "guide") setShowGuide(true); };
  const wechat = channel === "wechat";
  const buttonText = wechat ? "查看方法" : channel === "native" ? "立即添加" : "查看方法";
  return (
    <div className="install-banner" role="region" aria-label="添加到手机桌面提示">
      <Smartphone size={18} />
      <span className="install-banner-text">
        <strong>厦国会生活助手</strong>
        <p>{wechat ? "在微信里打开较慢？建议用浏览器打开本站，再从浏览器菜单添加到手机桌面，以后一键直达。" : "现在网页支持添加到手机桌面，像 APP 一样快速打开！"}</p>
      </span>
      <button className="install-banner-add" onClick={onAdd}>{buttonText}</button>
      <button className="install-banner-close" onClick={close} aria-label="关闭提示"><X size={16} /></button>
      {showGuide && <InstallGuideModal channel={channel} onClose={() => setShowGuide(false)} />}
    </div>
  );
}

// “我的”页面安装卡片
export function InstallCard() {
  const { installed, channel, install } = useInstallState();
  const [showGuide, setShowGuide] = useState(false);
  const onInstall = async () => { const result = await install(); if (result === "guide") setShowGuide(true); };
  return (
    <div className="install-card">
      <Download />
      <span>
        <strong>安装厦国会生活助手</strong>
        <small>添加到手机桌面后，可以像普通 App 一样打开。</small>
      </span>
      {installed
        ? <em className="install-card-done"><CheckCircle2 size={14} />已添加到桌面</em>
        : <div className="install-card-actions">
            <button onClick={onInstall}>{channel === "native" ? "安装到手机桌面" : "查看添加方法"}</button>
          </div>}
      {showGuide && <InstallGuideModal channel={channel} onClose={() => setShowGuide(false)} />}
    </div>
  );
}
