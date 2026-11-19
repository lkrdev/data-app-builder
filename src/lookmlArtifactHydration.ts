import type { ExtensionSDK } from '@looker/extension-sdk'
import type { IProjectFile, Looker40SDK } from '@looker/sdk'

import {
  callInteractionsApi,
  fetchEnvironmentFile,
} from './antigravityAuth'
import {
  type AntigravityAuth,
  type AntigravityInteractionPayload,
  cleanLookmlProjectId,
  collectInteractionTextCandidates,
  parseTaggedJsonObjects,
} from './antigravityTypes'
import { getArtifactService } from './lookerArtifactService'
import { getArtifactNamespace } from './lookerArtifactTypes'
import { rawLookerRequest } from './lookerTransport'
import type { LookmlFileChange } from './lookmlSkills'

export interface LookmlTestResult {
  test_name: string
  model_name?: string
  file_id?: string
  success: boolean
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
  validation?: {
    passed: boolean
    error_count?: number
    errors?: Array<{ message: string; file_path?: string; line_number?: number; severity?: string }>
  }
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
  project_id?: string
  updatedAt: string
  createdBy: string
  bundle: LookmlBundle
  studio?: {
    explores?: string[]
    lastInteractionId?: string
    environmentId?: string
  }
}

export interface LoadLookmlSessionOptions {
  auth?: AntigravityAuth
  environmentId?: string
  lastInteractionId?: string
  projectId?: string
  filePaths?: string[]
  branchName?: string
  modelName?: string
  explores?: string[]
}

export type LookmlInteractionLike = AntigravityInteractionPayload

const sessionLookmlByProject = new Map<string, LookmlArtifactPayload>()

export function clearLookmlSessionCache(): void {
  sessionLookmlByProject.clear()
}

function ensureFileDiff(file: LookmlFileChange): LookmlFileChange {
  if (!file.diff && file.content) {
    const lines = file.content.replace(/\r?\n$/, '').split('\n')
    return Object.assign({}, file, {
      diff: `--- a/${file.path}\n+++ b/${file.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}\n`,
    })
  }
  return file
}

export function extractLookmlBundleFromInteraction(
  interaction?: LookmlInteractionLike | null
): LookmlBundle | null {
  const hit = parseTaggedJsonObjects(
    collectInteractionTextCandidates(interaction),
    /<LOOKML_BUNDLE>([\s\S]*?)<\/LOOKML_BUNDLE>/g
  ).find((p) =>
    Boolean(
      cleanLookmlProjectId(p.project_id) ||
        cleanLookmlProjectId(p.model_name) ||
        (Array.isArray(p.files) && p.files.length > 0) ||
        p.__bundle_ref__ ||
        (typeof p.summary_markdown === 'string' && p.summary_markdown.trim())
    )
  )
  if (!hit) return null
  const bundle = Object.assign({}, hit) as unknown as LookmlBundle
  bundle.project_id = (cleanLookmlProjectId(bundle.project_id) || '') as string
  bundle.id = (cleanLookmlProjectId(bundle.id) || '') as string
  // ponytail: synthesize unified diff for newly created files on client so sandbox stdout omits duplicate content
  bundle.files = (bundle.files || []).map(ensureFileDiff)
  return bundle
}

export function resolveLookmlCanonicalProjectId(bundle?: Partial<LookmlBundle> | null): string {
  return (
    cleanLookmlProjectId(bundle?.project_id) ||
    cleanLookmlProjectId(bundle?.model_name) ||
    cleanLookmlProjectId(bundle?.id)
  )
}

export function mergeLookmlFiles(
  prevFiles: LookmlFileChange[] = [],
  nextFiles: LookmlFileChange[] = []
): LookmlFileChange[] {
  const byPath = new Map<string, LookmlFileChange>()
  prevFiles.forEach((f) => {
    if (f?.path) byPath.set(f.path, ensureFileDiff(f))
  })
  nextFiles.forEach((f) => {
    if (!f?.path) return
    const prev = byPath.get(f.path)
    byPath.set(
      f.path,
      ensureFileDiff(
        Object.assign({}, prev, f, {
          content: f.content !== undefined ? f.content : prev?.content,
          diff: f.diff !== undefined ? f.diff : prev?.diff,
        })
      )
    )
  })
  return Array.from(byPath.values())
}

