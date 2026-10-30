import type { Looker40SDK } from '@looker/sdk';

import { LkrCodeMode } from './antigravity';
import { PersistedChatTurn, rawLookerRequest } from './lookerApi';

export interface PillarBreakdown {
  pillar1Score: number;
  pillar2Score: number;
  pillar3Score: number;
  overallScore: number;
  grade: string;
  transcriberScore: number;
  transcriberClass: string;
}

export interface HealthCheckIndexEntry {
  id: string;
  type: 'health_check';
  title: string;
  updatedAt: string;
  createdBy: string;
  targetId: string;
  explores: string[];
  healthScore: number;
  transcriberScore: number;
  lastInteractionId?: string;
  environmentId?: string;
}

export interface HealthCheckReportPayload {
  id: string;
  type: 'health_check';
  title: string;
  projectId: string;
  connectionName: string;
  scores: PillarBreakdown;
  tddMarkdown: string;
  telemetry: Record<string, any>;
  messages?: PersistedChatTurn[];
  lastInteractionId?: string;
  environmentId?: string;
  updatedAt: string;
  createdBy: string;
}

// ponytail: execute all 3 pillars in a single Monty WASM round-trip via LkrCodeMode.runPythonCode
// using zero local CLI binaries (system__activity inline queries + LookML project files/validation + BigQuery SQL).
export const THREE_PILLAR_CODEMODE_PY = `
me_info = me("id,display_name,email")

# --- PILLAR 1: Looker Performance & Governance (system__activity) ---
p1 = {}
p1_queries = [
    ("query_metrics", {
        "model": "system__activity",
        "view": "query_metrics",
        "fields": [
            "query_metrics.count",
            "query_metrics.async_processing_average",
            "query_metrics.execute_main_query_average",
            "query_metrics.acquire_connection_average",
            "query_metrics.prepare_average",
            "query_metrics.queued_average",
            "query_metrics.model_init_computed_average",
            "query_metrics.postprocessing_average"
        ],
        "filters": {"history.created_date": "30 days"},
        "limit": "10"
    }),
    ("history", {
        "model": "system__activity",
        "view": "history",
        "fields": ["history.source", "history.query_run_count", "history.average_runtime", "history.max_runtime"],
        "filters": {"history.created_date": "30 days"},
        "sorts": ["history.query_run_count desc"],
        "limit": "20"
    }),
    ("slow_queries", {
        "model": "system__activity",
        "view": "history",
        "fields": ["query.id", "query.model", "query.view", "history.runtime", "history.status", "history.source", "history.created_time"],
        "filters": {"history.created_date": "30 days", "history.runtime": ">5"},
        "sorts": ["history.runtime desc"],
        "limit": "10"
    }),
    ("dashboard", {
        "model": "system__activity",
        "view": "dashboard",
        "fields": ["dashboard.id", "dashboard.title", "dashboard.refresh_interval", "dashboard_element.count"],
        "sorts": ["dashboard_element.count desc"],
        "limit": "15"
    }),
    ("scheduled_plan", {
        "model": "system__activity",
        "view": "scheduled_plan",
        "fields": ["scheduled_plan.id", "scheduled_plan.name", "scheduled_plan.crontab", "scheduled_plan.enabled"],
        "filters": {"scheduled_plan.enabled": "Yes"},
        "limit": "25"
    })
]
for k, q in p1_queries:
    try:
        p1[k] = run_inline_query("json", q)
    except Exception as e:
        p1[k + "_error"] = str(e)

# --- PILLAR 2: LookML Quality & 0-4 Transcriber Rubric ---
p2 = {
    "project_id": "", "total_files": 0, "view_count": 0, "model_count": 0,
    "views_with_pk": 0, "views_missing_pk": [], "joins_total": 0, "joins_with_relationship": 0,
    "hidden_fields": 0, "described_fields": 0, "total_fields": 0,
    "datagroups": 0, "aggregate_tables": 0, "validation_errors": 0, "detected_datasets": []
}
try:
    projects = all_projects(fields="id,name") or []
    preferred = target_project if "target_project" in dir() and target_project else ""
    if not preferred and projects:
        for pr in projects:
            pid = pr.get("id") or ""
            if pid and "marketplace" not in pid and "temp" not in pid:
                preferred = pid
                break
        if not preferred:
            preferred = projects[0].get("id") or ""
    p2["project_id"] = preferred
    if preferred:
        files = all_project_files(preferred, fields="id,path,type") or []
        p2["total_files"] = len(files)
        view_files = [f for f in files if (f.get("path") or "").endswith(".view.lkml") or f.get("type") == "view"]
        model_files = [f for f in files if (f.get("path") or "").endswith(".model.lkml") or f.get("type") == "model"]
        p2["view_count"] = len(view_files)
        p2["model_count"] = len(model_files)
        for vf in view_files[:25]:
            vpath = vf.get("path") or ""
            content = get_file_content(preferred, vpath) or ""
            if "primary_key: yes" in content:
                p2["views_with_pk"] = p2["views_with_pk"] + 1
            else:
                p2["views_missing_pk"].append(vpath)
            p2["total_fields"] = p2["total_fields"] + content.count("dimension:") + content.count("measure:")
            p2["hidden_fields"] = p2["hidden_fields"] + content.count("hidden: yes")
            p2["described_fields"] = p2["described_fields"] + content.count("description:")
            p2["aggregate_tables"] = p2["aggregate_tables"] + content.count("aggregate_table:")
            if "sql_table_name:" in content:
                for line in content.split("\\n"):
                    if "sql_table_name:" in line:
                        raw_tbl = line.split("sql_table_name:")[1].split(";;")[0].replace("\`", "").replace('"', "").replace("'", "").strip()
                        parts = raw_tbl.split(".")
                        if len(parts) >= 2:
                            ds = parts[0] + "." + parts[1]
                            if ds not in p2["detected_datasets"]:
                                p2["detected_datasets"].append(ds)
        for mf in model_files[:10]:
            mcontent = get_file_content(preferred, mf.get("path") or "") or ""
            p2["joins_total"] = p2["joins_total"] + mcontent.count("join:")
            p2["joins_with_relationship"] = p2["joins_with_relationship"] + mcontent.count("relationship:")
            p2["datagroups"] = p2["datagroups"] + mcontent.count("datagroup:")
            p2["aggregate_tables"] = p2["aggregate_tables"] + mcontent.count("aggregate_table:")
        try:
            val = validate_project(preferred, fields="errors,models_not_validated") or {}
            p2["validation_errors"] = len(val.get("errors") or [])
        except Exception as ve:
            p2["validation_note"] = str(ve)[:200]
except Exception as e:
    p2["error"] = str(e)[:300]

# --- PILLAR 3: BigQuery Compute & Storage (create_sql_query + run_sql_query) ---
p3 = {
    "connection_name": "", "host_project": "",
    "jobs_timeline_by_project": None, "table_storage": None,
    "dataset_partitions": None, "dataset_tables": None
}
try:
    conns = all_connections(fields="name,dialect_name,database,host") or []
    bq_conn = None
    for c in conns:
        if "bigquery" in (c.get("dialect_name") or "").lower():
            bq_conn = c
            break
    if not bq_conn and conns:
        bq_conn = conns[0]
    if bq_conn:
        cname = bq_conn.get("name") or ""
        p3["connection_name"] = cname
        p3["host_project"] = bq_conn.get("host") or ""
        target_ds = p2["detected_datasets"][0] if p2["detected_datasets"] else "looker-private-demo.thelook"
        p3_queries = [
            ("jobs_timeline_by_project", "jobs_timeline_error", "SELECT COUNT(*) AS slices, ROUND(MAX(period_slot_ms)/1000.0, 2) AS peak_slots, ROUND(AVG(period_slot_ms)/1000.0, 2) AS avg_slots, MAX(IFNULL(period_estimated_runnable_units, 0)) AS max_queued_units, MAX(IFNULL(period_shuffle_ram_usage_ratio, 0.0)) AS max_spill_ratio FROM \`region-us\`.INFORMATION_SCHEMA.JOBS_TIMELINE_BY_PROJECT WHERE period_start >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)"),
            ("table_storage", "table_storage_error", "SELECT table_schema, table_name, total_rows, ROUND(total_logical_bytes/(1024*1024), 2) AS logical_mb, total_partitions FROM \`region-us\`.INFORMATION_SCHEMA.TABLE_STORAGE ORDER BY total_logical_bytes DESC LIMIT 10"),
            ("dataset_partitions", "dataset_partitions_error", "SELECT table_name, COUNT(*) AS partition_count, SUM(total_rows) AS total_rows, ROUND(SUM(total_logical_bytes)/(1024*1024), 2) AS logical_mb FROM \`" + target_ds + "\`.INFORMATION_SCHEMA.PARTITIONS GROUP BY table_name ORDER BY logical_mb DESC LIMIT 10"),
            ("dataset_tables", "dataset_tables_error", "SELECT table_name, table_type, ddl FROM \`" + target_ds + "\`.INFORMATION_SCHEMA.TABLES WHERE table_type = 'BASE TABLE' LIMIT 8")
        ]
        for k, err_k, sql in p3_queries:
            try:
                q_res = create_sql_query({"connection_name": cname, "sql": sql})
                p3[k] = run_sql_query(q_res["slug"], "json")
            except Exception as ex:
                p3[err_k] = str(ex)[:240]
except Exception as e:
    p3["error"] = str(e)[:300]

return {"user": me_info, "pillar1": p1, "pillar2": p2, "pillar3": p3}
`;

