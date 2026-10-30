# Reactive Dropdown Filter — Lit Data Apps

## Use when

When users should be able to slice dashboard charts dynamically (e.g. "Filter by Department", "Select Region", "Timeframe Range").

## Canonical Lit Snippet

```javascript
// 1. Declare reactive state property:
static properties = {
  selectedStatus: { type: String },
};

constructor() {
  super();
  this.selectedStatus = 'All';
}

getEffectiveFilters(local = {}) {
  // MUST spread this.dashboardFilters and this.crossFilters first, or dashboard
  // and cross-filtering silently stops reaching your tiles (see LIT_DATA_APPS.md).
  const filters = { ...(this.dashboardFilters || {}), ...(this.crossFilters || {}) };
  if (this.selectedStatus !== 'All') {
    filters['<VIEW>.<DIMENSION>'] = this.selectedStatus;
  }
  return { ...filters, ...local };
}

// 2. Render dropdown in template:
render() {
  return html`
    <div class="da-filter-bar">
      <app-select
        label="Status"
        .value=${this.selectedStatus}
        .options=${[
          { value: 'All', label: 'All Statuses' },
          { value: 'Complete', label: 'Complete' },
          { value: 'Shipped', label: 'Shipped' },
          { value: 'Processing', label: 'Processing' },
        ]}
        @change=${(e) => { this.selectedStatus = e.detail.value; }}>
      </app-select>
    </div>

    <!-- Bound charts update automatically when selectedStatus changes: -->
    <app-chart
      title="Filtered Performance"
      type="column"
      looker-model="<MODEL>"
      explore="<EXPLORE>"
      .query=${{
        fields: ['<VIEW>.<CATEGORY>', '<VIEW>.<MEASURE>'],
        filters: this.getEffectiveFilters(),
        sorts: ['<VIEW>.<MEASURE> desc'],
        limit: '500'
      }}>
    </app-chart>
  `;
}
```

## Fields to swap

- `selectedStatus` — Reactive property name on the Lit component.
- `<VIEW>.<DIMENSION>` — The LookML dimension field to filter by (e.g. `basic_users.state`).
- `<MODEL>` / `<EXPLORE>` — LookML model and explore.

## Best Practices

- **Place in Header or Toolbar:** Render dropdowns in `.da-filter-bar` or `.da-header`.
- **Pass Filter State to `.query`:** Wire `this.getEffectiveFilters()` directly into chart and grid `.query` properties. When the property mutates, Lit updates bound queries seamlessly without flashing or DOM destruction.
