import type { IFolder, IUser, Looker40SDK } from '@looker/sdk'

import { coalesceLookerMetadataRequest, LOOKER_METADATA_CACHE_TTL_MS } from './lookerTransport'

export interface LookerFolderNode {
  id: string
  name: string
  parent_id?: string | null
  child_count?: number
  is_personal?: boolean
  is_personal_descendant?: boolean
  creator_id?: string | null
  has_children?: boolean
  can?: Record<string, boolean>
}

export interface SearchLookerFoldersParams {
  name?: string
  parent_id?: string
  is_personal?: boolean | string
  is_personal_descendant?: boolean | string
  creator_id?: string
  id?: string
  fields?: string
  knownFolders?: LookerFolderNode[] | Record<string, LookerFolderNode>
  knownUsers?: Array<{ id: string; display_name?: string | null; email?: string | null }>
}

export const LOOKER_FOLDER_FIELDS =
  'id,name,parent_id,child_count,is_personal,is_personal_descendant,creator_id,can'

export type RawLookerFolderLike = Partial<IFolder> & {
  has_children?: boolean
}

export function normalizeLookerFolderNode(
  raw: RawLookerFolderLike | null | undefined,
  fallbackParentId?: string | null,
  allFoldersList?: RawLookerFolderLike[]
): LookerFolderNode {
  const fid = String(raw?.id ?? '')
  const countedChildren = Array.isArray(allFoldersList)
    ? allFoldersList.filter((c) => String(c?.parent_id ?? '') === fid).length
    : undefined
  const childCount =
    typeof raw?.child_count === 'number'
      ? Math.max(raw.child_count, countedChildren ?? 0)
      : countedChildren
  const parentId =
    raw?.parent_id !== undefined && raw?.parent_id !== null && raw?.parent_id !== ''
      ? String(raw.parent_id)
      : fallbackParentId ?? null
  return Object.assign(
    {
      id: fid,
      name: String(raw?.name || `Folder #${fid}`),
      parent_id: parentId,
      is_personal: Boolean(raw?.is_personal),
      is_personal_descendant: Boolean(raw?.is_personal_descendant),
      has_children:
        typeof raw?.has_children === 'boolean'
          ? raw.has_children
          : childCount === undefined
          ? true
          : childCount > 0,
    },
    childCount !== undefined ? { child_count: childCount } : null,
    raw?.creator_id != null ? { creator_id: String(raw.creator_id) } : null,
    raw?.can ? { can: raw.can } : null
  )
}

export function buildRootLookerFolders(user?: Partial<IUser> | null): LookerFolderNode[] {
  const canEdit = { show: true, edit_content: true, save_content: true }
  const candidates: LookerFolderNode[] = [
    { id: String(user?.personal_folder_id || '5'), name: 'My folder', parent_id: null, is_personal: true, has_children: true, can: canEdit },
    { id: String(user?.home_folder_id || '1'), name: 'Shared folders', parent_id: null, is_personal: false, has_children: true, can: canEdit },
    { id: '2', name: 'People', parent_id: null, is_personal: false, has_children: true },
    { id: '3', name: 'Embed Users', parent_id: null, is_personal: false, has_children: true },
    { id: '4', name: 'Embed Groups', parent_id: null, is_personal: false, has_children: true },
  ]
  return Array.from(new Map(candidates.filter((n) => n.id).map((n) => [n.id, n])).values())
}

interface LookerFolderSdkLike {
  ok?: <T>(p: Promise<T>) => Promise<T>
  get?: unknown
  me?: (fields?: string) => Promise<Partial<IUser>>
  search_users?: (params: Record<string, unknown>) => Promise<Array<Partial<IUser>>>
  folder?: (...args: unknown[]) => Promise<RawLookerFolderLike>
  folder_ancestors?: (...args: unknown[]) => Promise<RawLookerFolderLike[]>
  folder_children?: (params: { folder_id: string; fields: string }) => Promise<RawLookerFolderLike[]>
  all_folders?: (fields: string) => Promise<RawLookerFolderLike[]>
  search_folders?: (req: Record<string, unknown>) => Promise<RawLookerFolderLike[]>
}

