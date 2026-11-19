const MOCK_SEEDED_INTERACTIONS = {
  v1_app_42_r: {
    id: 'v1_app_42_r',
    environment_id: 'env_42',
    status: 'completed',
    input: [
      {
        type: 'text',
        text: '[THINKING LEVEL: HIGH]\n<USER_MESSAGE>Build an Executive Revenue Data App on order_items with Total Revenue, Total Orders, Avg Order Value KPIs and a Monthly Revenue trend chart.</USER_MESSAGE>',
      },
    ],
  },
  v1_app_42: {
    id: 'v1_app_42',
    previous_interaction_id: 'v1_app_42_r',
    environment_id: 'env_42',
    status: 'completed',
    output_text:
      'Built and published Executive Revenue App (Dashboard #42) with 3 KPI cards and a Highcharts monthly trend chart.',
  },
  v1_native_7_r: {
    id: 'v1_native_7_r',
    environment_id: 'env_42',
    status: 'completed',
    input: [
      {
        type: 'text',
        text: '<USER_MESSAGE>Create a native Looker UDD on order_items with a Total Revenue & Orders KPI, a Revenue by Status column chart, and an Order Status filter.</USER_MESSAGE>',
      },
    ],
  },
  v1_native_7: {
    id: 'v1_native_7',
    previous_interaction_id: 'v1_native_7_r',
    environment_id: 'env_42',
    status: 'completed',
    output_text:
      'Created native Looker Dashboard #7 ("Executive Order Performance") with KPI tile #55 ($14,011,848.92 across 303,454 orders), column chart #56, and Order Status filter #22.\n<NATIVE_CONTENT_BUNDLE>{"id":"7","content_type":"dashboard","title":"Executive Order Performance (Native UDD)","folder_id":"5","tile_count":2,"explores":["thelook::order_items"]}</NATIVE_CONTENT_BUNDLE>',
  },
  v1_lookml_1_r: {
    id: 'v1_lookml_1_r',
    environment_id: 'env_42',
    status: 'completed',
    input: [
      {
        type: 'text',
        text: '<USER_MESSAGE>Add total_revenue and gross_margin measures to orders refinement, curate field descriptions, add a LookML data test, and verify SQL vs Explore parity.</USER_MESSAGE>',
      },
    ],
  },
  v1_lookml_1: {
    id: 'v1_lookml_1',
    previous_interaction_id: 'v1_lookml_1_r',
    environment_id: 'env_42',
    status: 'completed',
    output_text:
      'Used active user dev mode workspace, updated bronze/orders.refinement.lkml, added tests/bronze/orders.test.lkml, verified 0 LookML validation errors, and confirmed 12/12 row parity.',
  },
  v1_health_demo_r: {
    id: 'v1_health_demo_r',
    environment_id: 'env_42',
    status: 'completed',
    input: [
      {
        type: 'text',
        text: '<USER_MESSAGE>Run a full 3-pillar Looker & BigQuery health check on thelook_event.</USER_MESSAGE>',
      },
    ],
  },
  v1_health_demo: {
    id: 'v1_health_demo',
    previous_interaction_id: 'v1_health_demo_r',
    environment_id: 'env_42',
    status: 'completed',
    output_text:
      'Completed 3-Pillar Health Check for thelook_event (Overall Score: 70% B-, Transcriber: 2.86/4.00). Synthesized 7-section TECHNICAL_DESIGN_DOCUMENT.md.',
  },
  v1_tile_demo1_r: {
    id: 'v1_tile_demo1_r',
    environment_id: 'env_42',
    status: 'completed',
    input: [
      {
        type: 'text',
        text: '<USER_MESSAGE>Write a CodeMode script summarizing LookML models and active dashboard filters.</USER_MESSAGE>',
      },
    ],
  },
  v1_tile_demo1: {
    id: 'v1_tile_demo1',
    previous_interaction_id: 'v1_tile_demo1_r',
    environment_id: 'env_42',
    status: 'completed',
    output_text: 'Published Dashboard #8 (load_configuration="wait", layout="extension") and bound tile_element_57 -> demo1.',
  },
  v1_expired_old: {
    __mockError: {
      ok: false,
      status: 404,
      body: JSON.stringify({ error: { message: 'Environment env_old_expired not found (404)' } }),
    },
  },
}

module.exports = { MOCK_SEEDED_INTERACTIONS }
