# Category × Bucket Heatmap Grid (AG Grid)

## Use when

A category × discrete-bucket heatmap (e.g. survey category × score 1–4, or cohort × month). Each cell displays dual paired metrics (e.g. Current vs Benchmark, or Primary vs Secondary) with dynamic cell background alpha opacity normalized across each row (highest value in row = full opacity, lower values scale down).

## Snippet

```javascript
html`
  <app-grid
    title="Category × Score Heatmap"
    .query=${{
      model: this.model,
      view: this.explore,
      fields: [
        'survey_score.category',
        'survey_score.top_1', 'survey_score.top_2', 'survey_score.top_3', 'survey_score.top_4',
        'survey_score.bot_1', 'survey_score.bot_2', 'survey_score.bot_3', 'survey_score.bot_4'
      ],
      sorts: ['survey_score.category'],
      limit: '10'
    }}
    .columnDefs=${[
      {
        field: 'survey_score.category',
        headerName: 'Category',
        width: 140,
        pinned: 'left',
        cellStyle: { fontWeight: '600', color: '#0f172a' }
      },
      ...[1, 2, 3, 4].map(score => ({
        headerName: `Score ${score}`,
        flex: 1,
        cellRenderer: (params) => {
          if (!params.data) return '';
          const topVal = Number(params.data[`survey_score.top_${score}`]) || 0;
          const botVal = Number(params.data[`survey_score.bot_${score}`]) || 0;
          
          // Row-max alpha opacity normalization
          const rowValues = [1, 2, 3, 4].map(s => Number(params.data[`survey_score.top_${s}`]) || 0);
          const maxVal = Math.max(...rowValues, 1);
          const alpha = Math.max(0.12, (topVal / maxVal) * 0.45);
          
          return `
            <div style="background: rgba(99, 102, 241, ${alpha.toFixed(2)}); border-radius: 6px; padding: 4px 6px; text-align: center; height: 80%; display: flex; flex-direction: column; justify-content: center;">
              <span style="font-weight: 700; color: #4338ca; font-size: 13px;">${topVal}</span>
              <span style="font-size: 10.5px; color: #64748b;">${botVal}</span>
            </div>
          `;
        }
      }))
    ]}>
  </app-grid>
`
```

## Fields to swap

- `fields`: Category dimension + paired metric measures for each bucket (`top_1..4`, `bot_1..4`).
- Palette: Swap `rgba(99, 102, 241, alpha)` with any brand theme color (e.g. orange `rgba(249, 115, 22, alpha)`).
