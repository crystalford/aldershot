# 09 — Icon inventory

The design uses **eight** icons, hand-written as inline SVGs on a 24×24 viewBox. There is no icon library and there must not be one — the last build substituted a library's lookalikes and the product read differently.

Copy these strings. Only `width`, `height`, `stroke`, and `fill` vary by context; geometry never does.

## Search

Used: nav search field, Footage search, Clipping ask. Rendered at 14, 15px.

```html
<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
```

## Bell (notifications)

Used: nav only. Rendered at 15px.

```html
<svg width="14" height="14" viewBox="0 0 24 24"><path d="M18 8A6 6 0 006 8c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>
```

## Plus

Used: seam inserts between beats, "add" buttons. Rendered at 13, 15px.

```html
<svg width="14" height="14" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
```

## Pause

Used: player and clip rows. Rendered at 11, 12, 13px.

```html
<svg width="14" height="14" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
```

## Play

Used: player, clip rows, project thumbnails. Rendered at 8, 12, 13, 16px.

```html
<svg width="14" height="14" viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>
```

## Film / source

Used: skipped stretches, source rows. Rendered at 12px.

```html
<svg width="14" height="14" viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="8" rx="2"></rect><line x1="8" y1="8" x2="8" y2="16"></line><line x1="16" y1="8" x2="16" y2="16"></line></svg>
```

## Arrow up

Used: move a block earlier. Rendered at 10, 11px.

```html
<svg width="14" height="14" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
```

## Arrow down

Used: move a block later. Rendered at 10, 11px.

```html
<svg width="14" height="14" viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
```

## Rules

- Stroke icons: `fill="none"`, `stroke-width` 2 at 12–15px, 2.2–2.4 at 10–11px (thinner icons get a heavier stroke so optical weight stays constant). Never scale stroke-width proportionally.
- Fill icons (play/pause): `fill="#131316"` on light buttons, `fill="#fff"` on dark overlays. No stroke.
- The three-bar logo mark is not an icon — it is three `<span>` divs (see `02-DESIGN-SYSTEM.md`).
- No other icons exist. If a feature seems to need one, it is drawn with type or a coloured dot in this design — check the prototype before inventing.
