export type ExtensionHostStorageLike =
  | {
      localStorageGetItem?: (name: string) => Promise<string | null>
      localStorageSetItem?: (name: string, value?: string) => Promise<unknown>
      localStorageRemoveItem?: (name: string) => Promise<unknown>
    }
  | null
  | undefined

export const DRAFT_PYTHON_SCRIPTS_STORAGE_KEY = 'dab_draft_python_scripts_v1'
export const MAX_LOCAL_DRAFT_SCRIPTS = 25

export interface LocalDraftPythonScript {
  id: string
  title: string
  code: string
  dashboardId?: string
  elementId?: string
  updatedAt: string
}

export const getWinStorage = (key: string): string | null => {
  try {
    return typeof window !== 'undefined' ? (window.localStorage?.getItem?.(key) ?? null) : null
  } catch {
    return null
  }
}

export const getDualStorage = async (
  key: string,
  ext?: ExtensionHostStorageLike | null
): Promise<string | null> => {
  try {
    const extVal = await ext?.localStorageGetItem?.(key)
    if (typeof extVal === 'string' && extVal.length > 0) return extVal
    return getWinStorage(key) ?? (typeof extVal === 'string' ? extVal : null)
  } catch {
    return getWinStorage(key)
  }
}

export const setDualStorage = async (
  key: string,
  val: string,
  ext?: ExtensionHostStorageLike | null
): Promise<void> => {
  try {
    if (typeof window !== 'undefined') window.localStorage?.setItem?.(key, val)
  } catch {
    /* ignore */
  }
  try {
    await ext?.localStorageSetItem?.(key, val)
  } catch {
    /* ignore */
  }
}

function parseDraftScriptsList(raw: string | null): LocalDraftPythonScript[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const items: LocalDraftPythonScript[] = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue
      const rec = entry as Record<string, unknown>
      const id = String(rec.id ?? '').trim().replace(/^obj_script_/, '')
      if (!id || seen.has(id)) continue
      seen.add(id)
      const dashboardId = rec.dashboardId ? String(rec.dashboardId).trim() : ''
      const elementId = rec.elementId ? String(rec.elementId).trim() : ''
      items.push({
        id,
        title: String(rec.title ?? '').trim() || id,
        code: String(rec.code ?? ''),
        ...(dashboardId ? { dashboardId } : {}),
        ...(elementId ? { elementId } : {}),
        updatedAt: String(rec.updatedAt ?? ''),
      })
    }
    return items
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_LOCAL_DRAFT_SCRIPTS)
  } catch {
    return []
  }
}

export async function listLocalDraftScripts(
  extensionSDK?: ExtensionHostStorageLike | null
): Promise<LocalDraftPythonScript[]> {
  return parseDraftScriptsList(await getDualStorage(DRAFT_PYTHON_SCRIPTS_STORAGE_KEY, extensionSDK))
}

export async function loadLocalDraftScript(
  scriptId: string,
  extensionSDK?: ExtensionHostStorageLike | null
): Promise<LocalDraftPythonScript | null> {
  const cleanId = String(scriptId ?? '').trim().replace(/^obj_script_/, '')
  if (!cleanId) return null
  const items = await listLocalDraftScripts(extensionSDK)
  return items.find((item) => item.id === cleanId) ?? null
}

let draftStorageWriteChain: Promise<void> = Promise.resolve()

function withDraftWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = draftStorageWriteChain.then(fn, fn)
  draftStorageWriteChain = next.then(
    () => undefined,
    () => undefined
  )
  return next
}

export async function saveLocalDraftScript(
  script: Omit<LocalDraftPythonScript, 'updatedAt'> & { updatedAt?: string },
  extensionSDK?: ExtensionHostStorageLike | null
): Promise<LocalDraftPythonScript> {
  return withDraftWriteLock(async () => {
    const cleanId =
      String(script.id ?? '')
        .trim()
        .replace(/^obj_script_/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_') || 'draft_script'
    const dashboardId = script.dashboardId ? String(script.dashboardId).trim() : ''
    const elementId = script.elementId ? String(script.elementId).trim() : ''
    const saved: LocalDraftPythonScript = {
      id: cleanId,
      title: String(script.title ?? '').trim() || cleanId,
      code: String(script.code ?? ''),
      ...(dashboardId ? { dashboardId } : {}),
      ...(elementId ? { elementId } : {}),
      updatedAt: String(script.updatedAt ?? '').trim() || new Date().toISOString(),
    }
    const existing = await listLocalDraftScripts(extensionSDK)
    const next = [saved, ...existing.filter((item) => item.id !== cleanId)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_LOCAL_DRAFT_SCRIPTS)
    await setDualStorage(DRAFT_PYTHON_SCRIPTS_STORAGE_KEY, JSON.stringify(next), extensionSDK)
    return saved
  })
}

export async function deleteLocalDraftScript(
  scriptId: string,
  extensionSDK?: ExtensionHostStorageLike | null
): Promise<LocalDraftPythonScript[]> {
  return withDraftWriteLock(async () => {
    const cleanId = String(scriptId ?? '').trim().replace(/^obj_script_/, '')
    const existing = await listLocalDraftScripts(extensionSDK)
    const next = cleanId ? existing.filter((item) => item.id !== cleanId) : existing
    await setDualStorage(DRAFT_PYTHON_SCRIPTS_STORAGE_KEY, JSON.stringify(next), extensionSDK)
    return next
  })
}
