import React, { useState } from 'react'
import type { Looker40SDK } from '@looker/sdk'
import { PersistedChatTurn, rawLookerRequest } from './lookerApi'

export interface LookmlFileChange {
  path: string
  action?: 'created' | 'updated' | 'deleted'
  content?: string
  diff?: string
}

export interface LookmlValidationError {
  message: string
  file_path?: string
  line_number?: number
  severity?: string
}

export interface LookmlValidationResult {
  passed: boolean
  error_count?: number
  errors?: LookmlValidationError[]
}

export interface LookmlTestResult {
  test_name: string
  model_name?: string
  file_id?: string
  explore_name?: string
  success: boolean
  assertions_count?: number
  assertions_failed?: number
  errors?: Array<{ message?: string }>
}

export interface LookmlParityQuery {
  query_index?: number
  label?: string
  sql_slug?: string
  sql_runner_url?: string
  explore_slug?: string
  explore_url?: string
  parity_status?: string
  mismatches?: string[]
}

export interface LookmlBundle {
  id: string
  title: string
  project_id: string
  model_name?: string
  branch_name?: string
  files: LookmlFileChange[]
  validation?: LookmlValidationResult
  tests?: LookmlTestResult[]
  queries?: LookmlParityQuery[]
  summary_markdown?: string
}

export interface LookmlSessionIndex {
  id: string
  type: 'lookml'
  title: string
  updatedAt: string
  createdBy: string
  targetId: string
  branchName?: string
  explores?: string[]
  lastInteractionId?: string
  environmentId?: string
}

export interface LookmlArtifactPayload {
  id: string
  type: 'lookml'
  title: string
  updatedAt: string
  createdBy: string
  bundle: LookmlBundle
  studio?: {
    explores?: string[]
    lastInteractionId?: string
    environmentId?: string
    messages?: PersistedChatTurn[]
  }
}

