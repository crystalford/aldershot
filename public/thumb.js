// Client-side video thumbnails — seek a hidden <video> to a timestamp, grab a
// frame via canvas, cache the data URL. No server round-trip, no storage cost.
window.Thumb = (() => {
  const cache = new Map(); // `${url}@${t}` -> dataURL

  function grab(url, atSeconds = 1) {
    const key = `${url}@${atSeconds.toFixed(1)}`;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    return new Promise((resolve) => {
      const v = document.createElement("video");
      v.crossOrigin = "anonymous";
      v.muted = true;
      v.preload = "metadata";
      v.playsInline = true;
      const cleanup = () => { v.removeAttribute("src"); v.load(); };
      const fail = () => { cleanup(); resolve(null); };
      const to = setTimeout(fail, 12000);

      v.addEventListener("loadedmetadata", () => {
        const t = Math.min(Math.max(atSeconds, 0.1), Math.max(v.duration - 0.1, 0.1));
        try { v.currentTime = t; } catch { fail(); }
      });
      v.addEventListener("seeked", () => {
        try {
          const w = 320, h = Math.round((v.videoHeight / v.videoWidth) * 320) || 180;
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(v, 0, 0, w, h);
          const data = canvas.toDataURL("image/jpeg", 0.72);
          clearTimeout(to);
          cache.set(key, data);
          cleanup();
          resolve(data);
        } catch { clearTimeout(to); fail(); }
      });
      v.addEventListener("error", () => { clearTimeout(to); fail(); });
      v.src = url;
    });
  }

  // Fill every img[data-thumb-src][data-thumb-t] under root once each is ready.
  function hydrate(root = document) {
    root.querySelectorAll("img[data-thumb-src]").forEach((img) => {
      if (img.dataset.thumbDone) return;
      img.dataset.thumbDone = "1";
      const url = img.dataset.thumbSrc;
      const t = parseFloat(img.dataset.thumbT || "1");
      grab(url, t).then((data) => {
        if (data) { img.src = data; img.classList.add("loaded"); }
        else img.classList.add("thumb-failed");
      });
    });
  }

  return { grab, hydrate };
})();