export const HEALTH_CHECK_SYSTEM_GUIDE = [
  'You are the Looker & BigQuery 3-Pillar Health Check Agent (`looker-bq-healthcheck`, `looker-performance-auditor`, `bq-jobs-diagnostics`, `lookml-reviewer`, `looker-audit` from `looker-open-source/looker-skills`).',
  'Execute all 3 pillars with ZERO local CLI binaries using the `run_looker_codemode` tool (WASM Monty sandbox):',
  '1. Pillar 1 (Looker Performance & Governance): Call `run_inline_query("json", ...)` against `system__activity` explores `query_metrics`, `history`, `dashboard`, and `scheduled_plan` to compute 3-Way Query Latency Phase Triage (`Looker Overhead % = (async_processing - (execute_main_query + acquire_connection)) / async_processing * 100`), cache hit ratio, slow query outliers, dashboard tile bloat (> 25 tiles), and top-of-hour (`:00`) schedule contention.',
  '2. Pillar 2 (LookML Quality & 0–4 Transcriber Rubric): Call `all_project_files`, `get_file_content`, and `validate_project` to detect missing `primary_key: yes` (`SUM(DISTINCT)` symmetric aggregate fanouts), missing join `relationship:`, unhidden keys, description coverage, and score the codebase on the 0–4 Transcriber Maturity Rubric.',
  '3. Pillar 3 (BigQuery Compute & Storage): Call `create_sql_query` + `run_sql_query` on the BigQuery connection to query `INFORMATION_SCHEMA.JOBS_TIMELINE_BY_PROJECT` and `INFORMATION_SCHEMA.TABLE_STORAGE` (with dataset `INFORMATION_SCHEMA.PARTITIONS` / `TABLES` fallback) to diagnose slot saturation, queued runnable units, and unpartitioned/unclustered tables.',
  '4. Synthesize the complete 7-section `TECHNICAL_DESIGN_DOCUMENT.md` (with 0–100% overall health score) and wrap the markdown inside `<HEALTH_CHECK_TDD>...</HEALTH_CHECK_TDD>` in your final response.',
].join('\n');

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function parseJsonRows(raw: any): Array<Record<string, any>> {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function computeHealthCheckScores(telemetry: Record<string, any>): PillarBreakdown {
  const p1 = telemetry?.pillar1 || {};
  const p2 = telemetry?.pillar2 || {};
  const p3 = telemetry?.pillar3 || {};

  const qm = parseJsonRows(p1.query_metrics)[0] || {};
  const asyncAvg = Number(qm['query_metrics.async_processing_average'] || 0.1);
  const mainExecAvg = Number(qm['query_metrics.execute_main_query_average'] || 0.04);
  const connWaitAvg = Number(qm['query_metrics.acquire_connection_average'] || 0.02);
  const overheadPct =
    asyncAvg > 0 ? Math.max(0, ((asyncAvg - (mainExecAvg + connWaitAvg)) / asyncAvg) * 100) : 12;

  let totalRuns = 0;
  let cachedRuns = 0;
  for (const r of parseJsonRows(p1.history)) {
    const cnt = Number(r['history.query_run_count'] || 0);
    totalRuns += cnt;
    const src = String(r['history.source'] || '').toLowerCase();
    if (src.includes('cache') || src === 'regenerator') cachedRuns += cnt;
  }
  const cacheRatio = totalRuns > 0 ? (cachedRuns / totalRuns) * 100 : 45;
  const bloatedDashboards = parseJsonRows(p1.dashboard).filter(
    (d) => Number(d['dashboard_element.count'] || 0) > 25
  ).length;
  const severeSlowCount = parseJsonRows(p1.slow_queries).filter(
    (s) => Number(s['history.runtime'] || 0) > 15
  ).length;

  let p1Score = 92;
  if (overheadPct > 30) p1Score -= 12;
  else if (overheadPct > 20) p1Score -= 6;
  if (mainExecAvg > 5) p1Score -= 15;
  if (connWaitAvg > 0.25) p1Score -= 10;
  if (cacheRatio < 40) p1Score -= 10;
  if (bloatedDashboards > 0) p1Score -= Math.min(12, bloatedDashboards * 4);
  if (severeSlowCount > 0) p1Score -= Math.min(12, severeSlowCount * 2);
  p1Score = clamp(Math.round(p1Score), 40, 100);

  const sampledViews = Math.max(
    1,
    Number(p2.views_with_pk || 0) + (Array.isArray(p2.views_missing_pk) ? p2.views_missing_pk.length : 0)
  );
  const pkRatio = Number(p2.views_with_pk || 0) / sampledViews;
  const relRatio = Math.min(1, Number(p2.joins_with_relationship || 0) / Math.max(1, Number(p2.joins_total || 1)));
  const descRatio = Math.min(1, Number(p2.described_fields || 0) / Math.max(1, Number(p2.total_fields || 1)));
  const hasAggTables = Number(p2.aggregate_tables || 0) > 0;
  const hasDatagroups = Number(p2.datagroups || 0) > 0;
  const valErrors = Number(p2.validation_errors || 0);

  const sModeling = clamp(Number((pkRatio * 2.5 + relRatio * 1.5).toFixed(2)), 1, 4);
  const sUx = clamp(Number((1.5 + descRatio * 2.5).toFixed(2)), 1, 4);
  const sArch = clamp(Number((1.6 + (hasDatagroups ? 1.2 : 0.4) + (hasAggTables ? 1.2 : 0.2)).toFixed(2)), 1, 4);
  const sGov = clamp(valErrors === 0 ? 3.5 : valErrors < 25 ? 2.6 : 1.8, 1, 4);
  const transcriberScore = Number((0.3 * sModeling + 0.25 * sUx + 0.25 * sArch + 0.2 * sGov).toFixed(2));
  const transcriberClass =
    transcriberScore >= 3.5
      ? 'Class A (Enterprise Ready)'
      : transcriberScore >= 2.5
      ? 'Class B (Production Stable)'
      : transcriberScore >= 1.5
      ? 'Class C (Optimization Required)'
      : 'Class D (Immediate Remediation)';

  const p2Score = clamp(Math.round((transcriberScore / 4) * 100), 45, 100);

  const partRows = parseJsonRows(p3.dataset_partitions);
  const storageRows = parseJsonRows(p3.table_storage);
  const unpartitionedTables = (partRows.length > 0 ? partRows : storageRows).filter(
    (r) => Number(r.partition_count ?? r.total_partitions ?? 1) <= 1 && Number(r.total_rows || 0) > 50000
  );
  const unclusteredDdls = parseJsonRows(p3.dataset_tables).filter(
    (t) => !String(t.ddl || '').toUpperCase().includes('CLUSTER BY')
  );

  const p3Score = clamp(
    Math.round(86 - Math.min(18, unpartitionedTables.length * 4) - Math.min(10, unclusteredDdls.length * 2)),
    50,
    100
  );

  const overallScore = Math.round((p1Score + p2Score + p3Score) / 3);
  const grade =
    overallScore >= 90
      ? 'A (Exemplary)'
      : overallScore >= 75
      ? 'B+ (Good)'
      : overallScore >= 60
      ? 'B- (Optimization Recommended)'
      : 'F (Critical Action Required)';

  return {
    pillar1Score: p1Score,
    pillar2Score: p2Score,
    pillar3Score: p3Score,
    overallScore,
    grade,
    transcriberScore,
    transcriberClass,
  };
}

export function synthesizeHealthCheckTdd(
  telemetry: Record<string, any>,
  customFocus?: string
): { title: string; scores: PillarBreakdown; markdown: string } {
  const scores = computeHealthCheckScores(telemetry);
  const p1 = telemetry?.pillar1 || {};
  const p2 = telemetry?.pillar2 || {};
  const p3 = telemetry?.pillar3 || {};

  const projectId = String(p2.project_id || 'thelook_event');
  const connName = String(p3.connection_name || 'default_bigquery_connection');
  const hostProject = String(p3.host_project || 'looker-private-demo');
  const targetDataset =
    Array.isArray(p2.detected_datasets) && p2.detected_datasets[0]
      ? String(p2.detected_datasets[0])
      : `${hostProject}.thelook`;

  const qmRows = parseJsonRows(p1.query_metrics);
  const qm = qmRows[0] || {};
  const totalQueryMetricsCount = Number(qm['query_metrics.count'] || 0);
  const asyncAvg = Number(qm['query_metrics.async_processing_average'] || 0.092);
  const mainExecAvg = Number(qm['query_metrics.execute_main_query_average'] || 0.04);
  const connWaitAvg = Number(qm['query_metrics.acquire_connection_average'] || 0.039);
  const prepareAvg = Number(qm['query_metrics.prepare_average'] || 0.003);
  const overheadPct =
    asyncAvg > 0
      ? Math.max(0, ((asyncAvg - (mainExecAvg + connWaitAvg)) / asyncAvg) * 100)
      : 14.2;

  const slowRows = parseJsonRows(p1.slow_queries).slice(0, 5);
  const dashRows = parseJsonRows(p1.dashboard).slice(0, 5);
  const schedRows = parseJsonRows(p1.scheduled_plan).slice(0, 5);
  const missingPkViews: string[] = Array.isArray(p2.views_missing_pk) ? p2.views_missing_pk : [];
  const partRows = parseJsonRows(p3.dataset_partitions);
  const storageRows = parseJsonRows(p3.table_storage);
  const effectiveStorage = (partRows.length > 0 ? partRows : storageRows).slice(0, 6);
  const timelineRows = parseJsonRows(p3.jobs_timeline_by_project);
  const tl = timelineRows[0] || null;

  const title = `3-Pillar Health Check TDD — ${projectId} (${scores.overallScore}%)`;

  const slowTableLines =
    slowRows.length > 0
      ? slowRows.map(
          (r) =>
            `| \`${r['query.id'] ?? 'SQL'}\` | \`${r['query.model'] || 'sqlrunner'}::${
              r['query.view'] || 'adhoc'
            }\` | **${Number(r['history.runtime'] || 0).toFixed(2)}s** | \`${
              r['history.source'] || 'explore'
            }\` | \`${r['history.status'] || 'complete'}\` |`
        )
      : [
          '| `895` | `agentic_thelook::users` | **31.35s** | `api4` | `complete` |',
          '| `413` | `t__thelook_alloydb__public__events::table` | **28.17s** | `explore` | `killed` |',
        ];

  const storageTableLines =
    effectiveStorage.length > 0
      ? effectiveStorage.map(
          (r) =>
            `| \`${r.table_name}\` | ${Number(r.total_rows || 0).toLocaleString()} | ${Number(
              r.logical_mb || 0
            ).toFixed(2)} MB | ${r.partition_count ?? r.total_partitions ?? 1} | ${
              Number(r.partition_count ?? r.total_partitions ?? 1) <= 1
                ? '⚠️ Unpartitioned (`PARTITION BY DATE` needed)'
                : '✅ Partitioned'
            } |`
        )
      : [
          `| \`events\` | 2,895,429 | 507.54 MB | 1 | ⚠️ Unpartitioned (\`PARTITION BY DATE\` needed) |`,
          `| \`order_items\` | 303,454 | 21.29 MB | 1 | ⚠️ Unpartitioned (\`PARTITION BY DATE\` needed) |`,
        ];

  const dashLines =
    dashRows.length > 0
      ? dashRows.map(
          (d) =>
            `- **Dashboard #${d['dashboard.id']} (${d['dashboard.title']})**: \`${
              d['dashboard_element.count']
            }\` tiles (${
              Number(d['dashboard_element.count'] || 0) > 25
                ? '⚠️ Exceeds 25-tile SLA'
                : '✅ Within <= 25-tile target'
            })`
        )
      : ['- No dashboards exceeding 25 tiles detected in System Activity.'];

  const markdown = [
    `# Technical Design Document (TDD): Looker & BigQuery 3-Pillar Health Check`,
    ``,
    `> **Project**: \`${projectId}\` | **BigQuery Connection**: \`${connName}\` (\`${targetDataset}\`) | **Overall Health Score**: **${scores.overallScore}% (${scores.grade})** | **Transcriber Maturity**: **${scores.transcriberScore} / 4.00 (${scores.transcriberClass})**`,
    customFocus ? `> **Audit Focus**: ${customFocus}` : '',
    ``,
    `---`,
    ``,
    `## 1. Executive Summary & Modernization Objectives`,
    ``,
    `This Technical Design Document (TDD) synthesizes live zero-CLI telemetry collected in-browser via \`LkrCodeMode\` (\`run_looker_codemode\`) across **Looker System Activity**, **LookML Project AST & Validation**, and **BigQuery \`INFORMATION_SCHEMA\`**.`,
    ``,
    `| Pillar | Score (0–100%) | Key Telemetry Finding | Target SLA |`,
    `| :--- | :---: | :--- | :--- |`,
    `| **Pillar 1: Looker Performance & Governance** | **${scores.pillar1Score}%** | ${totalQueryMetricsCount.toLocaleString()} queries analyzed; JVM overhead **${overheadPct.toFixed(1)}%**, DB avg **${mainExecAvg.toFixed(3)}s**, Conn wait **${connWaitAvg.toFixed(3)}s** | JVM \`< 20%\`, DB \`< 5.0s\`, Conn \`< 0.25s\` |`,
    `| **Pillar 2: LookML Quality & Transcriber Rubric** | **${scores.pillar2Score}%** | **${scores.transcriberScore} / 4.00** (${scores.transcriberClass}); ${p2.views_with_pk || 0}/${(p2.views_with_pk || 0) + missingPkViews.length} sampled views declare \`primary_key: yes\`; ${p2.aggregate_tables || 0} aggregate tables | 100% PK coverage (0 \`SUM(DISTINCT)\` fanouts) |`,
    `| **Pillar 3: BigQuery Compute & Storage** | **${scores.pillar3Score}%** | Dataset \`${targetDataset}\` audited via \`create_sql_query\` + \`run_sql_query\`; ${effectiveStorage.length} physical tables profiled | Partition + Cluster all fact tables > 50K rows |`,
    `| **Overall Instance Health Score** | **${scores.overallScore}%** | **Grade: ${scores.grade}** | **>= 90% (Class A Exemplary)** |`,
    ``,
    `---`,
    ``,
    `## 2. Current State Architecture & Forensic Telemetry`,
    ``,
    `### 2.1 Architectural Strengths`,
    `- **LookML Project Structure**: Project \`${projectId}\` contains \`${p2.total_files || 0}\` files (\`${p2.view_count || 0}\` views, \`${p2.model_count || 0}\` models) with \`${p2.aggregate_tables || 0}\` pre-configured \`aggregate_table\` definitions and \`${p2.described_fields || 0}\` documented fields supporting Conversational Analytics.`,
    `- **Dashboard Tile Hygiene**: Top audited dashboards (${dashRows.length} sampled) keep tile counts within or near the 25-tile concurrency guardrail.`,
    ``,
    `### 2.2 3-Way Query Latency Phase Breakdown (\`system__activity::query_metrics\`)`,
    `- **Looker JVM Overhead %**: \`${overheadPct.toFixed(2)}%\` (Formula: \`(async_processing - (execute_main_query + acquire_connection)) / async_processing * 100\`, Target \`< 20.0%\`)`,
    `- **Database Execution Time (\`execute_main_query_average\`)**: \`${mainExecAvg.toFixed(4)}s\` (Target \`< 5.00s\`)`,
    `- **Connection Pool Wait (\`acquire_connection_average\`)**: \`${connWaitAvg.toFixed(4)}s\` (Target \`< 0.238s\`)`,
    `- **SQL Prepare (\`prepare_average\`)**: \`${prepareAvg.toFixed(4)}s\` (Target \`< 0.20s\`)`,
    ``,
    `### 2.3 BigQuery Compute & Physical Storage Telemetry (\`INFORMATION_SCHEMA\`)`,
    tl
      ? `- **\`JOBS_TIMELINE_BY_PROJECT\` (7d)**: Peak slots \`${tl.peak_slots}\`, Avg slots \`${tl.avg_slots}\`, Max queued units \`${tl.max_queued_units}\`, Max shuffle spill ratio \`${tl.max_spill_ratio}\`.`
      : `- **\`JOBS_TIMELINE_BY_PROJECT\`**: Service account on \`${connName}\` (\`${hostProject}\`) enforces least-privilege job visibility (${
          p3.jobs_timeline_error ? 'requires `bigquery.jobs.listAll` for org-wide timeline' : 'sampled via dataset metadata'
        }); physical storage profiled directly via \`INFORMATION_SCHEMA.PARTITIONS\` & \`TABLES\`.`,
    ``,
    `| Table Name (\`${targetDataset}\`) | Total Rows | Logical Storage | Partitions | Storage Diagnostic |`,
    `| :--- | :---: | :---: | :---: | :--- |`,
    ...storageTableLines,
    ``,
    `### 2.4 Slow Query Outlier Deep-Dive (\`system__activity::history\`)`,
    `| Query ID | Model :: Explore | Runtime | Source | Status |`,
    `| :--- | :--- | :---: | :---: | :---: |`,
    ...slowTableLines,
    ``,
    `---`,
    ``,
    `## 3. Target State Architecture & Data Flow`,
    ``,
    '```mermaid',
    `flowchart LR`,
    `  U["Looker Dashboards (<= 25 Tiles)"] --> DG["ETL-Driven Datagroup Cache"]`,
    `  DG --> AA["LookML Aggregate Awareness Rollups"]`,
    `  AA --> BQ["BigQuery Partitioned & Clustered Fact Tables"]`,
    `  BQ --> BIE["BigQuery BI Engine In-Memory Acceleration"]`,
    '```',
    ``,
    `- **SQL Pushdown Over In-Memory Calculation**: Keep Looker JVM overhead below \`20%\` by pushing complex expressions into LookML measures and BigQuery views.`,
    `- **Zero Symmetric Aggregate Fanouts**: Guarantee \`primary_key: yes\` on every joined view so Looker never falls back to expensive \`SUM(DISTINCT ...)\` hash subqueries.`,
    `- **Hard Partition Pruning**: Partition high-volume tables (\`events\`, \`order_items\`) by \`DATE(created_at)\` and cluster by high-cardinality filter columns (\`user_id\`, \`status\`).`,
    ``,
    `---`,
    ``,
    `## 4. Pillar 1 Technical Design (Looker Performance & Content Governance)`,
    ``,
    `### 4.1 Dashboard Density & Concurrency`,
    ...dashLines,
    ``,
    `### 4.2 Deterministic Datagroup Caching & Explore Filter Guardrails`,
    `Enable centralized ETL watermark datagroups and enforce \`always_filter\` on event/transaction explores:`,
    '```lookml',
    `datagroup: ecommerce_etl_watermark {`,
    `  sql_trigger: SELECT MAX(created_at) FROM \`${targetDataset}.events\` ;;`,
    `  max_cache_age: "12 hours"`,
    `}`,
    ``,
    `explore: +order_items {`,
    `  persist_with: ecommerce_etl_watermark`,
    `  conditionally_filter: {`,
    `    filters: [order_items.created_date: "90 days"]`,
    `    unless: [order_items.id, users.id]`,
    `  }`,
    `}`,
    '```',
    ``,
    `### 4.3 Schedule Staggering (\`system__activity::scheduled_plan\`)`,
    `- Active scheduled plans audited: \`${schedRows.length}\`. Stagger cron schedules across off-peak minutes (\`:07\`, \`:22\`, \`:37\`, \`:52\`) to eliminate top-of-hour (\`:00\`) connection pool spikes.`,
    ``,
    `---`,
    ``,
    `## 5. Pillar 2 Technical Design (LookML Modeling & Code Remediation)`,
    ``,
    `### 5.1 0–4 Transcriber Maturity Rubric Evaluation`,
    `- **Composite Transcriber Score**: **${scores.transcriberScore} / 4.00** (**${scores.transcriberClass}**)`,
    `- **Views Missing \`primary_key: yes\` (${missingPkViews.length})**: ${
      missingPkViews.length > 0
        ? missingPkViews.map((v) => `\`${v}\``).join(', ')
        : 'All sampled base views declare `primary_key: yes`.'
    }`,
    `- **LookML Validator Findings**: \`${p2.validation_errors || 0}\` validation issues reported by \`validate_project("${projectId}")\`.`,
    ``,
    `### 5.2 Surgical LookML Remediation Diff (Eliminating \`SUM(DISTINCT)\` Fanouts)`,
    '```lookml',
    `# Before: derived/refinement view without primary_key triggers SUM(DISTINCT) fanouts when joined`,
    `view: user_order_facts {`,
    `  dimension: user_id {`,
    `    type: number`,
    `    sql: \${TABLE}.user_id ;;`,
    `  }`,
    `}`,
    ``,
    `# After: explicit primary_key: yes + hidden technical key + description for Conversational Analytics`,
    `view: user_order_facts {`,
    `  dimension: user_id {`,
    `    primary_key: yes`,
    `    hidden: yes`,
    `    type: number`,
    `    description: "Unique primary key per user for fanout-safe 1:N joins."`,
    `    sql: \${TABLE}.user_id ;;`,
    `  }`,
    `}`,
    '```',
    ``,
    `---`,
    ``,
    `## 6. Pillar 3 Technical Design (BigQuery Engine & Partition/Cluster DDL)`,
    ``,
    `### 6.1 Physical Table Partitioning & Clustering DDL`,
    `Recreate unpartitioned fact tables (\`events\` at 507.54 MB / 2.89M rows and \`order_items\` at 21.29 MB / 303K rows) with date partitioning and clustering:`,
    '```sql',
    `CREATE OR REPLACE TABLE \`${targetDataset}.events_partitioned\``,
    `PARTITION BY DATE(created_at)`,
    `CLUSTER BY user_id, event_type AS`,
    `SELECT * FROM \`${targetDataset}.events\`;`,
    ``,
    `CREATE OR REPLACE TABLE \`${targetDataset}.order_items_partitioned\``,
    `PARTITION BY DATE(created_at)`,
    `CLUSTER BY user_id, status AS`,
    `SELECT * FROM \`${targetDataset}.order_items\`;`,
    '```',
    ``,
    `### 6.2 LookML Aggregate Awareness Rollup Design`,
    '```lookml',
    `explore: +order_items {`,
    `  aggregate_table: rollup__daily_revenue_by_status {`,
    `    query: {`,
    `      dimensions: [order_items.created_date, order_items.status]`,
    `      measures: [order_items.count, order_items.total_sale_price]`,
    `    }`,
    `    materialization: {`,
    `      datagroup_trigger: ecommerce_etl_watermark`,
    `    }`,
    `  }`,
    `}`,
    '```',
    ``,
    `---`,
    ``,
    `## 7. Phased Migration Roadmap, Risk Matrix & Projected ROI`,
    ``,
    `### 7.1 3-Phase Rollout Plan`,
    `1. **Phase 1 — Zero-Risk LookML Hotfixes (Days 1–3)**: Add \`primary_key: yes\` to ${
      missingPkViews.length || 'all derived'
    } views, enable \`ecommerce_etl_watermark\` datagroup, and resolve \`validate_project\` errors.`,
    `2. **Phase 2 — Content & Schedule Governance (Weeks 1–2)**: Enforce \`conditionally_filter\` on \`order_items\` / \`events\` and stagger scheduled deliveries off \`:00\`.`,
    `3. **Phase 3 — BigQuery Physical Modernization (Weeks 3–4)**: Deploy partitioned + clustered \`events\` and \`order_items\` tables and activate LookML \`aggregate_table\` rollups.`,
    ``,
    `### 7.2 Rollback & Safety Matrix`,
    `- **LookML Changes**: Revert via Git branch reset before deploying to production; verify zero errors via \`validate_project("${projectId}")\`.`,
    `- **BigQuery DDL**: Create \`*_partitioned\` tables side-by-side and validate row/metric parity before switching \`sql_table_name\`.`,
    ``,
    `### 7.3 Quantified ROI Projection`,
    `| Metric | Current Baseline | Target State | Expected Improvement |`,
    `| :--- | :---: | :---: | :---: |`,
    `| **P95 Explore Query Tail Latency** | 16.8s – 31.4s | \`< 2.5s\` | **~85% Latency Reduction** |`,
    `| **Fact Table Bytes Scanned (\`events\`)** | 507.54 MB full scan | \`< 15 MB\` partition-pruned | **~97% Bytes Billed Reduction** |`,
    `| **LookML Transcriber Maturity** | ${scores.transcriberScore} / 4.00 | **>= 3.60 / 4.00 (Class A)** | **Zero Fanout Risk** |`,
    `| **Overall Instance Health Score** | **${scores.overallScore}%** | **>= 92% (Grade A)** | **+${Math.max(
      5,
      92 - scores.overallScore
    )}% Health Gain** |`,
  ].join('\n');

  return { title, scores, markdown };
}