export const BOOTSTRAP_LOOKML_PY = `#!/usr/bin/env python3
"""Sandbox helper for Agentic LookML:
1. Bootstraps lkr-dev-cli[parse] (offline lkr parse & lkr schema) and lkrdev/cli/skills/ (agentic-lookml-workflow, agentic-lookml, generate-view-from-table, lookml-field-curation, lookml) into /workspace.
2. Computes unified diffs between baseline LookML files (/workspace/lookml_baseline) and modified files (/workspace/data/$RUN_ID/lookml or /workspace/lookml).
3. Emits <LOOKML_BUNDLE>{...}</LOOKML_BUNDLE> for the host Looker extension to render diffs, validator/test status, summary.md, and /sql/:slug + /x/:slug parity links.
"""
import difflib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

WORKSPACE_DIR = Path(os.environ.get("WORKSPACE_DIR", "/workspace"))
SKILLS_ROOT = WORKSPACE_DIR / ".agents/skills"
SKILLS_ALIAS = WORKSPACE_DIR / "skills"
LOOKML_DIR = Path(os.environ.get("LOOKML_DIR", str(WORKSPACE_DIR / "lookml")))
BASELINE_DIR = Path(os.environ.get("LOOKML_BASELINE_DIR", str(WORKSPACE_DIR / "lookml_baseline")))
CLI_TARBALL_URL = os.environ.get(
    "LKR_CLI_TARBALL_URL",
    "https://codeload.github.com/lkrdev/cli/tar.gz/refs/heads/main",
)
REQUIRED_SKILLS = (
    "agentic-lookml-workflow",
    "agentic-lookml",
    "generate-view-from-table",
    "lookml-field-curation",
    "lookml",
    "looker-filters",
    "looker-expressions",
)

def ensure_skills() -> list[str]:
    marker = SKILLS_ROOT / "agentic-lookml/SKILL.md"
    if not marker.is_file():
        SKILLS_ROOT.mkdir(parents=True, exist_ok=True)
        local_skills = os.environ.get("LKR_CLI_SKILLS_DIR")
        if local_skills and Path(local_skills).is_dir():
            src_root = Path(local_skills)
            for s in REQUIRED_SKILLS:
                src = src_root / s
                if src.is_dir():
                    shutil.copytree(src, SKILLS_ROOT / s, dirs_exist_ok=True)
        else:
            tar_path = WORKSPACE_DIR / "lkrdev-cli.tar.gz"
            urllib.request.urlretrieve(CLI_TARBALL_URL, tar_path)
            extract_tmp = WORKSPACE_DIR / "_lkr_cli_extract"
            extract_tmp.mkdir(parents=True, exist_ok=True)
            with tarfile.open(tar_path, "r:gz") as tf:
                tf.extractall(extract_tmp)
            for child in extract_tmp.iterdir():
                skills_dir = child / "skills"
                if skills_dir.is_dir():
                    for s in skills_dir.iterdir():
                        if s.is_dir():
                            shutil.copytree(s, SKILLS_ROOT / s.name, dirs_exist_ok=True)
                    break
            shutil.rmtree(extract_tmp, ignore_errors=True)
    if not SKILLS_ALIAS.exists():
        try:
            SKILLS_ALIAS.symlink_to(SKILLS_ROOT)
        except Exception:
            pass
    return [d.name for d in SKILLS_ROOT.iterdir() if d.is_dir()]

def ensure_lkr_cli() -> str:
    lkr_bin = shutil.which("lkr") or shutil.which("lkr-dev-cli")
    if lkr_bin:
        return lkr_bin
    if shutil.which("uv"):
        subprocess.run(
            ["uv", "pip", "install", "--system", "--quiet", "lkr-dev-cli[parse]"],
            check=False,
        )
    else:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--quiet", "lkr-dev-cli[parse]"],
            check=False,
        )
    return shutil.which("lkr") or shutil.which("lkr-dev-cli") or "lkr"

def compute_diff(old_text: str, new_text: str, rel_path: str) -> str:
    lines = list(
        difflib.unified_diff(
            old_text.splitlines(keepends=True),
            new_text.splitlines(keepends=True),
            fromfile=f"a/{rel_path}",
            tofile=f"b/{rel_path}",
            n=3,
        )
    )
    return "".join(lines)

def collect_dir_diffs(lookml_dir: Path, baseline_dir: Path) -> list[dict]:
    changes = []
    if not lookml_dir.is_dir():
        return changes
    current_files = {
        str(p.relative_to(lookml_dir)): p
        for p in sorted(lookml_dir.rglob("*.lkml"))
        if p.is_file()
    }
    baseline_files = (
        {
            str(p.relative_to(baseline_dir)): p
            for p in sorted(baseline_dir.rglob("*.lkml"))
            if p.is_file()
        }
        if baseline_dir.is_dir()
        else {}
    )
    for rel_path, cur_path in current_files.items():
        new_text = cur_path.read_text(encoding="utf-8")
        if rel_path not in baseline_files:
            changes.append(
                {
                    "path": rel_path,
                    "action": "created",
                    "content": new_text,
                    "diff": compute_diff("", new_text, rel_path),
                }
            )
        else:
            old_text = baseline_files[rel_path].read_text(encoding="utf-8")
            if old_text != new_text:
                changes.append(
                    {
                        "path": rel_path,
                        "action": "updated",
                        "content": new_text,
                        "diff": compute_diff(old_text, new_text, rel_path),
                    }
                )
    for rel_path, old_path in baseline_files.items():
        if rel_path not in current_files:
            old_text = old_path.read_text(encoding="utf-8")
            changes.append(
                {
                    "path": rel_path,
                    "action": "deleted",
                    "content": "",
                    "diff": compute_diff(old_text, "", rel_path),
                }
            )
    return changes

def normalize_queries(raw_queries: list[dict]) -> list[dict]:
    out = []
    for i, q in enumerate(raw_queries or []):
        if not isinstance(q, dict):
            continue
        sql_slug = q.get("sql_slug") or q.get("sql_query_id") or ""
        exp_slug = q.get("explore_slug") or q.get("query_slug") or q.get("query_id") or ""
        out.append(
            {
                "query_index": q.get("query_index", i),
                "label": q.get("label") or f"Query #{q.get('query_index', i) + 1}",
                "sql_slug": str(sql_slug) if sql_slug else undefined_or_none(sql_slug),
                "sql_runner_url": q.get("sql_runner_url") or (f"/sql/{sql_slug}" if sql_slug else ""),
                "explore_slug": str(exp_slug) if exp_slug else "",
                "explore_url": q.get("explore_url") or (f"/x/{exp_slug}" if exp_slug else ""),
                "parity_status": q.get("parity_status") or ("matched" if q.get("passed") else "checked"),
                "mismatches": q.get("mismatches") or [],
            }
        )
    return out

def undefined_or_none(_v):
    return ""

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "setup"
    if cmd == "setup":
        skills = ensure_skills()
        lkr_bin = ensure_lkr_cli()
        LOOKML_DIR.mkdir(parents=True, exist_ok=True)
        BASELINE_DIR.mkdir(parents=True, exist_ok=True)
        print(json.dumps({"ok": True, "lkr": lkr_bin, "skills": sorted(skills)}))
        return

    if cmd == "bundle":
        spec_arg = sys.argv[2] if len(sys.argv) > 2 else str(WORKSPACE_DIR / "lookml_result.json")
        spec_path = Path(spec_arg)
        active_lookml_dir = LOOKML_DIR
        summary_md = ""
        if spec_path.is_dir():
            data_json_path = spec_path / "data.json"
            raw = json.loads(data_json_path.read_text(encoding="utf-8")) if data_json_path.is_file() else {}
            if (spec_path / "lookml").is_dir():
                active_lookml_dir = spec_path / "lookml"
            if (spec_path / "summary.md").is_file():
                summary_md = (spec_path / "summary.md").read_text(encoding="utf-8")
        else:
            raw = json.loads(spec_path.read_text(encoding="utf-8")) if spec_path.is_file() else {}
            run_id = raw.get("run_id") or raw.get("id")
            if run_id and (WORKSPACE_DIR / "data" / str(run_id) / "lookml").is_dir():
                active_lookml_dir = WORKSPACE_DIR / "data" / str(run_id) / "lookml"
            if run_id and (WORKSPACE_DIR / "data" / str(run_id) / "summary.md").is_file():
                summary_md = (WORKSPACE_DIR / "data" / str(run_id) / "summary.md").read_text(encoding="utf-8")

        files = raw.get("files")
        if not files:
            files = collect_dir_diffs(active_lookml_dir, BASELINE_DIR)
        else:
            for f in files:
                if not f.get("diff") and f.get("content"):
                    old_file = BASELINE_DIR / f["path"]
                    old_txt = old_file.read_text(encoding="utf-8") if old_file.is_file() else ""
                    f["diff"] = compute_diff(old_txt, f["content"], f["path"])

        val_errors = raw.get("validation_errors") or (raw.get("validation") or {}).get("errors") or []
        val_obj = raw.get("validation") or {
            "passed": len(val_errors) == 0 and raw.get("passed", True) is not False,
            "error_count": len(val_errors),
            "errors": val_errors,
        }
        bundle = {
            "id": str(raw.get("id") or raw.get("run_id") or raw.get("branch_name") or "lookml-session"),
            "title": str(raw.get("title") or f"LookML: {raw.get('project_id', 'Project')}"),
            "project_id": str(raw.get("project_id") or ""),
            "model_name": raw.get("model_name") or "",
            "branch_name": raw.get("branch_name") or "",
            "files": files,
            "validation": val_obj,
            "tests": raw.get("tests") or [],
            "queries": normalize_queries(raw.get("queries") or []),
            "summary_markdown": raw.get("summary_markdown") or summary_md,
        }
        out_path = WORKSPACE_DIR / "lookml_bundle.json"
        out_path.write_text(json.dumps(bundle), encoding="utf-8")
        print("<LOOKML_BUNDLE>" + json.dumps(bundle) + "</LOOKML_BUNDLE>")
        return

    sys.exit(f"Unknown command: {cmd}. Usage: bootstrap_lookml.py [setup|bundle]")

if __name__ == "__main__":
    main()
`