async function unwrapSdkCall<T>(sdk: LookerFolderSdkLike, p: Promise<T> | T): Promise<T> {
  const resolved = await p
  if (typeof sdk?.ok === 'function') return sdk.ok(Promise.resolve(resolved))
  return resolved
}

export async function fetchFolderChildren(
  sdk: Looker40SDK,
  folderId: string
): Promise<LookerFolderNode[]> {
  const fid = String(folderId || '').trim()
  if (!fid) return []
  return coalesceLookerMetadataRequest(
    `folder_children:${fid}`,
    async () => {
      const s = sdk as unknown as LookerFolderSdkLike
      if (typeof s?.folder_children === 'function') {
        try {
          const rows = await unwrapSdkCall(
            s,
            s.folder_children({
              folder_id: fid,
              fields: 'id,name,parent_id,child_count,is_personal,can',
            })
          )
          if (Array.isArray(rows)) {
            return rows.map((r) => normalizeLookerFolderNode(r, fid))
          }
        } catch {
          // Fall back to all_folders when folder_children is not entitled or fails
        }
      }
      if (typeof s?.all_folders === 'function') {
        try {
          const all = await unwrapSdkCall(
            s,
            s.all_folders('id,name,parent_id,child_count,is_personal,can')
          )
          const list = Array.isArray(all) ? all : []
          return list
            .filter((r) => String(r?.parent_id ?? '') === fid)
            .map((r) => normalizeLookerFolderNode(r, fid, list))
        } catch {
          // ignore all_folders fallback error
        }
      }
      return []
    },
    LOOKER_METADATA_CACHE_TTL_MS,
    ['looker:folder_children', fid]
  )
}

async function callFolderIdEndpoint(
  sdk: LookerFolderSdkLike,
  method: 'folder' | 'folder_ancestors',
  folderId: string,
  fields: string
): Promise<unknown> {
  const fn = sdk?.[method]
  if (typeof fn !== 'function') return null
  if (typeof sdk?.get === 'function') {
    return unwrapSdkCall(sdk, fn.call(sdk, folderId, fields))
  }
  try {
    const res = await unwrapSdkCall(sdk, fn.call(sdk, { folder_id: folderId, fields }))
    if (res !== undefined) return res
  } catch {
    // fall back to positional call
  }
  return unwrapSdkCall(sdk, fn.call(sdk, folderId, fields))
}

export async function fetchFolderWithAncestors(
  sdk: Looker40SDK,
  folderId: string
): Promise<{
  folder: LookerFolderNode | null
  ancestors: LookerFolderNode[]
  chain: LookerFolderNode[]
  expandedIds: string[]
}> {
  const fid = String(folderId || '').trim()
  if (!fid) return { folder: null, ancestors: [], chain: [], expandedIds: [] }
  return coalesceLookerMetadataRequest(
    `folder_ancestors:${fid}`,
    async () => {
      const s = sdk as unknown as LookerFolderSdkLike
      let rawFolder: RawLookerFolderLike | null = null
      let rawAncestors: RawLookerFolderLike[] | null = null
      try {
        if (typeof s?.folder === 'function') {
          rawFolder = (await callFolderIdEndpoint(s, 'folder', fid, LOOKER_FOLDER_FIELDS)) as RawLookerFolderLike | null
        }
      } catch {
        // ignore folder lookup error
      }
      try {
        if (typeof s?.folder_ancestors === 'function') {
          const anc = await callFolderIdEndpoint(s, 'folder_ancestors', fid, LOOKER_FOLDER_FIELDS)
          if (Array.isArray(anc)) rawAncestors = anc as RawLookerFolderLike[]
        }
      } catch {
        // ignore folder_ancestors lookup error
      }

      let allFoldersFallbackList: RawLookerFolderLike[] | undefined
      if ((!rawFolder || !rawAncestors) && typeof s?.all_folders === 'function') {
        try {
          const all = await unwrapSdkCall(s, s.all_folders(LOOKER_FOLDER_FIELDS))
          const list = Array.isArray(all) ? all : []
          allFoldersFallbackList = list
          const byId = new Map<string, RawLookerFolderLike>(
            list.map((f) => [String(f.id), f])
          )
          if (!rawFolder) rawFolder = byId.get(fid) || null
          if (!rawAncestors && rawFolder) {
            const chainUp: RawLookerFolderLike[] = []
            let cur = rawFolder.parent_id ? byId.get(String(rawFolder.parent_id)) : null
            const visited = new Set<string>([fid])
            while (cur && !visited.has(String(cur.id))) {
              visited.add(String(cur.id))
              chainUp.unshift(cur)
              cur = cur.parent_id ? byId.get(String(cur.parent_id)) : null
            }
            rawAncestors = chainUp
          }
        } catch {
          // ignore all_folders fallback error
        }
      }

      const folder = rawFolder
        ? normalizeLookerFolderNode(rawFolder, undefined, allFoldersFallbackList)
        : null
      const normAnc = (rawAncestors || []).map((a) =>
        normalizeLookerFolderNode(a, undefined, allFoldersFallbackList)
      )
      const orderedAncestors =
        normAnc.length > 1 && normAnc[0].parent_id ? [...normAnc].reverse() : normAnc
      const chain = [...orderedAncestors, ...(folder ? [folder] : [])]
      return {
        folder,
        ancestors: orderedAncestors,
        chain,
        expandedIds: orderedAncestors.map((a) => a.id),
      }
    },
    LOOKER_METADATA_CACHE_TTL_MS,
    ['looker:folder_ancestors', fid]
  )
}