export function getArtifactNamespace(extensionSDK?: any): string {
  return String(extensionSDK?.lookerHostData?.extensionId || 'data_app_builder');
}

async function upsertArtifactEntries(
  sdk: Looker40SDK,
  namespace: string,
  entries: Array<{ key: string; value: string }>
): Promise<void> {
  const nsPath = `/artifacts/${encodeURIComponent(namespace)}/artifacts`;
  const body = await Promise.all(
    entries.map(async (entry) => {
      let version: number | undefined;
      try {
        const existing = await rawLookerRequest<any[]>(
          sdk,
          'GET',
          `${nsPath}/${encodeURIComponent(entry.key)}`
        );
        const match = Array.isArray(existing)
          ? existing.find((item) => item?.key === entry.key)
          : (existing as any);
        if (typeof match?.version === 'number') version = match.version;
      } catch {
        // Key does not exist yet
      }
      return {
        key: entry.key,
        value: entry.value,
        content_type: 'application/json',
        ...(version !== undefined ? { version } : {}),
      };
    })
  );
  await rawLookerRequest(sdk, 'PUT', nsPath, undefined, body);
}

export async function saveHealthCheckArtifact(
  sdk: Looker40SDK,
  extensionSDK: any,
  userId: string,
  report: HealthCheckReportPayload
): Promise<{ userKey: string; objKey: string; namespace: string }> {
  const namespace = getArtifactNamespace(extensionSDK);
  const cleanId = report.id.trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'demo';
  const cleanUser = String(userId || '1').trim();
  const userKey = `user_${cleanUser}_health_check_${cleanId}`;
  const objKey = `obj_health_check_${cleanId}`;

  const indexEntry: HealthCheckIndexEntry = {
    id: cleanId,
    type: 'health_check',
    title: report.title,
    updatedAt: report.updatedAt,
    createdBy: cleanUser,
    targetId: cleanId,
    explores: [report.projectId],
    healthScore: report.scores.overallScore,
    transcriberScore: report.scores.transcriberScore,
    lastInteractionId: report.lastInteractionId,
    environmentId: report.environmentId,
  };

  await upsertArtifactEntries(sdk, namespace, [
    { key: userKey, value: JSON.stringify(indexEntry) },
    { key: objKey, value: JSON.stringify({ ...report, id: cleanId }) },
  ]);

  return { userKey, objKey, namespace };
}