export function extractLookmlBundleFromInteraction(interaction: any): LookmlBundle | null {
  const candidates: string[] = []
  if (typeof interaction?.output_text === 'string') {
    candidates.push(interaction.output_text)
  }
  for (const out of interaction?.outputs || []) {
    if (typeof out?.text === 'string') candidates.push(out.text)
  }
  for (const step of interaction?.steps || []) {
    if (typeof step?.output === 'string') candidates.push(step.output)
    if (typeof step?.result === 'string') candidates.push(step.result)
    if (typeof step?.text === 'string') candidates.push(step.text)
  }
  const combined = candidates.join('\n')
  const matches = Array.from(
    combined.matchAll(/<LOOKML_BUNDLE>([\s\S]*?)<\/LOOKML_BUNDLE>/g)
  )
  if (matches.length === 0) return null
  const lastJson = matches[matches.length - 1][1].trim()
  return JSON.parse(lastJson) as LookmlBundle
}

export function buildLookmlSystemGuide(params: {
  selectedExplores: string[]
  primaryModel: string
  primaryExplore: string
  projectId?: string
}): string {
  const { selectedExplores, primaryModel, primaryExplore, projectId } = params
  const projHint = projectId?.trim()
    ? `Target LookML project_id: "${projectId.trim()}".`
    : primaryModel
    ? `Resolve the LookML project_id from model "${primaryModel}" via \`lookml_model("${primaryModel}")["project_name"]\` or \`all_projects()\`.`
    : `Discover the target LookML project_id via \`all_projects(fields="id,name,git_remote_url")\` or \`lookml_model(model_name)\`.`

  return [
    `You are the **Agentic LookML** engineer powered by \`lkrdev/cli\` and the \`agentic-lookml\` skill suite.`,
    projHint,
    selectedExplores.length > 0
      ? `Selected Explore context: ${selectedExplores.join(', ')} (primary: ${primaryModel}::${primaryExplore}).`
      : `See /workspace/schema.md for available models and explores.`,
    `Follow these exact steps:`,
    `1. **Sandbox Bootstrap (\`/workspace\`)**:`,
    `   Run \`python3 /workspace/bootstrap_lookml.py setup\` in your Linux sandbox to install \`lkr-dev-cli[parse]\` and unpack \`/workspace/.agents/skills/\` (\`agentic-lookml-workflow\`, \`agentic-lookml\`, \`generate-view-from-table\`, \`lookml-field-curation\`, \`lookml\`). Read \`/workspace/.agents/skills/agentic-lookml-workflow/SKILL.md\` and \`/workspace/.agents/skills/agentic-lookml/SKILL.md\`.`,
    `2. **Host-Bridged LookML Sync via Browser WASM \`run_looker_codemode(code, vars)\` (\`allowUpdateSession: true\`)**:`,
    `   - Zero sandbox Looker credentials are needed: \`run_looker_codemode\` runs in the browser extension with \`allowUpdateSession: true\`, accepts \`vars: {...}\` (e.g. \`project_id\`, \`ts_utc\`, \`raw_sql\`, \`inline_queries_json\`, \`test_queries_json\`, \`file_ids\`, \`test_names\`, \`commit_message\`), and has all \`ExtendedLooker40SDK\` methods pre-bound (\`update_session\`, \`all_project_files\`, \`get_file_content\`, \`create_file\`, \`update_file\`, \`delete_file\`, \`create_project_directory\`, \`delete_project_directory\`, \`generate_lookml\`, \`generate_lookml_with_new_files\`, \`create_developer_copy\`, \`reset_project_to_production\`, \`create_git_branch\`, \`validate_project\`, \`run_lookml_test\`, \`commit\`, \`create_sql_query\`, \`run_sql_query\`, \`run_inline_query\`).`,
    `   - Switch to dev mode (\`update_session({"workspace_id": "dev"})\`), run \`scripts/init_branch.py\` (workspace reset, dev branch creation, missing Bronze view generation) plus \`scripts/configure_model.py\` & \`scripts/generate_bronze_view.py\` as needed, and pull LookML files via \`all_project_files\` + \`get_file_content\` into \`/workspace/lookml_baseline/\` and \`/workspace/data/$RUN_ID/lookml/\`.`,
    `3. **100% Offline \`lkr-dev-cli[parse]\` CLI Commands in \`/workspace\`**:`,
    `   - Run offline CLI commands against \`/workspace/data/$RUN_ID/lookml\`: \`lkr parse sql --dialect bigquery --summary\`, \`lkr parse sql-lookml-compare --offline\`, \`lkr parse lookml-to-api --validate\`, \`lkr schema validate --explore-file\`, and \`lkr parse lookml snapshot\` & \`lkr parse curation-meta\`.`,
    `   - Author Bronze refinements, Silver/Gold views & explores, opinionated \`.test.lkml\` tests, and \`/workspace/data/$RUN_ID/summary.md\` (using \`scripts/profile_string_fields.py\` & \`scripts/enrich_partition_clustering.py\` via \`run_looker_codemode\` when curating).`,
    `4. **Push Modified \`.lkml\` Files, Pre-Gate Parity & Validate/Commit via \`run_looker_codemode\`**:`,
    `   - Push changed/deleted \`.lkml\` files back using \`create_project_directory\`, \`create_file\`, \`update_file\`, \`delete_file\`.`,
    `   - Run \`scripts/pre_gate.py\` (SQL Runner baseline queries, \`validate_project\`, Explore query registration, and row/cell parity verification) and \`scripts/validate_and_commit_branch.py\` (\`validate_project\`, \`run_lookml_test\`, \`commit\`, and \`push_branch\`) via \`run_looker_codemode(code=..., vars={...})\`.`,
    `5. **Emit \`<LOOKML_BUNDLE>\`**:`,
    `   Run \`python3 /workspace/bootstrap_lookml.py bundle /workspace/data/$RUN_ID\` (or \`/workspace/lookml_result.json\`) and include the printed \`<LOOKML_BUNDLE>...</LOOKML_BUNDLE>\` tag in your final response.`,
  ].join('\n')
}

