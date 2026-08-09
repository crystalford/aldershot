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
        { label: confirmText, variant: danger ? "danger" : "primary", resolve: true },
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
        { label: confirmText, variant: "primary", onClick: (done, card) => done(card.querySelector("#__ui_prompt").value) },
      ],
    });
  }

  // ── Command palette (promise) ─────────────────────────────────────
  // items: [{ label, hint?, group?, action }]. Resolves the chosen item's
  // `action` result, or null if dismissed. Filters by substring on `label`
  // (falling back to `group`) — no fuzzy-match library, the command list is
  // short enough that substring-as-you-type is plenty.
  function palette(items) {
    return new Promise((resolve) => {
      const rootEl = root("modal-root");
      const overlay = document.createElement("div");
      overlay.className = "palette-overlay";
      overlay.innerHTML = `<div class="palette" role="dialog" aria-modal="true">
        <input class="palette-input" placeholder="Type a command or search projects…" autocomplete="off" spellcheck="false" />
        <div class="palette-list" role="listbox"></div>
      </div>`;
      rootEl.appendChild(overlay);
      const input = overlay.querySelector(".palette-input");
      const list = overlay.querySelector(".palette-list");
      let filtered = items;
      let active = 0;

      const renderList = () => {
        list.innerHTML = filtered.length
          ? filtered.map((it, i) => `<div class="palette-item${i === active ? " on" : ""}" data-i="${i}" role="option">
              <span class="palette-item-label">${esc(it.label)}</span>
              ${it.hint ? `<span class="palette-item-hint">${esc(it.hint)}</span>` : ""}
            </div>`).join("")
          : `<div class="palette-empty">No matching commands</div>`;
        list.querySelectorAll(".palette-item").forEach((el) => {
          el.onmouseenter = () => { active = Number(el.dataset.i); highlight(); };
          el.onclick = () => choose(Number(el.dataset.i));
        });
      };
      // Re-highlight without a full re-render, so hover/arrow-key movement
      // doesn't rebuild the DOM (and re-trigger :hover) on every keystroke.
      const highlight = () => {
        list.querySelectorAll(".palette-item").forEach((el, i) => el.classList.toggle("on", i === active));
        list.querySelector(".palette-item.on")?.scrollIntoView({ block: "nearest" });
      };
      const filterList = () => {
        const q = input.value.trim().toLowerCase();
        filtered = !q ? items : items.filter((it) => it.label.toLowerCase().includes(q) || it.group?.toLowerCase().includes(q));
        active = 0;
        renderList();
      };

      let closed = false;
      const done = (val) => {
        if (closed) return; closed = true;
        document.removeEventListener("keydown", onKey);
        overlay.classList.remove("in");
        setTimeout(() => overlay.remove(), 150);
        resolve(val);
      };
      const choose = (i) => { const it = filtered[i]; done(it || null); };

      const onKey = (e) => {
        if (e.key === "Escape") { done(null); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); highlight(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); highlight(); }
        else if (e.key === "Enter") { e.preventDefault(); choose(active); }
      };
      document.addEventListener("keydown", onKey);
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) done(null); });
      input.addEventListener("input", filterList);

      renderList();
      requestAnimationFrame(() => { overlay.classList.add("in"); input.focus(); });
    });
  }

  return { toast, modal, confirm, prompt, palette, esc };
})();
