// ==UserScript==
// @name         YouTube Ad Skipper
// @description  Hides YouTube ad slots and skips video ads by fast-forwarding them. For Safari on iPad/iPhone via the free "Userscripts" app.
// @version      1.0.0
// @match        *://*.youtube.com/*
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  // 1) Hide ad slots (banners, feed ads, promos, overlays).
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
    "ytm-promoted-sparkles-web-renderer",
    "ytm-companion-ad-renderer",
    "ytm-promoted-video-renderer",
  ];

  const style = document.createElement("style");
  style.textContent = HIDE.join(",") + "{display:none !important}";
  (document.head || document.documentElement).appendChild(style);

  // 2) Video ads: when the player is showing an ad, mute it, fast-forward it
  //    to the end, and press "Skip" whenever that button appears.
  const SKIP_BUTTONS = [
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-container button",
    ".ytp-ad-skip-button-slot button",
  ];

  let saved = null; // the user's own mute/speed settings, restored after the ad

  function clickSkip() {
    for (const sel of SKIP_BUTTONS) {
      const btn = document.querySelector(sel);
      if (btn) btn.click();
    }
  }

  function tick() {
    const player = document.querySelector(".html5-video-player");
    const video = player && player.querySelector("video");
    if (!player || !video) return;

    if (player.classList.contains("ad-showing")) {
      if (!saved) saved = { muted: video.muted, rate: video.playbackRate };
      try {
        video.muted = true;
        video.playbackRate = 16;
        if (isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.1) {
          video.currentTime = video.duration;
        }
      } catch (_) {}
      clickSkip();
    } else if (saved) {
      try {
        video.muted = saved.muted;
        video.playbackRate = saved.rate;
      } catch (_) {}
      saved = null;
    }
  }

  setInterval(tick, 250);
})();