export function extractLookmlDashboardsFromBundle(bundle?: LookmlBundle | null) {
  const files = bundle?.files || []
  const model =
    cleanLookmlProjectId(bundle?.model_name) ||
    cleanLookmlProjectId(files.map((f) => f.path?.match(/(?:^|\/)([^/]+)\.model\.lkml$/i)?.[1]).find(Boolean)) ||
    cleanLookmlProjectId(bundle?.project_id) ||
    cleanLookmlProjectId(bundle?.id)
  if (!model) return []
  const seen = new Set<string>()
  return files.flatMap((f) => {
    if (!f?.path || f.action === 'deleted' || !/\.dashboard\.l(?:ook)?ml$/i.test(f.path)) return []
    const raw = f.content || (f.diff || '').replace(/^[^+\n].*$/gm, '').replace(/^\+(?!\+\+)/gm, '')
    const slug = (
      raw.match(/^\s*-\s*dashboard:\s*["']?([^\s"'#]+)/m)?.[1] ||
      f.path.split('/').pop()!.replace(/\.dashboard\.l(?:ook)?ml$/i, '')
    ).trim()
    const id = `${model}::${slug}`
    if (!slug || seen.has(id)) return []
    seen.add(id)
    const tm = raw.match(/^\s*title:\s*(?:"([^"\n]+)"|'([^'\n]+)'|([^\n#]+))/m)
    const title =
      (tm?.[1] || tm?.[2] || tm?.[3] || '').trim() ||
      slug.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    return [{ slug, title, model, id, embedPath: `/embed/dashboards/${id}` }]
  })
}

function getLookmlArtifactKeys(userId: string, id: string) {
  const cleanUser = String(userId || 'anon').trim()
  const cleanId = (cleanLookmlProjectId(id) || 'project').replace(/[^a-zA-Z0-9_-]/g, '_')
  return { id: cleanId, userKey: `user_${cleanUser}_lookml_${cleanId}`, objKey: `obj_lookml_${cleanId}` }
}

export async function hydrateLookmlFileContent(params: {
  sdk: Looker40SDK
  extensionSDK?: Partial<ExtensionSDK>
  projectId: string
  sessionId?: string
  filePath: string
  auth?: AntigravityAuth
  environmentId?: string
}): Promise<string | undefined> {
  const { sdk, extensionSDK, projectId, sessionId, filePath, auth, environmentId } = params
  const cleanPath = String(filePath || '').trim().replace(/^\/+/, '')
  if (!cleanPath || cleanPath.split('/').includes('..')) return undefined
  const cleanProj = cleanLookmlProjectId(projectId)
  const cleanSess = String(sessionId || '').trim().replace(/^\/+|\/+$/g, '')
  if (auth && environmentId && !/^env_.*_isolated$/i.test(environmentId)) {
    const sandboxCandidates = cleanPath.startsWith('workspace/')
      ? [`/${cleanPath}`]
      : (cleanProj ? [`/workspace/data/${cleanProj}/lookml/${cleanPath}`] : [])
          .concat(cleanSess && cleanSess !== cleanProj ? [`/workspace/data/${cleanSess}/lookml/${cleanPath}`] : [])
          .concat([`/workspace/lookml/${cleanPath}`, `/workspace/${cleanPath}`])
    for (let i = 0; i < sandboxCandidates.length; i += 1) {
      try {
        const text = await fetchEnvironmentFile({ extensionSDK, auth, environmentId, path: sandboxCandidates[i] })
        if (typeof text === 'string' && text.length > 0) return text
      } catch {
        /* fall back to Looker REST */
      }
    }
  }
  if (!cleanProj) return undefined
  const endpoints = [
    `/projects/${encodeURIComponent(cleanProj)}/file/content`,
    `/projects/${encodeURIComponent(cleanProj)}/files/file/content`,
  ]
  for (let i = 0; i < endpoints.length; i += 1) {
    try {
      const res = await rawLookerRequest<unknown>(sdk, 'GET', endpoints[i], {
        file_path: cleanPath,
        file_id: cleanPath,
      })
      if (typeof res === 'string') return res
      if (res && typeof res === 'object' && typeof (res as { content?: unknown }).content === 'string') {
        return (res as { content: string }).content
      }
    } catch {
      /* try fallback endpoint */
    }
  }
  return undefined
}

export const hydrateLookmlFileContentOnDemand = hydrateLookmlFileContent

function hydrateBundleMissingFileContents(
  sdk: Looker40SDK,
  extensionSDK: Partial<ExtensionSDK> | undefined,
  bundle: LookmlBundle,
  opts?: LoadLookmlSessionOptions
): Promise<LookmlBundle> {
  const projId = cleanLookmlProjectId(bundle.project_id) || cleanLookmlProjectId(bundle.id)
  if (!projId || !Array.isArray(bundle.files) || bundle.files.length === 0) return Promise.resolve(bundle)
  return Promise.all(
    bundle.files.map((f) => {
      if (!f?.path || f.action === 'deleted' || (typeof f.content === 'string' && f.content.length > 0)) {
        return Promise.resolve(ensureFileDiff(f))
      }
      return hydrateLookmlFileContent({
        sdk,
        extensionSDK,
        projectId: projId,
        sessionId: bundle.id || cleanLookmlProjectId(bundle.id),
        filePath: f.path,
        auth: opts?.auth,
        environmentId: opts?.environmentId,
      }).then((content) => ensureFileDiff(typeof content === 'string' ? Object.assign({}, f, { content }) : f))
    })
  ).then((hydratedFiles) => Object.assign({}, bundle, { files: hydratedFiles }))
}

function makeLookmlPayload(
  id: string,
  projectId: string,
  title: string,
  createdBy: string,
  bundle: LookmlBundle,
  studio: { explores?: string[]; lastInteractionId?: string; environmentId?: string },
  updatedAt = new Date().toISOString()
): LookmlArtifactPayload {
  return {
    id,
    type: 'lookml',
    title,
    project_id: projectId,
    updatedAt,
    createdBy,
    bundle,
    studio: {
      explores: studio.explores || [],
      lastInteractionId: studio.lastInteractionId,
      environmentId: studio.environmentId,
    },
  }
}

// ponytail: cache LookML bundles in session memory with 0 Looker Artifact writes; cold loads hydrate live from sandbox / Looker IDE API.
export async function saveLookmlSessionArtifact(params: {
  sdk: Looker40SDK
  extensionSDK?: Partial<ExtensionSDK>
  userId: string
  bundle: LookmlBundle
  studio: { explores?: string[]; lastInteractionId?: string; environmentId?: string }
}) {
  const { sdk, extensionSDK, userId, bundle, studio } = params
  const namespace = getArtifactNamespace(extensionSDK)
  const rawId = resolveLookmlCanonicalProjectId(bundle)
  const { id, userKey, objKey } = getLookmlArtifactKeys(userId, rawId)
  const existing =
    sessionLookmlByProject.get(id) ||
    (await getArtifactService(sdk, namespace).get<LookmlArtifactPayload>(objKey).catch((): null => null))
  const updatedAt = new Date().toISOString()
  const validProj =
    cleanLookmlProjectId(bundle.project_id) ||
    cleanLookmlProjectId(existing?.bundle?.project_id) ||
    rawId ||
    id
  const title = `LookML: ${validProj}`
  const explores = studio.explores || existing?.studio?.explores || []
  const mergedBundle: LookmlBundle = {
    ...existing?.bundle,
    ...bundle,
    id,
    project_id: validProj,
    title: bundle.title || existing?.bundle?.title || title,
    files: mergeLookmlFiles(existing?.bundle?.files, bundle.files),
  }
  const index: LookmlSessionIndex = {
    id,
    type: 'lookml',
    title,
    updatedAt,
    createdBy: String(userId),
    targetId: mergedBundle.project_id || id,
    branchName: mergedBundle.branch_name,
    explores,
    lastInteractionId: studio.lastInteractionId,
    environmentId: studio.environmentId,
  }
  const payload = makeLookmlPayload(
    id,
    validProj,
    title,
    String(userId),
    mergedBundle,
    { explores, lastInteractionId: studio.lastInteractionId, environmentId: studio.environmentId },
    updatedAt
  )
  sessionLookmlByProject.set(id, payload)
  if (validProj && validProj !== id) sessionLookmlByProject.set(validProj, payload)
  return { id, userKey, objKey, index, payload }
}

async function discoverLiveProjectFiles(
  sdk: Looker40SDK,
  projectId: string,
  explicitPaths?: string[]
): Promise<string[]> {
  if (Array.isArray(explicitPaths) && explicitPaths.length > 0) {
    return explicitPaths.map((p) => String(p || '').trim().replace(/^\/+/, '')).filter(Boolean)
  }
  const sdkWithFiles = sdk as Partial<Pick<Looker40SDK, 'all_project_files' | 'ok'>>
  let rawList: unknown = null
  try {
    if (typeof sdkWithFiles.all_project_files === 'function') {
      const p = sdkWithFiles.all_project_files(projectId)
      rawList = typeof sdkWithFiles.ok === 'function' ? await sdkWithFiles.ok(p) : await p
    } else {
      rawList = await rawLookerRequest<unknown>(
        sdk,
        'GET',
        `/projects/${encodeURIComponent(projectId)}/files`
      )
    }
  } catch {
    rawList = null
  }
  if (!Array.isArray(rawList)) return []
  return (rawList as Array<Partial<IProjectFile>>)
    .map((f) => String(f?.path || f?.id || '').trim().replace(/^\/+/, ''))
    .filter((p) => Boolean(p) && /\.(?:lkml|lookml|md|json)$/i.test(p))
    .slice(0, 40)
}

export async function loadLookmlSessionArtifact(
  sdk: Looker40SDK,
  extensionSDK: Partial<ExtensionSDK> | undefined,
  rawId: string,
  fallbackSessionId?: string,
  opts?: LoadLookmlSessionOptions
): Promise<LookmlArtifactPayload> {
  const cleanId = rawId.trim().replace(/^obj_lookml_/, '')
  const cleanFb = String(fallbackSessionId || '').trim().replace(/^obj_lookml_/, '')
  const tsBase = cleanId.match(/^(.+)_[0-9a-z]{6,}$/i)?.[1] || ''
  const candidates = [cleanId, cleanFb, tsBase].filter((v, idx, arr) => v && arr.indexOf(v) === idx)

  const sanitizeLoaded = async (p: LookmlArtifactPayload): Promise<LookmlArtifactPayload> => {
    const proj = cleanLookmlProjectId(p.project_id) || cleanLookmlProjectId(p.bundle?.project_id) || undefined
    const rawBundle = p.bundle
      ? {
          ...p.bundle,
          project_id: cleanLookmlProjectId(p.bundle.project_id) || proj || '',
          id: cleanLookmlProjectId(p.bundle.id) || proj || '',
        }
      : p.bundle
    const hydratedBundle = rawBundle ? await hydrateBundleMissingFileContents(sdk, extensionSDK, rawBundle, opts) : rawBundle
    const out: LookmlArtifactPayload = { ...p, project_id: proj, bundle: hydratedBundle }
    if (proj) sessionLookmlByProject.set(proj, out)
    sessionLookmlByProject.set(cleanId, out)
    return out
  }

  for (const cand of candidates) {
    const mem = sessionLookmlByProject.get(cand)
    if (mem) return sanitizeLoaded(mem)
  }

  let extractedMeta: LookmlBundle | null = null
  if (opts?.lastInteractionId && opts?.auth) {
    const inter = await callInteractionsApi(
      extensionSDK,
      opts.auth,
      `interactions/${encodeURIComponent(opts.lastInteractionId)}`,
      'GET'
    ).catch(() => null)
    let extracted = extractLookmlBundleFromInteraction(inter)
    const refPath = (extracted as unknown as { __bundle_ref__?: string } | null)?.__bundle_ref__
    if (refPath && opts.environmentId) {
      const refRaw = await fetchEnvironmentFile({
        extensionSDK,
        auth: opts.auth,
        environmentId: opts.environmentId,
        path: String(refPath),
      }).catch(() => '')
      if (refRaw) {
        extracted =
          extractLookmlBundleFromInteraction({ output_text: `<LOOKML_BUNDLE>${refRaw}</LOOKML_BUNDLE>` }) || extracted
      }
    }
    if (extracted) {
      const proj = resolveLookmlCanonicalProjectId(extracted) || cleanLookmlProjectId(cleanId) || cleanId
      const hydrated = await hydrateBundleMissingFileContents(
        sdk,
        extensionSDK,
        { ...extracted, id: proj, project_id: proj },
        opts
      )
      if (hydrated.files && hydrated.files.length > 0) {
        return sanitizeLoaded(
          makeLookmlPayload(proj, proj, hydrated.title || `LookML: ${proj}`, '1', hydrated, opts)
        )
      }
      extractedMeta = hydrated
    }
  }

  const targetProj =
    cleanLookmlProjectId(opts?.projectId) ||
    resolveLookmlCanonicalProjectId(extractedMeta) ||
    cleanLookmlProjectId(cleanId) ||
    cleanLookmlProjectId(tsBase) ||
    cleanLookmlProjectId(cleanFb)
  if (targetProj) {
    const livePaths = await discoverLiveProjectFiles(sdk, targetProj, opts?.filePaths)
    if (livePaths.length > 0) {
      const liveFiles: LookmlFileChange[] = (
        await Promise.all(
          livePaths.map((p): Promise<LookmlFileChange | null> =>
            hydrateLookmlFileContent({
              sdk,
              extensionSDK,
              projectId: targetProj,
              sessionId: cleanFb || cleanId,
              filePath: p,
              auth: opts?.auth,
              environmentId: opts?.environmentId,
            }).then((content) => (typeof content === 'string' ? ensureFileDiff({ path: p, action: 'updated', content }) : null))
          )
        )
      ).filter((f): f is LookmlFileChange => Boolean(f))
      if (liveFiles.length > 0) {
        const modelFile = liveFiles.find((f) => /\.model\.lkml$/i.test(f.path))
        const inferredModel =
          opts?.modelName || extractedMeta?.model_name || modelFile?.path.split('/').pop()?.replace(/\.model\.lkml$/i, '')
        const title = extractedMeta?.title || `LookML: ${targetProj}`
        return sanitizeLoaded(
          makeLookmlPayload(
            targetProj,
            targetProj,
            title,
            '1',
            {
              ...extractedMeta,
              id: targetProj,
              title,
              project_id: targetProj,
              model_name: inferredModel,
              branch_name: opts?.branchName || extractedMeta?.branch_name,
              files: liveFiles,
            },
            opts || {}
          )
        )
      }
    }
  }

  // Read-only fallback for pre-existing legacy `obj_lookml_*` records
  const svc = getArtifactService(sdk, getArtifactNamespace(extensionSDK))
  for (let i = 0; i < candidates.length; i += 1) {
    const hit = await svc.get<LookmlArtifactPayload>(`obj_lookml_${candidates[i]}`).catch((): null => null)
    if (hit) return sanitizeLoaded(hit)
  }
  const rows = await svc.search(`obj_lookml_${cleanId}_%`).catch(() => [])
  const parsed = (rows || [])
    .map((r) =>
      typeof r?.value === 'string'
        ? (JSON.parse(r.value) as LookmlArtifactPayload)
        : (r?.value as LookmlArtifactPayload | undefined)
    )
    .filter((p): p is LookmlArtifactPayload => Boolean(p?.bundle))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  const fallbackHit =
    parsed[0] ||
    (await svc.loadObjectArtifact<LookmlArtifactPayload>('lookml', cleanId).catch((): null => null))
  if (!fallbackHit) throw new Error(`LookML session artifact "obj_lookml_${cleanId}" not found.`)
  return sanitizeLoaded(fallbackHit)
}