export function getArtifactNamespace(extensionSDK: any): string {
  const extId = extensionSDK?.lookerHostData?.extensionId
  if (typeof extId === 'string' && extId.trim()) {
    return extId.trim()
  }
  return 'data_app_builder'
}

export function getLookmlArtifactKeys(userId: string, id: string) {
  const cleanUser = String(userId || 'anon').trim()
  const cleanId = String(id || 'default')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
  return {
    id: cleanId,
    userKey: `user_${cleanUser}_lookml_${cleanId}`,
    objKey: `obj_lookml_${cleanId}`,
  }
}

async function fetchArtifactVersions(
  sdk: Looker40SDK,
  namespace: string,
  keys: string[]
): Promise<Record<string, number>> {
  const map: Record<string, number> = {}
  for (const key of keys) {
    try {
      const res = await rawLookerRequest<any[]>(
        sdk,
        'GET',
        `/artifacts/${encodeURIComponent(namespace)}`,
        { key, fields: 'key,version' }
      )
      const list = Array.isArray(res) ? res : res ? [res] : []
      for (const item of list) {
        if (item?.key && typeof item?.version === 'number') {
          map[item.key] = item.version
        }
      }
    } catch {
      // Key does not exist yet
    }
  }
  return map
}

// ponytail: persist two-tier Looker Artifacts (`user_${userId}_lookml_${id}` compact index + `obj_lookml_${id}` full payload)
// via rawLookerRequest against /artifacts/:namespace so LookML sessions are searchable per user and shareable by URL.
export async function saveLookmlSessionArtifact(params: {
  sdk: Looker40SDK
  extensionSDK?: any
  userId: string
  bundle: LookmlBundle
  studio: {
    explores?: string[]
    lastInteractionId?: string
    environmentId?: string
    messages?: PersistedChatTurn[]
  }
}): Promise<{
  id: string
  userKey: string
  objKey: string
  index: LookmlSessionIndex
  payload: LookmlArtifactPayload
}> {
  const { sdk, extensionSDK, userId, bundle, studio } = params
  const namespace = getArtifactNamespace(extensionSDK)
  const rawId =
    bundle.id ||
    bundle.branch_name ||
    `${bundle.project_id || 'lookml'}_${Date.now().toString(36)}`
  const { id, userKey, objKey } = getLookmlArtifactKeys(userId, rawId)
  const updatedAt = new Date().toISOString()

  const index: LookmlSessionIndex = {
    id,
    type: 'lookml',
    title: bundle.title || `LookML (${bundle.project_id || id})`,
    updatedAt,
    createdBy: String(userId),
    targetId: bundle.project_id || '',
    branchName: bundle.branch_name,
    explores: studio.explores || [],
    lastInteractionId: studio.lastInteractionId,
    environmentId: studio.environmentId,
  }

  const compactMessages = (studio.messages || [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-200)

  const payload: LookmlArtifactPayload = {
    id,
    type: 'lookml',
    title: index.title,
    updatedAt,
    createdBy: String(userId),
    bundle: { ...bundle, id },
    studio: {
      explores: studio.explores || [],
      lastInteractionId: studio.lastInteractionId,
      environmentId: studio.environmentId,
      messages: compactMessages,
    },
  }

  const versions = await fetchArtifactVersions(sdk, namespace, [userKey, objKey])
  const artifactsBody = [
    {
      key: userKey,
      value: JSON.stringify(index),
      content_type: 'application/json',
      ...(versions[userKey] !== undefined ? { version: versions[userKey] } : {}),
    },
    {
      key: objKey,
      value: JSON.stringify(payload),
      content_type: 'application/json',
      ...(versions[objKey] !== undefined ? { version: versions[objKey] } : {}),
    },
  ]

  await rawLookerRequest(
    sdk,
    'PUT',
    `/artifacts/${encodeURIComponent(namespace)}`,
    undefined,
    artifactsBody
  )

  return { id, userKey, objKey, index, payload }
}

export async function loadLookmlSessionArtifact(
  sdk: Looker40SDK,
  extensionSDK: any,
  rawId: string
): Promise<LookmlArtifactPayload> {
  const namespace = getArtifactNamespace(extensionSDK)
  const cleanId = rawId.trim().replace(/^obj_lookml_/, '')
  const objKey = `obj_lookml_${cleanId}`
  const res = await rawLookerRequest<any[]>(
    sdk,
    'GET',
    `/artifacts/${encodeURIComponent(namespace)}`,
    { key: objKey }
  )
  const item = Array.isArray(res) ? res[0] : res
  if (!item?.value) {
    throw new Error(`LookML session artifact "${objKey}" not found.`)
  }
  return typeof item.value === 'string' ? JSON.parse(item.value) : item.value
}

export async function listUserLookmlSessions(
  sdk: Looker40SDK,
  extensionSDK: any,
  userId: string
): Promise<LookmlSessionIndex[]> {
  const namespace = getArtifactNamespace(extensionSDK)
  const pattern = `user_${String(userId || 'anon').trim()}_lookml_%`
  try {
    const res = await rawLookerRequest<any[]>(
      sdk,
      'GET',
      `/artifacts/${encodeURIComponent(namespace)}/search`,
      { key: pattern, limit: 50 }
    )
    const items = Array.isArray(res) ? res : []
    return items
      .map((item) => {
        try {
          return typeof item?.value === 'string' ? JSON.parse(item.value) : item?.value
        } catch {
          return null
        }
      })
      .filter((x): x is LookmlSessionIndex => Boolean(x && x.id && x.type === 'lookml'))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  } catch {
    return []
  }
}

export const LookmlPreviewPane: React.FC<{
  bundle: LookmlBundle | null
  hostUrl: string
  extensionSDK?: any
}> = ({ bundle, hostUrl, extensionSDK }) => {
  const [selectedFileIdx, setSelectedFileIdx] = useState(0)
  const [viewMode, setViewMode] = useState<'diff' | 'content'>('diff')

  if (!bundle) {
    return (
      <div className="dab-placeholder">
        <p>
          <strong>Agentic LookML Workspace</strong>
        </p>
        <p className="dab-muted" style={{ maxWidth: 480, textAlign: 'center' }}>
          Enter a SQL query, metric definition, or LookML task on the left. Antigravity will
          switch to your Looker <code>dev</code> workspace via <code>LkrCodeMode</code>,
          run offline <code>lkr parse</code> &amp; <code>lkr schema validate</code>, push
          modified <code>.lkml</code> files, and render diffs, LookML Validator /{' '}
          <code>run_lookml_test</code> status, and clickable <code>/sql/:slug</code> +{' '}
          <code>/x/:slug</code> parity links here.
        </p>
      </div>
    )
  }

  const files = bundle.files || []
  const activeFile = files[selectedFileIdx] || files[0] || null
  const valPassed = bundle.validation ? bundle.validation.passed : true
  const valErrors = bundle.validation?.errors || []
  const tests = bundle.tests || []
  const passedTests = tests.filter((t) => t.success).length
  const queries = bundle.queries || []
  const cleanHost = hostUrl.replace(/\/$/, '')

  const openLink = (pathOrUrl: string) => {
    const target = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${cleanHost}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`
    if (extensionSDK?.openBrowserWindow) {
      extensionSDK.openBrowserWindow(target, '_blank')
    } else {
      window.open(target, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
        padding: 16,
        gap: 14,
      }}
    >
      {/* Status Summary Cards */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          background: '#ffffff',
          padding: '10px 14px',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
        }}
      >
        <div>
          <strong>Project:</strong> <code>{bundle.project_id || 'default'}</code>
        </div>
        {bundle.model_name && (
          <div>
            <strong>Model:</strong> <code>{bundle.model_name}</code>
          </div>
        )}
        {bundle.branch_name && (
          <span className="dab-badge" title="Active Looker Git Branch">
            ⎇ {bundle.branch_name}
          </span>
        )}
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            background: valPassed ? '#dcfce7' : '#fee2e2',
            color: valPassed ? '#166534' : '#991b1b',
            border: `1px solid ${valPassed ? '#bbf7d0' : '#fecaca'}`,
          }}
        >
          {valPassed
            ? '✓ LookML Validator Passed'
            : `✗ LookML Validator (${valErrors.length} error${valErrors.length === 1 ? '' : 's'})`}
        </span>
        {tests.length > 0 && (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              background: passedTests === tests.length ? '#dcfce7' : '#fee2e2',
              color: passedTests === tests.length ? '#166534' : '#991b1b',
              border: `1px solid ${passedTests === tests.length ? '#bbf7d0' : '#fecaca'}`,
            }}
          >
            {passedTests === tests.length
              ? `✓ run_lookml_test (${passedTests}/${tests.length} passed)`
              : `✗ run_lookml_test (${passedTests}/${tests.length} passed)`}
          </span>
        )}
      </div>

      {/* Clickable /sql/:slug and /x/:slug Parity Links */}
      {queries.length > 0 && (
        <div
          style={{
            background: '#ffffff',
            padding: 12,
            borderRadius: 8,
            border: '1px solid #e2e8f0',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 12 }}>
            SQL-to-LookML Parity Queries (<code>/sql/:slug</code> &amp; <code>/x/:slug</code>)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {queries.map((q, i) => {
              const sqlPath =
                q.sql_runner_url || (q.sql_slug ? `/sql/${q.sql_slug}` : undefined)
              const explorePath =
                q.explore_url || (q.explore_slug ? `/x/${q.explore_slug}` : undefined)
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '6px 10px',
                    background: '#f8fafc',
                    borderRadius: 6,
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong>{q.label || `Query #${(q.query_index ?? i) + 1}`}</strong>
                    {q.parity_status && (
                      <span
                        className="dab-msg-pill"
                        style={{
                          background:
                            q.parity_status === 'matched' || q.parity_status === 'passed'
                              ? '#dcfce7'
                              : '#fef3c7',
                          color:
                            q.parity_status === 'matched' || q.parity_status === 'passed'
                              ? '#166534'
                              : '#92400e',
                        }}
                      >
                        {q.parity_status}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {sqlPath && (
                      <button
                        type="button"
                        className="dab-btn-secondary"
                        onClick={() => openLink(sqlPath)}
                      >
                        <code>{q.sql_slug ? `/sql/${q.sql_slug}` : 'SQL Runner'}</code> ↗
                      </button>
                    )}
                    {explorePath && (
                      <button
                        type="button"
                        className="dab-btn-secondary"
                        onClick={() => openLink(explorePath)}
                      >
                        <code>{q.explore_slug ? `/x/${q.explore_slug}` : 'Explore'}</code> ↗
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Validator Errors & Test Results Details */}
      {(valErrors.length > 0 || tests.length > 0) && (
        <div
          style={{
            background: '#ffffff',
            padding: 12,
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {valErrors.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>
                LookML Validator Findings
              </div>
              {valErrors.map((e, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: '#991b1b',
                    padding: '3px 0',
                  }}
                >
                  {e.file_path ? `${e.file_path}${e.line_number ? `:${e.line_number}` : ''} — ` : ''}
                  {e.message}
                </div>
              ))}
            </div>
          )}
          {tests.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 12 }}>
                LookML Data Tests (<code>run_lookml_test</code>)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tests.map((t, i) => (
                  <span
                    key={i}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontFamily: 'monospace',
                      background: t.success ? '#f0fdf4' : '#fef2f2',
                      color: t.success ? '#166534' : '#991b1b',
                      border: `1px solid ${t.success ? '#bbf7d0' : '#fecaca'}`,
                    }}
                  >
                    {t.success ? '✓' : '✗'} {t.test_name}
                    {t.file_id ? ` (${t.file_id})` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modified .lkml File Diffs / Contents */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 260,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid #e2e8f0',
            background: '#f8fafc',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {files.length === 0 ? (
              <span className="dab-muted">No modified .lkml files recorded</span>
            ) : (
              files.map((f, idx) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => setSelectedFileIdx(idx)}
                  className={
                    idx === selectedFileIdx ? 'dab-btn-primary' : 'dab-btn-secondary'
                  }
                  style={{ fontFamily: 'monospace', fontSize: 11 }}
                >
                  {f.action === 'created'
                    ? '+ '
                    : f.action === 'deleted'
                    ? '- '
                    : 'Δ '}
                  {f.path}
                </button>
              ))
            )}
          </div>
          {activeFile && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="dab-btn-secondary"
                onClick={() =>
                  setViewMode((m) => (m === 'diff' ? 'content' : 'diff'))
                }
              >
                {viewMode === 'diff' ? 'Show Full .lkml' : 'Show Unified Diff'}
              </button>
              <button
                type="button"
                className="dab-btn-secondary"
                onClick={() =>
                  navigator.clipboard?.writeText(
                    activeFile.content || activeFile.diff || ''
                  )
                }
              >
                Copy .lkml
              </button>
            </div>
          )}
        </div>

        <pre
          style={{
            margin: 0,
            padding: 12,
            flex: 1,
            overflow: 'auto',
            background: '#0f172a',
            color: '#e2e8f0',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {activeFile ? (
            (viewMode === 'diff' && activeFile.diff
              ? activeFile.diff
              : activeFile.content || activeFile.diff || ''
            )
              .split('\n')
              .map((line, i) => {
                const isAdd =
                  viewMode === 'diff' &&
                  line.startsWith('+') &&
                  !line.startsWith('+++')
                const isDel =
                  viewMode === 'diff' &&
                  line.startsWith('-') &&
                  !line.startsWith('---')
                const isHdr = viewMode === 'diff' && line.startsWith('@@')
                return (
                  <div
                    key={i}
                    style={{
                      color: isAdd
                        ? '#4ade80'
                        : isDel
                        ? '#f87171'
                        : isHdr
                        ? '#38bdf8'
                        : '#e2e8f0',
                      background: isAdd
                        ? 'rgba(34, 197, 94, 0.12)'
                        : isDel
                        ? 'rgba(248, 113, 113, 0.12)'
                        : 'transparent',
                    }}
                  >
                    {line}
                  </div>
                )
              })
          ) : (
            <span style={{ color: '#94a3b8' }}>No .lkml file selected.</span>
          )}
        </pre>
      </div>

      {/* Diagnostic Summary Markdown */}
      {bundle.summary_markdown && (
        <details
          open
          style={{
            background: '#ffffff',
            padding: 12,
            borderRadius: 8,
            border: '1px solid #e2e8f0',
          }}
        >
          <summary style={{ fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
            Agentic LookML Diagnostic Summary (<code>summary.md</code>)
          </summary>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              fontSize: 12,
              margin: '8px 0 0',
              color: '#334155',
            }}
          >
            {bundle.summary_markdown}
          </pre>
        </details>
      )}
    </div>
  )
}