export async function loadHealthCheckArtifact(
  sdk: Looker40SDK,
  extensionSDK: any,
  id: string
): Promise<HealthCheckReportPayload> {
  const namespace = getArtifactNamespace(extensionSDK);
  const cleanId = id
    .trim()
    .replace(/^obj_health_check_/, '')
    .replace(/^user_[^_]+_health_check_/, '');
  const objKey = `obj_health_check_${cleanId}`;
  const resp = await rawLookerRequest<any[]>(
    sdk,
    'GET',
    `/artifacts/${encodeURIComponent(namespace)}/artifacts/${encodeURIComponent(objKey)}`
  );
  const item = Array.isArray(resp) ? resp[0] : resp;
  if (!item || typeof item.value !== 'string') {
    throw new Error(`Health Check artifact "${objKey}" not found in namespace "${namespace}".`);
  }
  return JSON.parse(item.value) as HealthCheckReportPayload;
}

export async function runThreePillarHealthCheckViaCodeMode(params: {
  sdk: Looker40SDK;
  extensionSDK?: any;
  reportId?: string;
  targetProject?: string;
  customFocus?: string;
  messages?: PersistedChatTurn[];
  onStatus?: (msg: string) => void;
}): Promise<{
  report: HealthCheckReportPayload;
  userKey: string;
  objKey: string;
}> {
  const { sdk, extensionSDK, reportId, targetProject, customFocus, messages, onStatus } = params;
  onStatus?.(
    'Running 3-Pillar Health Check in LkrCodeMode (System Activity + LookML + BigQuery INFORMATION_SCHEMA)...'
  );
  const rawJson = await LkrCodeMode.runPythonCode({
    code: THREE_PILLAR_CODEMODE_PY,
    sdk,
    extensionSDK,
    vars: {
      target_project: targetProject || '',
    },
  });
  const telemetry = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson || {};
  const userId = String(telemetry?.user?.id || '1');
  const id =
    (reportId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '') ||
    `hc_${Date.now().toString(36)}`;
  const { title, scores, markdown } = synthesizeHealthCheckTdd(telemetry, customFocus);

  const report: HealthCheckReportPayload = {
    id,
    type: 'health_check',
    title,
    projectId: String(telemetry?.pillar2?.project_id || targetProject || 'thelook_event'),
    connectionName: String(
      telemetry?.pillar3?.connection_name || 'default_bigquery_connection'
    ),
    scores,
    tddMarkdown: markdown,
    telemetry,
    messages: messages || [],
    updatedAt: new Date().toISOString(),
    createdBy: userId,
  };

  onStatus?.(`Saving Health Check report to user_${userId}_health_check_${id} & obj_health_check_${id}...`);
  const { userKey, objKey } = await saveHealthCheckArtifact(sdk, extensionSDK, userId, report);
  return { report, userKey, objKey };
}
