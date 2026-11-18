import type { Looker40SDK } from '@looker/sdk'

import { callInteractionsApi, fetchEnvironmentFile } from './antigravityAuth'
import {
  AGENTS_MD,
  BUNDLE_APP_PY,
  DATA_APP_GUIDE_MD,
  DATA_INVESTIGATOR_GUIDE_MD,
  LOOKER_PROJECT_ONBOARDING_SKILL_MD,
} from './antigravityPrompts'
import {
  LOOKER_ALERTS_SKILL_MD,
  LOOKER_DASHBOARD_SKILL_MD,
  LOOKER_FIELD_PROFILER_SKILL_MD,
} from './antigravityStarters'
import { BUILTIN_SKILLS_FILES, SANDBOX_AGENT_SKILL_FILES } from './antigravitySteps'
import {
  type AntigravityAuth,
  type AntigravityExtensionHostLike,
  type AntigravityInteractionPayload,
  collectInteractionTextCandidates,
  DEFAULT_ANTIGRAVITY_MODEL,
  isEnvironmentNotFoundError,
  normalizeEnvironmentId,
  resolveAdaptivePollScheduleMs,
} from './antigravityTypes'
import { BOOTSTRAP_LOOKML_PY } from './lkrCliBridge'
import { canonicalJson, LKR_CLI_SITECUSTOMIZE_PY, sha256Hex } from './lkrCliSitecustomize'
import { getArtifactNamespace, saveUserEnvironmentId } from './lookerApi'
import { KDA_SKILL_MD, KDA_TOOLKIT_PY } from './lookmlSkills'

export const MANAGED_SOURCES_MANIFEST_PATH = '/workspace/.managed_sources_manifest.json'
export const MAX_SYNC_CHUNK_B64_CHARS = 12 * 1024

export interface ManagedWorkspaceSource {
  type: 'inline'
  target: string
  content: string
}

export interface ManagedSourcesManifest {
  sourcesHash: string
  files: Record<string, string>
}

export interface SyncManagedSkillsResult {
  status: 'synced' | 'up_to_date' | 'environment_expired'
  updatedCount: number
  deletedCount: number
  sourcesHash: string
}

function createManagedWorkspaceSourcesList(): ManagedWorkspaceSource[] {
  const byTarget = new Map<string, ManagedWorkspaceSource>()
  const baseEntries: ManagedWorkspaceSource[] = [
    { type: 'inline', target: '/workspace/AGENTS.md', content: AGENTS_MD },
    { type: 'inline', target: '/workspace/bundle_app.py', content: BUNDLE_APP_PY },
    { type: 'inline', target: '/workspace/skills/data-apps/SKILL.md', content: DATA_APP_GUIDE_MD },
    { type: 'inline', target: '/workspace/skills/data-investigator/SKILL.md', content: DATA_INVESTIGATOR_GUIDE_MD },
    { type: 'inline', target: '/workspace/skills/key-driver-analysis/SKILL.md', content: KDA_SKILL_MD },
    { type: 'inline', target: '/workspace/skills/key-driver-analysis/scripts/kda_toolkit.py', content: KDA_TOOLKIT_PY },
    { type: 'inline', target: '/workspace/skills/looker-dashboard/SKILL.md', content: LOOKER_DASHBOARD_SKILL_MD },
    { type: 'inline', target: '/workspace/skills/looker-field-profiler/SKILL.md', content: LOOKER_FIELD_PROFILER_SKILL_MD },
    { type: 'inline', target: '/workspace/skills/looker-alerts/SKILL.md', content: LOOKER_ALERTS_SKILL_MD },
    { type: 'inline', target: '/workspace/skills/looker-project-onboarding/SKILL.md', content: LOOKER_PROJECT_ONBOARDING_SKILL_MD },
    { type: 'inline', target: '/workspace/skills/lookml-snapshot/SKILL.md', content: BUILTIN_SKILLS_FILES['lookml-snapshot'] },
    { type: 'inline', target: '/workspace/skills/creating-looker-dashboard/SKILL.md', content: LOOKER_DASHBOARD_SKILL_MD },
    { type: 'inline', target: '/workspace/skills/lookml-modeling-guidelines/SKILL.md', content: SANDBOX_AGENT_SKILL_FILES['agentic-lookml/SKILL.md'] },
    { type: 'inline', target: '/workspace/skills/looker-architect/SKILL.md', content: SANDBOX_AGENT_SKILL_FILES['agentic-lookml/SKILL.md'] },
  ]
  for (const entry of baseEntries) byTarget.set(entry.target, entry)
  for (const [relPath, content] of Object.entries(SANDBOX_AGENT_SKILL_FILES).sort(([a], [b]) => a.localeCompare(b))) {
    const target = `/workspace/skills/${relPath}`
    if (!byTarget.has(target)) byTarget.set(target, { type: 'inline', target, content })
  }
  byTarget.set('/workspace/bootstrap_lookml.py', { type: 'inline', target: '/workspace/bootstrap_lookml.py', content: BOOTSTRAP_LOOKML_PY })
  byTarget.set('/workspace/sitecustomize.py', { type: 'inline', target: '/workspace/sitecustomize.py', content: LKR_CLI_SITECUSTOMIZE_PY })
  return Array.from(byTarget.values())
}