export async function searchLookerFolders(
  sdk: Looker40SDK,
  params: SearchLookerFoldersParams = {}
): Promise<LookerFolderNode[]> {
  const req: Record<string, unknown> = { fields: params.fields || LOOKER_FOLDER_FIELDS }
  const rawName = params.name?.trim() || ''
  const rawParent = params.parent_id?.trim() || ''
  const rawCreator = params.creator_id?.trim() || ''
  if (rawName) req.name = rawName
  if (rawParent) req.parent_id = rawParent
  if (params.id?.trim()) req.id = params.id.trim()
  if (rawCreator) req.creator_id = rawCreator
  if (params.is_personal !== undefined && params.is_personal !== '' && params.is_personal !== 'any') {
    req.is_personal = params.is_personal === true || params.is_personal === 'true'
  }
  if (params.is_personal_descendant !== undefined && params.is_personal_descendant !== '' && params.is_personal_descendant !== 'any') {
    req.is_personal_descendant = params.is_personal_descendant === true || params.is_personal_descendant === 'true'
  }
  const knownFoldersList: LookerFolderNode[] = Array.isArray(params.knownFolders)
    ? params.knownFolders
    : params.knownFolders && typeof params.knownFolders === 'object'
    ? Object.values(params.knownFolders)
    : []

  return coalesceLookerMetadataRequest(
    `search_folders:${JSON.stringify(req)}`,
    async () => {
      const s = sdk as unknown as LookerFolderSdkLike
      const execReq: Record<string, unknown> = Object.assign({}, req)
      const safeCall = async <T>(fn: () => Promise<T>): Promise<T | null> => {
        try { return await fn() } catch { return null }
      }

      if (rawParent && !/^\d+$/.test(rawParent)) {
        const parenId = rawParent.match(/\((\d+)\)\s*$/)?.[1]
        if (parenId) {
          execReq.parent_id = parenId
        } else {
          const parentQ = rawParent.toLowerCase()
          const matchByName = (list: LookerFolderNode[]) => list.filter((f) => f.name.toLowerCase().includes(parentQ))
          let candidates = matchByName(knownFoldersList)
          if (!candidates.length && typeof s?.all_folders === 'function') {
            const all = await safeCall(() => unwrapSdkCall(s, s.all_folders!(LOOKER_FOLDER_FIELDS)))
            if (Array.isArray(all)) candidates = matchByName(all.map((r) => normalizeLookerFolderNode(r, undefined, all)))
          }
          if (!candidates.length && typeof s?.folder_children === 'function') {
            const ch = await safeCall(() => unwrapSdkCall(s, s.folder_children!({ folder_id: '1', fields: 'id,name,parent_id,child_count,is_personal,can' })))
            if (Array.isArray(ch)) candidates = matchByName(ch.map((r) => normalizeLookerFolderNode(r, '1')))
          }
          if (!candidates.length && typeof s?.search_folders === 'function') {
            const found = await safeCall(() => unwrapSdkCall(s, s.search_folders!({ name: rawParent, fields: LOOKER_FOLDER_FIELDS })))
            if (Array.isArray(found)) candidates = matchByName(found.map((r) => normalizeLookerFolderNode(r)))
          }
          if (candidates.length > 0) {
            execReq.parent_id = String((candidates.find((f) => f.name.toLowerCase() === parentQ) || candidates[0]).id)
          }
        }
      }

      if (rawCreator && !/^\d+$/.test(rawCreator)) {
        const parenUid = rawCreator.match(/\((\d+)\)\s*$/)?.[1]
        if (parenUid) {
          execReq.creator_id = parenUid
        } else {
          const creatorQ = rawCreator.toLowerCase()
          const matchesUser = (u?: { id?: string | number | null; display_name?: string | null; email?: string | null } | null) =>
            Boolean(u?.display_name?.toLowerCase().includes(creatorQ) || u?.email?.toLowerCase().includes(creatorQ) || String(u?.id ?? '').toLowerCase() === creatorQ)
          const matchedUser = (params.knownUsers || []).find(matchesUser)
          if (matchedUser?.id) {
            execReq.creator_id = String(matchedUser.id)
          } else if (typeof s?.search_users === 'function') {
            const users = await safeCall(() => unwrapSdkCall(s, s.search_users!({ display_name: rawCreator })))
            const u = Array.isArray(users) ? users.find(matchesUser) || users[0] : null
            if (u?.id != null) execReq.creator_id = String(u.id)
          } else if (typeof s?.me === 'function') {
            const meUser = await safeCall(() => unwrapSdkCall(s, s.me!('id,display_name,email')))
            if (meUser?.id != null && matchesUser(meUser)) execReq.creator_id = String(meUser.id)
          }
        }
      }

      if (typeof s?.search_folders === 'function') {
        const rows = await safeCall(async () => {
          let r = await unwrapSdkCall(s, s.search_folders!(execReq))
          if ((!Array.isArray(r) || r.length === 0) && rawName && /^\d+$/.test(rawName) && !execReq.id) {
            const byIdReq = Object.assign({}, execReq, { id: rawName })
            delete byIdReq.name
            r = await unwrapSdkCall(s, s.search_folders!(byIdReq))
          }
          return r
        })
        if (Array.isArray(rows)) return rows.map((r) => normalizeLookerFolderNode(r))
      }
      if (typeof s?.all_folders === 'function') {
        const rows = await safeCall(() => unwrapSdkCall(s, s.all_folders!(LOOKER_FOLDER_FIELDS)))
        if (Array.isArray(rows)) {
          const all = rows.map((r) => normalizeLookerFolderNode(r, undefined, rows))
          const nameQ = String(execReq.name || '').replace(/%/g, '').trim().toLowerCase()
          const parentFilter = String(execReq.parent_id || '').trim()
          const creatorFilter = String(execReq.creator_id || '').trim()
          return all.filter((f) => {
            if (nameQ && !f.name.toLowerCase().includes(nameQ) && String(f.id).toLowerCase() !== nameQ) return false
            if (parentFilter) {
              const pNode = all.find((p) => String(p.id) === String(f.parent_id || ''))
              if (String(f.parent_id || '') !== parentFilter && !pNode?.name.toLowerCase().includes(parentFilter.toLowerCase())) return false
            }
            if (execReq.id && String(f.id) !== String(execReq.id)) return false
            if (creatorFilter && String(f.creator_id || '') !== creatorFilter) return false
            if (typeof execReq.is_personal === 'boolean' && Boolean(f.is_personal) !== execReq.is_personal) return false
            if (typeof execReq.is_personal_descendant === 'boolean' && Boolean(f.is_personal_descendant) !== execReq.is_personal_descendant) return false
            return true
          })
        }
      }
      return []
    },
    LOOKER_METADATA_CACHE_TTL_MS,
    ['looker:search_folders', req]
  )
}
