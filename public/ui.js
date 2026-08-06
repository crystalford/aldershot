// Lightweight UI kit — inline toasts + promise-based modals, so the app never
// falls back to native browser alert/prompt/confirm dialogs.
window.UI = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function root(id) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement("div"); el.id = id; document.body.appendChild(el); }
    return el;
  }

  const GLYPH = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v5"/><circle cx="12" cy="16.5" r=".4"/><path d="M10.3 3.9 2.4 18a1.9 1.9 0 0 0 1.7 2.8h15.8A1.9 1.9 0 0 0 21.6 18L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.5" r=".4"/></svg>',
  };

  // ── Toasts ───────────────────────────────────────────────────────
  function toast(message, opts = {}) {
    const { type = "info", duration = 4200, title } = opts;
    const stack = root("toasts");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML =
      `<span class="toast-ic">${GLYPH[type] || GLYPH.info}</span>` +
      `<div class="toast-body">${title ? `<div class="toast-title">${esc(title)}</div>` : ""}<div class="toast-msg">${esc(message)}</div></div>` +
      `<button class="toast-x" aria-label="Dismiss">✕</button>`;
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add("in"));
    let t;
    const close = () => { clearTimeout(t); el.classList.remove("in"); setTimeout(() => el.remove(), 260); };
    el.querySelector(".toast-x").onclick = close;
    if (duration) t = setTimeout(close, duration);
    return { close };
  }

  // ── Modal (promise) ──────────────────────────────────────────────
  function modal({ title, bodyHTML = "", actions = [], onOpen, dismissValue = null }) {
    return new Promise((resolve) => {
      const rootEl = root("modal-root");
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML =
        `<div class="modal" role="dialog" aria-modal="true">` +
        (title ? `<div class="modal-head">${esc(title)}</div>` : "") +
        `<div class="modal-body">${bodyHTML}</div>` +
        `<div class="modal-foot"></div></div>`;
      rootEl.appendChild(overlay);
      const card = overlay.querySelector(".modal");
      const foot = overlay.querySelector(".modal-foot");

      let closed = false;
      const done = (val) => {
        if (closed) return; closed = true;
        document.removeEventListener("keydown", onKey);
        overlay.classList.remove("in");
        setTimeout(() => overlay.remove(), 200);
        resolve(val);
      };
      const onKey = (e) => { if (e.key === "Escape") done(dismissValue); };
      document.addEventListener("keydown", onKey);
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) done(dismissValue); });

      actions.forEach((a) => {
        const b = document.createElement("button");
        b.className = `btn ${a.variant || ""}`.trim();
        b.textContent = a.label;
        b.onclick = () => (a.resolve !== undefined ? done(a.resolve) : a.onClick?.(done, card));
        foot.appendChild(b);
      });

      requestAnimationFrame(() => overlay.classList.add("in"));
      onOpen?.(card, done);
    });
  }

  function confirm({ title = "Are you sure?", message = "", confirmText = "Confirm", cancelText = "Cancel", danger = false } = {}) {
    return modal({
      title,
      bodyHTML: `<p class="modal-text">${esc(message)}</p>`,
      dismissValue: false,
      actions: [
        { label: cancelText, resolve: false },
        { label: confirmText, variant: danger ? "danger" : "amber", resolve: true },
      ],
    });
  }

  function prompt({ title = "", label = "", value = "", placeholder = "", confirmText = "Create", cancelText = "Cancel" } = {}) {
    return modal({
      title,
      bodyHTML: (label ? `<label class="modal-label">${esc(label)}</label>` : "") +
        `<input class="modal-input" id="__ui_prompt" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" />`,
      dismissValue: null,
      onOpen: (card, done) => {
        const inp = card.querySelector("#__ui_prompt");
        inp.focus(); inp.select();
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") done(inp.value); });
      },
      actions: [
        { label: cancelText, resolve: null },
        { label: confirmText, variant: "amber", onClick: (done, card) => done(card.querySelector("#__ui_prompt").value) },
      ],
    });
  }

  return { toast, modal, confirm, prompt, esc };
})();
