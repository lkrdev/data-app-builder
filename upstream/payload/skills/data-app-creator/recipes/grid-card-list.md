# Data Grid & Table — Lit Data Apps

## Use when

When displaying structured, high-volume records, orders, user lists, or detail rows using AG Grid.

## Canonical Lit Snippet

```javascript
html`
  <app-grid
    title="<TITLE>"
    looker-model="<MODEL>"
    explore="<EXPLORE>"
    .query=${{
      fields: [
        '<VIEW>.<ID_FIELD>',
        '<VIEW>.<NAME_FIELD>',
        '<VIEW>.<STATUS_FIELD>',
        '<VIEW>.<DATE_FIELD>',
        '<VIEW>.<AMOUNT_FIELD>'
      ],
      filters: this.getEffectiveFilters(),
      sorts: ['<VIEW>.<DATE_FIELD> desc'],
      limit: '1000'
    }}
    .columnDefs=${[
      { field: '<VIEW>.<ID_FIELD>', headerName: 'ID', width: 100 },
      { field: '<VIEW>.<NAME_FIELD>', headerName: 'Customer', flex: 1 },
      { field: '<VIEW>.<STATUS_FIELD>', headerName: 'Status', width: 120 },
      { field: '<VIEW>.<AMOUNT_FIELD>', headerName: 'Amount', valueFormat: 'usd', width: 140 }
    ]}>
  </app-grid>
`
```

## Fields to swap

- `<TITLE>` — Section card header title.
- `<MODEL>` / `<EXPLORE>` — LookML model and explore.
- `<VIEW>.<ID_FIELD>`, `<VIEW>.<NAME_FIELD>`, etc. — LookML fields discovered via explore-model.py.
- `columnDefs` — AG Grid column definitions (`field`, `headerName`, `width`/`flex`) plus `valueFormat` (`usd`, `int`, `percent1`), a runtime-only column extension the grid converts into an AG Grid `valueFormatter`.