const MANAGED_WORKSPACE_SOURCES = createManagedWorkspaceSourcesList()

export function buildManagedWorkspaceSources(): ManagedWorkspaceSource[] {
  return MANAGED_WORKSPACE_SOURCES.map((entry) => Object.assign({}, entry))
}

export const MANAGED_SOURCES_FILE_HASHES: Record<string, string> = Object.fromEntries(
  MANAGED_WORKSPACE_SOURCES.map((entry) => [entry.target, sha256Hex(entry.content).slice(0, 16)])
)

export const CURRENT_MANAGED_SOURCES_HASH: string = sha256Hex(canonicalJson(MANAGED_SOURCES_FILE_HASHES)).slice(0, 16)

export const MANAGED_SOURCES_MANIFEST_JSON: string = JSON.stringify({
  sourcesHash: CURRENT_MANAGED_SOURCES_HASH,
  files: MANAGED_SOURCES_FILE_HASHES,
})

const ALLOWED_TOP_LEVEL_MANAGED_PATHS = new Set(
  MANAGED_WORKSPACE_SOURCES.map((e) => e.target).filter((t) => /^\/workspace\/[^/]+$/.test(t))
)

export function persistUserEnvIfChanged(params: {
  sdk?: Looker40SDK
  extensionSDK?: AntigravityExtensionHostLike
  userId?: string
  previousEnvId?: string
  nextEnvId?: string
  sourcesHash?: string
  onEnvironmentUpdated?: (environmentId: string, sourcesHash?: string) => void | Promise<void>
}): Promise<void> {
  const next = normalizeEnvironmentId(params.nextEnvId)
  const cleanHash = typeof params.sourcesHash === 'string' && params.sourcesHash.trim() ? params.sourcesHash.trim() : undefined
  if (!next || (next === normalizeEnvironmentId(params.previousEnvId) && !cleanHash)) return Promise.resolve()
  return Promise.resolve(params.onEnvironmentUpdated?.(next, cleanHash)).then(() => {
    if (!params.sdk || typeof (params.sdk as Partial<Looker40SDK>).update_artifacts !== 'function') return
    const explicitUid = String(params.userId || '').trim()
    const uidPromise =
      explicitUid || typeof (params.sdk as Partial<Looker40SDK>).me !== 'function'
        ? Promise.resolve(explicitUid)
        : Promise.resolve(params.sdk.ok ? params.sdk.ok(params.sdk.me('id')) : params.sdk.me('id')).then(
            (me) => String((me as { id?: string | number } | undefined)?.id || '').trim(),
            () => ''
          )
    return uidPromise.then((uid) =>
      uid ? saveUserEnvironmentId(params.sdk!, uid, next, getArtifactNamespace(params.extensionSDK), cleanHash).then(() => {}) : undefined
    )
  })
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)))
  }
  return btoa(bin)
}

