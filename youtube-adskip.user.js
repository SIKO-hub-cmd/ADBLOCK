// ==UserScript==
// @name         YouTube Ad Skipper
// @description  Hides YouTube ad slots and skips video ads. For Safari on iPad/iPhone via the free "Userscripts" app.
// @version      1.1.0
// @match        *://*.youtube.com/*
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  // Shows a small green status badge at the bottom-left so we can see what the
  // script detects. Set to false once everything works.
  const DEBUG = true;

  // 1) Hide ad slots. One rule per selector, so a selector Safari doesn't
  //    understand can't break the others.
  const HIDE = [
    "#masthead-ad",
    "#player-ads",
    ".ytp-ad-overlay-container",
    ".ytp-ad-image-overlay",
    "ytd-ad-slot-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "ytd-display-ad-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-promoted-video-renderer",
    "ytd-banner-promo-renderer",
    "ytd-statement-banner-renderer",
    "ytd-companion-slot-renderer",
    "ytd-video-masthead-ad-v3-renderer",
    "ytd-primetime-promo-renderer",
    "ytd-search-pyv-renderer",
    "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-ads']",
    // Home-feed cards that wrap an ad (removes the leftover blank tile too)
    "ytd-rich-item-renderer:has(ytd-ad-slot-renderer)",
    "ytd-rich-item-renderer:has(ytd-in-feed-ad-layout-renderer)",
    "ytd-rich-item-renderer:has(.ytd-ad-slot-renderer)",
    "ytd-rich-section-renderer:has(ytd-ad-slot-renderer)",
    "ytd-rich-section-renderer:has(ytd-statement-banner-renderer)",
    // Mobile site
    "ytm-promoted-sparkles-web-renderer",
    "ytm-companion-ad-renderer",
    "ytm-promoted-video-renderer",
    "ytm-rich-item-renderer:has(ytm-ad-slot-renderer)",
  ];

  const style = document.createElement("style");
  style.textContent = HIDE.map((s) => s + "{display:none !important}").join("\n");
  (document.head || document.documentElement).appendChild(style);

  // 2) Video ads: mute, speed up, jump to the end, and press Skip.
  const SKIP_BUTTONS = [
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-container button",
    ".ytp-ad-skip-button-slot button",
    ".ytp-skip-ad button",
  ];

  let saved = null;
  let badge = null;

  // YouTube may ignore a bare .click(), so send the whole press sequence.
  function press(el) {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      try {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      } catch (_) {}
    }
  }

  function findSkipButtons() {
    const found = [];
    for (const sel of SKIP_BUTTONS) {
      const el = document.querySelector(sel);
      if (el && !found.includes(el)) found.push(el);
    }
    return found;
  }

  function showBadge(text) {
    if (!DEBUG) return;
    if (!badge) {
      badge = document.createElement("div");
      badge.style.cssText =
        "position:fixed;left:4px;bottom:4px;z-index:2147483647;background:rgba(0,0,0,.75);" +
        "color:#0f0;font:11px monospace;padding:3px 6px;border-radius:4px;pointer-events:none;max-width:90vw";
      document.documentElement.appendChild(badge);
    }
    badge.textContent = text;
  }

  function tick() {
    const player = document.querySelector(".html5-video-player");
    const video = player && player.querySelector("video");
    if (!player || !video) {
      showBadge("adskip v1.1 | no player on this page");
      return;
    }

    const adShowing = player.classList.contains("ad-showing");
    const buttons = adShowing ? findSkipButtons() : [];

    if (adShowing) {
      if (!saved) saved = { muted: video.muted, rate: video.playbackRate };
      try {
        video.muted = true;
        video.playbackRate = 16;
        if (isFinite(video.duration) && video.duration > 0.5) {
          video.currentTime = Math.max(0, video.duration - 0.05);
        }
      } catch (_) {}
      buttons.forEach(press);
    } else if (saved) {
      try {
        video.muted = saved.muted;
        video.playbackRate = saved.rate;
      } catch (_) {}
      saved = null;
    }

    showBadge(
      "adskip v1.1 | ad:" + (adShowing ? "YES" : "no") +
      " dur:" + (isFinite(video.duration) ? video.duration.toFixed(1) : String(video.duration)) +
      " t:" + video.currentTime.toFixed(1) +
      " rate:" + video.playbackRate +
      " skipBtn:" + buttons.length
    );
  }

  setInterval(tick, 150);
})();
