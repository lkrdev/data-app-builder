# Custom Layout (free-form opt-in)

**Use when:** the design genuinely isn't a tile grid — a bespoke poster, an
absolutely-positioned canvas, an infographic where elements overlap or sit at
fixed offsets. This is a **deliberate opt-in**. The default is ordinary
responsive CSS (`responsive-layout.md`); reach for absolute positioning only when
neither that nor the coordinate grid (`grid-layout.md`) can express the design.

## The trade-off (know it before you choose)

A free-form layout does not get the grid's automatic reflow. So opting in means:

- **You own responsiveness.** Absolute / fixed-size pieces don't reflow on their
  own — add your own media/container queries if the app must adapt.

If you only need "this tile bigger, that one narrower," that's the grid — use
`cell`, not this.

## Snippet — your own CSS, `bare` widgets inside your own frame

```html
<style>
  .poster { position: relative; min-height: 520px; overflow: hidden; }
  .poster .stat { position: absolute; }            /* your own coordinates */
  .poster .stat.hero  { left: 40px;  top: 40px;  width: 360px; }
  .poster .stat.side  { right: 40px; top: 80px;  width: 300px; }
  @media (max-width: 720px) {                      /* you own the reflow */
    .poster .stat { position: static; width: auto; }
  }
</style>

<div class="poster">
  <div class="stat hero">
    <app-kpi bare label="Total Revenue" query-field="orders.total_revenue" format="usd"
      .filters=${this.getEffectiveFilters()}></app-kpi>
  </div>
  <div class="stat side">
    <app-chart bare type="donut"
      .query=${{ fields: ['orders.status', 'orders.count'] }}
      .filters=${this.getEffectiveFilters()}></app-chart>
  </div>
</div>
```

## Mixing grid + free-form

You don't have to choose globally. Put the dashboard part in a `.da-grid`
(so those tiles stay placed and responsive) and give one tile a custom inner
frame. A composed **hero tile** is exactly this: `cell` on the wrapper for its
place in the grid, and `position: absolute` art *inside* that one tile. See the
`deep-sea-commerce` and `xavier-institute-roster` example apps.

## Fields to swap

- Your own class names (prefix them `.cl-`, `.ops-`, etc. so they can't collide
  with runtime internals) and their positions.
- `query-field` / `.query`, `type`, `format` on the `bare` widgets inside.