export async function encodeSyncPayloadChunks(
  rawJson: string,
  options?: { maxChunkChars?: number }
): Promise<{ encoding: 'gzip' | 'utf8'; chunks: string[] }> {
  const maxChars = Math.max(512, options?.maxChunkChars || MAX_SYNC_CHUNK_B64_CHARS)
  const utf8Bytes = new TextEncoder().encode(rawJson)
  let bytes = utf8Bytes
  let encoding: 'gzip' | 'utf8' = 'utf8'
  const CompressionCtor = (
    globalThis as unknown as {
      CompressionStream?: new (format: 'gzip') => { writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array> }
    }
  ).CompressionStream
  if (typeof CompressionCtor === 'function') {
    try {
      const stream = new CompressionCtor('gzip')
      const writer = stream.writable.getWriter()
      const writePromise = writer.write(utf8Bytes).then(() => writer.close())
      const reader = stream.readable.getReader()
      const parts: Uint8Array[] = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) { parts.push(value); total += value.byteLength }
      }
      await writePromise
      const merged = new Uint8Array(total)
      let offset = 0
      for (const p of parts) { merged.set(p, offset); offset += p.byteLength }
      bytes = merged
      encoding = 'gzip'
    } catch {
      bytes = utf8Bytes
      encoding = 'utf8'
    }
  }
  const b64 = bytesToBase64(bytes)
  const chunks: string[] = []
  for (let i = 0; i < b64.length; i += maxChars) {
    chunks.push(b64.slice(i, i + maxChars))
  }
  return { encoding, chunks: chunks.length > 0 ? chunks : [''] }
}

function isManifestEnvironmentExpiredError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || '')
  if (/file[\s_-]*not[\s_-]*found|\.managed_sources_manifest|environment\s+variable/i.test(msg)) return false
  return /\benvironments\/[^\s/?]+[^\n]{0,40}not[\s_-]*found\b|\benvironment\s+(?:id\s+)?['"`]?env_[^\s'"`]*['"`]?\s+(?:was\s+)?not[\s_-]*found\b|\benvironment\s+was\s+not\s+found\b|\bsandbox\s+(?:environment\s+)?expired\b/i.test(msg)
}

function isManifestFileMissingError(err: unknown): boolean {
  const e = err && typeof err === 'object' ? (err as { status?: number; statusCode?: number; message?: string }) : undefined
  const status = Number(e?.status || e?.statusCode || 0)
  const msg = String(e?.message || err || '')
  return status === 404 || /\b404\b|not[\s_-]*found/i.test(msg)
}

function throwIfSyncAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw Object.assign(new Error('Managed skill sync aborted'), { name: 'AbortError' })
}

async function pollInteractionUntilTerminal(
  extensionSDK: AntigravityExtensionHostLike,
  auth: AntigravityAuth,
  initial: AntigravityInteractionPayload,
  envId: string,
  signal?: AbortSignal
): Promise<AntigravityInteractionPayload> {
  let cur = initial
  const schedule = resolveAdaptivePollScheduleMs(undefined, envId)
  for (let pollIdx = 0; pollIdx < 60; pollIdx += 1) {
    if (signal?.aborted) {
      if (cur?.id) await callInteractionsApi(extensionSDK, auth, `interactions/${encodeURIComponent(cur.id)}:cancel`, 'POST', {}).catch(() => {})
      throwIfSyncAborted(signal)
    }
    const st = String(cur?.status || '').trim().toLowerCase()
    if (!cur?.id || !st || st === 'completed' || st === 'succeeded' || st === 'done') return cur
    if (st === 'failed' || st === 'error' || st === 'cancelled' || st === 'canceled' || st === 'incomplete') {
      throw new Error(cur.error?.message || `Managed skill sync interaction ended with status "${st}".`)
    }
    const waitMs = schedule[Math.min(pollIdx, schedule.length - 1)] || 500
    await new Promise<void>((r) => setTimeout(r, waitMs))
    if (signal?.aborted) {
      await callInteractionsApi(extensionSDK, auth, `interactions/${encodeURIComponent(cur.id)}:cancel`, 'POST', {}).catch(() => {})
      throwIfSyncAborted(signal)
    }
    cur = await callInteractionsApi(extensionSDK, auth, `interactions/${encodeURIComponent(cur.id)}`, 'GET')
  }
  throw new Error(`Managed skill sync timed out waiting for interaction "${cur?.id || ''}" (status "${String(cur?.status || '')}").`)
}

export async function syncManagedSkillsIntoEnvironment(params: {
  sdk?: Looker40SDK
  userId?: string
  extensionSDK: AntigravityExtensionHostLike
  auth: AntigravityAuth
  environmentId: string
  model?: string
  signal?: AbortSignal
}): Promise<SyncManagedSkillsResult> {
  const { sdk, userId, extensionSDK, auth, model = DEFAULT_ANTIGRAVITY_MODEL, signal } = params
  throwIfSyncAborted(signal)
  const envId = normalizeEnvironmentId(params.environmentId)
  if (!envId) {
    return { status: 'environment_expired', updatedCount: 0, deletedCount: 0, sourcesHash: CURRENT_MANAGED_SOURCES_HASH }
  }

  let liveFiles: Record<string, string> | null = null
  let pruneUnlistedSkills = false
  try {
    const rawManifest = await fetchEnvironmentFile({
      extensionSDK,
      auth,
      environmentId: envId,
      path: MANAGED_SOURCES_MANIFEST_PATH,
    })
    throwIfSyncAborted(signal)
    const parsed = JSON.parse(rawManifest) as Partial<ManagedSourcesManifest>
    if (parsed && typeof parsed === 'object' && parsed.files && typeof parsed.files === 'object') {
      liveFiles = parsed.files
    } else {
      pruneUnlistedSkills = true
    }
  } catch (err) {
    throwIfSyncAborted(signal)
    if (isManifestEnvironmentExpiredError(err)) {
      return { status: 'environment_expired', updatedCount: 0, deletedCount: 0, sourcesHash: CURRENT_MANAGED_SOURCES_HASH }
    }
    if (isManifestFileMissingError(err) || err instanceof SyntaxError) {
      pruneUnlistedSkills = true
    } else {
      throw err
    }
  }

  const changedFiles = MANAGED_WORKSPACE_SOURCES.filter((entry) => !liveFiles || liveFiles[entry.target] !== MANAGED_SOURCES_FILE_HASHES[entry.target])
  const deletedPaths = liveFiles
    ? Object.keys(liveFiles).filter(
        (p) => !(p in MANAGED_SOURCES_FILE_HASHES) && !p.includes('..') && (p.startsWith('/workspace/skills/') || ALLOWED_TOP_LEVEL_MANAGED_PATHS.has(p))
      )
    : []

  if (changedFiles.length === 0 && deletedPaths.length === 0 && !pruneUnlistedSkills) {
    throwIfSyncAborted(signal)
    await persistUserEnvIfChanged({ sdk, extensionSDK, userId, nextEnvId: envId, sourcesHash: CURRENT_MANAGED_SOURCES_HASH })
    return { status: 'up_to_date', updatedCount: 0, deletedCount: 0, sourcesHash: CURRENT_MANAGED_SOURCES_HASH }
  }

  const deltaJson = JSON.stringify({
    files: changedFiles.map((f) => ({ target: f.target, content: f.content })),
    deletedPaths,
    pruneUnlistedSkills,
    managedSkillTargets: pruneUnlistedSkills ? Object.keys(MANAGED_SOURCES_FILE_HASHES).filter((p) => p.startsWith('/workspace/skills/')) : [],
    allowedTopLevelPaths: Array.from(ALLOWED_TOP_LEVEL_MANAGED_PATHS),
    manifestPath: MANAGED_SOURCES_MANIFEST_PATH,
    manifestJson: MANAGED_SOURCES_MANIFEST_JSON,
  })
  const { encoding, chunks } = await encodeSyncPayloadChunks(deltaJson)
  const nonce = Math.random().toString(36).slice(2, 10)
  const tmpFile = `/tmp/_dab_skill_sync_${CURRENT_MANAGED_SOURCES_HASH}_${nonce}.b64`
  const syncMarker = `SYNC_OK:${CURRENT_MANAGED_SOURCES_HASH}`

  let finalInteraction: AntigravityInteractionPayload | null = null
  try {
    for (let idx = 0; idx < chunks.length; idx += 1) {
      throwIfSyncAborted(signal)
      const isFirst = idx === 0
      const isLast = idx === chunks.length - 1
      const chunkB64 = chunks[idx]
      const writeChunkPy = isFirst
        ? `Path(${JSON.stringify(tmpFile)}).write_text(${JSON.stringify(chunkB64)}, encoding="ascii")`
        : `with open(${JSON.stringify(tmpFile)}, "a", encoding="ascii") as _f: _f.write(${JSON.stringify(chunkB64)})`
      const applyPy = isLast
        ? [
            'import base64, gzip, json, os',
            'from pathlib import Path',
            writeChunkPy,
            `_raw = base64.b64decode(Path(${JSON.stringify(tmpFile)}).read_text(encoding="ascii"))`,
            `Path(${JSON.stringify(tmpFile)}).unlink(missing_ok=True)`,
            `_payload = json.loads((gzip.decompress(_raw) if ${encoding === 'gzip' ? 'True' : 'False'} else _raw).decode("utf-8"))`,
            '_allowed_top = set(_payload.get("allowedTopLevelPaths") or [])',
            'def _atomic_write(_dest, _txt):',
            '    _dp = Path(_dest)',
            '    _dp.parent.mkdir(parents=True, exist_ok=True)',
            `    _tp = _dp.with_name(f".{_dp.name}.dab_${nonce}.tmp")`,
            '    _tp.write_text(_txt, encoding="utf-8")',
            '    os.replace(_tp, _dp)',
            'for _it in _payload["files"]:',
            '    _nt = os.path.normpath(_it["target"])',
            '    if _nt.startswith("/workspace/skills/") or _nt in _allowed_top:',
            '        _atomic_write(_nt, _it["content"])',
            'for _dp in _payload["deletedPaths"]:',
            '    _nd = os.path.normpath(_dp)',
            '    if _nd.startswith("/workspace/skills/") or _nd in _allowed_top:',
            '        Path(_nd).unlink(missing_ok=True)',
            'if _payload.get("pruneUnlistedSkills") and os.path.isdir("/workspace/skills"):',
            '    _keep = set(_payload.get("managedSkillTargets") or [])',
            '    for _r, _ds, _fs in os.walk("/workspace/skills", topdown=False):',
            '        for _fn in _fs:',
            '            _fp = os.path.join(_r, _fn)',
            '            if _fp not in _keep: Path(_fp).unlink(missing_ok=True)',
            '        for _dn in _ds:',
            '            _dp2 = os.path.join(_r, _dn)',
            '            try:',
            '                if not os.listdir(_dp2): os.rmdir(_dp2)',
            '            except OSError: pass',
            '_atomic_write(_payload["manifestPath"], _payload["manifestJson"])',
            `print(${JSON.stringify(syncMarker)})`,
          ].join('\n')
        : [
            'from pathlib import Path',
            writeChunkPy,
            `print("CHUNK_OK:${idx}")`,
          ].join('\n')

      const promptText = `[SKILL_SYNC:${idx + 1}/${chunks.length}] Run the following Python snippet verbatim via code_execution (do NOT touch /workspace/apps, /workspace/data, or /usr/local/bin) and reply with ${isLast ? syncMarker : `CHUNK_OK:${idx}`}:\n\`\`\`python\n${applyPy}\n\`\`\``
      const started = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', {
        agent: 'antigravity-preview-09-2026',
        agent_config: { type: 'antigravity', model: model || DEFAULT_ANTIGRAVITY_MODEL },
        environment: envId,
        store: false,
        background: false,
        tools: [{ type: 'code_execution' }],
        generation_config: { thinking_level: 'low' },
        input: [{ type: 'text', text: promptText }],
      })
      finalInteraction = await pollInteractionUntilTerminal(extensionSDK, auth, started, envId, signal)
      if (!isLast && !collectInteractionTextCandidates(finalInteraction).includes(`CHUNK_OK:${idx}`)) {
        throw new Error(`Managed skill sync chunk ${idx + 1}/${chunks.length} did not confirm CHUNK_OK:${idx}.`)
      }
    }
  } catch (err) {
    throwIfSyncAborted(signal)
    if (isEnvironmentNotFoundError(err)) {
      return { status: 'environment_expired', updatedCount: 0, deletedCount: 0, sourcesHash: CURRENT_MANAGED_SOURCES_HASH }
    }
    throw err
  }

  throwIfSyncAborted(signal)
  const combinedText = collectInteractionTextCandidates(finalInteraction)
  if (!combinedText.includes(syncMarker)) {
    throw new Error(`Managed skill sync failed: missing ${syncMarker} confirmation in interaction output.`)
  }
  await persistUserEnvIfChanged({ sdk, extensionSDK, userId, nextEnvId: envId, sourcesHash: CURRENT_MANAGED_SOURCES_HASH })
  return {
    status: 'synced',
    updatedCount: changedFiles.length,
    deletedCount: deletedPaths.length,
    sourcesHash: CURRENT_MANAGED_SOURCES_HASH,
  }
}
