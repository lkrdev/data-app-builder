import type { ExtensionSDK } from '@looker/extension-sdk'
import type { ILookmlModel, Looker40SDK } from '@looker/sdk'
import { mutate, SWRConfig, unstable_serialize } from 'swr'

import { callInteractionsApi } from './antigravityAuth'
import { AntigravityAuth, DEFAULT_ANTIGRAVITY_MODEL } from './antigravityTypes'
import { loadSingleConversationArtifact, type UserConversationEntry } from './lookerArtifacts'
import { extractResolvedUseCase, ResolvedStudioUseCase, StudioUseCase } from './lookerPermissions'
import {
  coalesceLookerMetadataRequest,
  formatExploreId,
  LOOKER_METADATA_CACHE_TTL_MS,
  normalizeQueryFiltersToFixedDates,
  parseExploreId,
  rawLookerRequest,
} from './lookerTransport'

export const CA_EMBED_COLLAPSE_PARAMS: ReadonlyArray<readonly [string, string]> = [
  ['hide_sidebar', 'true'], ['hide_data_source_panel', 'true'], ['sidebar_collapsed', 'true'], ['right_panel_collapsed', 'true'],
]

export function normalizeCaEmbedPath(rawPath: string, agentId?: string): string {
  const cleanRaw = String(rawPath || '').trim()
  if (!cleanRaw) return ''
  const [pathAndQuery, hashPart] = cleanRaw.split('#')
  const qIdx = pathAndQuery.indexOf('?')
  let pathname = qIdx >= 0 ? pathAndQuery.slice(0, qIdx) : pathAndQuery
  if (/^\/(?:conversations|agents)\//.test(pathname)) pathname = `/embed${pathname}`
  const params = new URLSearchParams(qIdx >= 0 ? pathAndQuery.slice(qIdx + 1) : '')
  const cleanAgentId = String(agentId || '').trim()
  if (cleanAgentId && !params.has('agent_id')) params.set('agent_id', cleanAgentId)
  for (const [k, v] of CA_EMBED_COLLAPSE_PARAMS) if (!params.has(k)) params.set(k, v)
  const qs = params.toString()
  return `${pathname}${qs ? `?${qs}` : ''}${hashPart ? `#${hashPart}` : ''}`
}

export function buildCaEmbedPath(caConversationId: string, agentId?: string): string {
  const cleanConvId = encodeURIComponent(String(caConversationId || '').trim())
  const cleanAgentId = String(agentId || '').trim()
  return normalizeCaEmbedPath(cleanAgentId ? `/embed/conversations/${cleanConvId}?agent_id=${encodeURIComponent(cleanAgentId)}` : `/embed/conversations/${cleanConvId}`, cleanAgentId)
}

export function resolveCaEmbedPath(agentId: string, caConversationId: string, explicitPath?: string): string {
  return explicitPath && /^\/(?:embed\/)?(?:conversations|agents)\//.test(explicitPath)
    ? normalizeCaEmbedPath(explicitPath, agentId)
    : buildCaEmbedPath(caConversationId, agentId)
}

export const CA_AGENT_SELECTION_REQUEST_TAG = '[CA_AGENT_SELECTION_REQUEST]'

export interface LookerCaGoldenQuery { questions: string[]; model?: string; explore?: string; fields?: string[] }
export interface LookerCaAgentSummary { id: string; name: string; description: string; instructions: string; explores: string[]; goldenQueries: LookerCaGoldenQuery[]; golden_queries?: LookerCaGoldenQuery[] }
export interface CaAgentSelectionResult { agentId: string; agentName: string; rationale: string; initialQuestion: string; explores: string[]; catalogSize: number; isolatedInteractionId?: string }
export interface CaConversationState {
  id: string; caConversationId: string; agentId: string; agentName: string; embedPath: string; title: string; label: string
  rationale: string; selectionRationale: string; initialPrompt: string; explores: string[]; interactionId?: string; updatedAt: string
}

// ponytail: delegate Turn-1 auto-classification to extractResolvedUseCase in lookerPermissions.ts.
export function classifyStudioUseCase(userPrompt: string, explicitUseCase: StudioUseCase = 'auto', allowedModes?: string[]): ResolvedStudioUseCase {
  return explicitUseCase && explicitUseCase !== 'auto' ? explicitUseCase : extractResolvedUseCase('', userPrompt, allowedModes)
}

export interface RawLookerCaAgent {
  id?: string; agent_id?: string; name?: string; title?: string; description?: string; deleted?: boolean
  context?: string | { instructions?: string; golden_queries?: unknown[] }
  system_instructions?: string; instructions?: string
  sources?: Array<{
    model?: string; explore?: string
    looker_explores?: Array<{ model_name?: string; model?: string; explore_name?: string; explore?: string }>
  }>
  explores?: Array<string | { model?: string; explore?: string }>
  golden_queries?: unknown[]; goldenQueries?: unknown[]; example_questions?: unknown[]
}

export function normalizeCaAgent(raw: unknown): LookerCaAgentSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as RawLookerCaAgent
  if (r.deleted === true) return null
  const id = String(r.id || r.agent_id || '').trim()
  if (!id) return null
  const name = String(r.name || r.title || id).trim()
  const description = String(r.description || '').trim()
  const ctxObj = typeof r.context === 'object' && r.context !== null ? r.context : undefined
  const instructions = String(ctxObj?.instructions || r.system_instructions || r.instructions || (typeof r.context === 'string' ? r.context : '') || '').trim()

  const exploreSet = new Set<string>()
  for (const s of Array.isArray(r.sources) ? r.sources : []) {
    if (s?.model && s?.explore) exploreSet.add(formatExploreId(String(s.model), String(s.explore)))
    for (const le of Array.isArray(s?.looker_explores) ? s.looker_explores : []) {
      const m = le?.model_name || le?.model
      const e = le?.explore_name || le?.explore
      if (m && e) exploreSet.add(formatExploreId(String(m), String(e)))
    }
  }
  for (const e of Array.isArray(r.explores) ? r.explores : []) {
    if (typeof e === 'string' && e.includes('::')) exploreSet.add(e.trim())
    else if (typeof e === 'object' && e?.model && e?.explore) exploreSet.add(formatExploreId(String(e.model), String(e.explore)))
  }

  const rawGqs = [
    ...(Array.isArray(r.golden_queries) ? r.golden_queries : []),
    ...(Array.isArray(r.goldenQueries) ? r.goldenQueries : []),
    ...(Array.isArray(ctxObj?.golden_queries) ? ctxObj.golden_queries : []),
    ...(Array.isArray(r.example_questions) ? r.example_questions : []),
  ]
  const goldenQueries: LookerCaGoldenQuery[] = []
  for (const gqItem of rawGqs) {
    if (typeof gqItem === 'string' && gqItem.trim()) {
      goldenQueries.push({ questions: [gqItem.trim()] })
      continue
    }
    if (!gqItem || typeof gqItem !== 'object') continue
    const gq = gqItem as { questions?: unknown[]; question?: string; query?: string; model?: string; explore?: string; fields?: unknown[] }
    const questions = Array.isArray(gq.questions)
      ? gq.questions.map((q) => String(q || '').trim()).filter(Boolean)
      : gq.question || gq.query ? [String(gq.question || gq.query).trim()] : []
    if (gq.model && gq.explore) exploreSet.add(formatExploreId(String(gq.model), String(gq.explore)))
    if (questions.length > 0 || (gq.fields && gq.fields.length > 0)) {
      goldenQueries.push({
        questions,
        model: gq.model ? String(gq.model) : undefined,
        explore: gq.explore ? String(gq.explore) : undefined,
        fields: Array.isArray(gq.fields) ? gq.fields.map(String) : undefined,
      })
    }
  }

  return { id, name, description, instructions, explores: Array.from(exploreSet), goldenQueries, golden_queries: goldenQueries }
}

export async function fetchLookerCaAgentsCatalog(
  sdk: Looker40SDK,
  _fallbackModels?: Array<Partial<ILookmlModel>>,
  options?: { allowEmpty?: boolean }
): Promise<LookerCaAgentSummary[]> {
  let rawList: unknown[] = []
  try {
    const sdkWithAgents = sdk as unknown as { search_agents?: () => Promise<unknown> }
    const res = typeof sdkWithAgents?.search_agents === 'function'
      ? await sdk.ok(sdkWithAgents.search_agents() as never)
      : await rawLookerRequest<unknown[]>(sdk, 'GET', '/agents/search')
    if (Array.isArray(res)) rawList = res
  } catch { rawList = [] }
  const normalized = rawList.map(normalizeCaAgent).filter((a): a is LookerCaAgentSummary => Boolean(a))
  const result = normalized.length > 0 || options?.allowEmpty
    ? normalized
    : [{
        id: 'ad69f74cd9e2494090e9e9e9c50190c8', name: 'eCommerce',
        description: 'eCommerce Order Items & Fulfillment Analytics Agent',
        instructions: 'Answer eCommerce revenue, order status, and customer questions on thelook::order_items.',
        explores: ['thelook::order_items'], goldenQueries: [{ questions: ['what are our shipping statuses?'] }],
        golden_queries: [{ questions: ['what are our shipping statuses?'] }],
      }]
  const swrDefault = (SWRConfig as unknown as { default?: { cache?: { set?: (k: string, v: unknown) => void } } }).default
  swrDefault?.cache?.set?.(unstable_serialize(['looker:ca_agents']), result)
  void mutate(['looker:ca_agents'], result, false).catch(() => {})
  return result
}

export function scoreCaAgentLocally(agent: LookerCaAgentSummary, userQuestion: string): number {
  const tokens = String(userQuestion || '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 2 && !['what', 'how', 'the', 'are', 'our', 'for', 'and', 'show', 'with'].includes(t))
  if (tokens.length === 0) return 1
  const gqText = agent.goldenQueries.flatMap((g) => [...g.questions, ...(g.fields || []), g.model || '', g.explore || '']).join(' ').toLowerCase()
  const expText = agent.explores.join(' ').toLowerCase()
  const nameDesc = `${agent.name} ${agent.description}`.toLowerCase()
  const instrText = agent.instructions.toLowerCase()
  return tokens.reduce(
    (score, tok) => score + (gqText.includes(tok) ? 6 : 0) + (expText.includes(tok) ? 5 : 0) + (nameDesc.includes(tok) ? 4 : 0) + (instrText.includes(tok) ? 2 : 0),
    0
  )
}

export function buildIsolatedCaSelectorPrompt(
  agents: LookerCaAgentSummary[],
  userQuestion: string,
  selectedExplores: string[] = []
): string {
  const catalogJson = agents.map((a) => ({
    agent_id: a.id, name: a.name, description: a.description, system_instructions: a.instructions.slice(0, 600),
    explores: a.explores, golden_queries: a.goldenQueries.slice(0, 8).flatMap((g) => g.questions.slice(0, 2)),
  }))
  return [
    CA_AGENT_SELECTION_REQUEST_TAG,
    'You are an isolated Conversational Analytics (CA) Router Sub-Agent.',
    "Inspect the Looker CA agents catalog below (name, description, system_instructions, model::explore sources, and golden_queries) and select the single best `agent_id` to answer the user's question.",
    'Do NOT call any tools or read any skill files. Reply with ONLY:',
    '<CA_AGENT_SELECTION>{"agent_id":"<best_agent_id>","rationale":"<concise 1-sentence reason>"}</CA_AGENT_SELECTION>',
    selectedExplores.length > 0 ? `Pre-selected Explores: ${selectedExplores.join(', ')}` : '',
    `Available Looker CA Agents (${agents.length}):`,
    JSON.stringify(catalogJson, null, 2),
    `User Question: ${userQuestion}`,
  ].filter(Boolean).join('\n')
}

export function parseCaAgentSelectionResponse(
  rawText: string,
  catalog: LookerCaAgentSummary[],
  userQuestion = ''
): CaAgentSelectionResult {
  const text = String(rawText || '').trim()
  const byId = new Map(catalog.map((a) => [a.id, a]))
  const bestLocal = [...catalog].sort((a, b) => scoreCaAgentLocally(b, userQuestion) - scoreCaAgentLocally(a, userQuestion))[0] || catalog[0]
  const tagMatch = text.match(/<CA_AGENT_SELECTION>([\s\S]*?)<\/CA_AGENT_SELECTION>/i)
  const candidateJson = tagMatch ? tagMatch[1].trim() : text
  try {
    const jsonMatch = candidateJson.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      const hit = byId.get(String(parsed.agent_id || parsed.agentId || parsed.id || '').trim())
      if (hit) {
        return {
          agentId: hit.id,
          agentName: String(parsed.agent_name || parsed.agentName || hit.name).trim(),
          rationale: String(parsed.rationale || parsed.reason || `Matched CA agent "${hit.name}".`).trim(),
          initialQuestion: String(parsed.initial_question || parsed.initialQuestion || userQuestion).trim(),
          explores: hit.explores,
          catalogSize: catalog.length,
        }
      }
    }
  } catch { /* ignore malformed CA selection JSON */ }

  const hit = catalog.find((a) => text.includes(a.id)) || bestLocal
  return {
    agentId: hit?.id || 'ad69f74cd9e2494090e9e9e9c50190c8',
    agentName: hit?.name || 'eCommerce',
    rationale: hit
      ? `Selected Looker CA agent "${hit.name}" based on explore and golden query alignment.`
      : 'Selected default Looker Conversational Analytics agent.',
    initialQuestion: userQuestion,
    explores: hit?.explores || [],
    catalogSize: catalog.length,
  }
}

export const parseCaAgentSelectionOutput = parseCaAgentSelectionResponse

export const CA_AGENT_SELECTION_RESPONSE_FORMAT = {
  type: 'json_schema',
  mime_type: 'application/json',
  schema: {
    type: 'object',
    properties: {
      agent_id: { type: 'string' }, agent_name: { type: 'string' },
      rationale: { type: 'string' }, initial_question: { type: 'string' },
    },
    required: ['agent_id', 'rationale'],
  },
}

// ponytail: stateless isolated sub-agent interaction (direct model inference with store: false,
// previous_interaction_id omitted, and tools: []) so the full CA agents catalog never enters the main conversation history.
export async function selectCaAgentViaIsolatedSubagent(params: {
  sdk?: Looker40SDK; extensionSDK?: Partial<ExtensionSDK>; auth: AntigravityAuth; environmentId?: string
  userQuestion?: string; userPrompt?: string; model?: string; preselectedOutput?: string
  agentsCatalog?: LookerCaAgentSummary[]; agents?: LookerCaAgentSummary[]; selectedExplores?: string[]
  onStatus?: (statusText: string) => void
}): Promise<CaAgentSelectionResult> {
  const { sdk, extensionSDK, auth, userQuestion, userPrompt, model = DEFAULT_ANTIGRAVITY_MODEL, preselectedOutput, agentsCatalog, agents, selectedExplores = [], onStatus } = params
  const question = String(userQuestion || userPrompt || '').trim()
  const providedAgents = agents || agentsCatalog
  onStatus?.('Discovering Looker Conversational Analytics agents...')
  const catalog = providedAgents && providedAgents.length > 0 ? providedAgents : sdk ? await fetchLookerCaAgentsCatalog(sdk) : []
  if (preselectedOutput && /<CA_AGENT_SELECTION>[\s\S]*?<\/CA_AGENT_SELECTION>/i.test(preselectedOutput)) {
    return parseCaAgentSelectionResponse(preselectedOutput, catalog, question)
  }
  const canCallApi = auth.mode === 'oauth' ? Boolean(auth.oauthToken?.trim()) : Boolean(auth.apiKey?.trim() || extensionSDK?.serverProxy)

  if (canCallApi && catalog.length > 0) {
    try {
      onStatus?.(`Routing question via isolated CA sub-agent across ${catalog.length} Looker CA agent(s)...`)
      const interaction = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', {
        model: model || DEFAULT_ANTIGRAVITY_MODEL, store: false, background: false, tools: [],
        system_instruction: 'You are an isolated Looker Conversational Analytics (CA) Router Sub-Agent. Select the single best Looker CA agent_id for the user question and reply in JSON matching response_format.',
        generation_config: { thinking_level: 'low', max_output_tokens: 1024 },
        response_format: CA_AGENT_SELECTION_RESPONSE_FORMAT,
        input: [{ type: 'text', text: buildIsolatedCaSelectorPrompt(catalog, question, selectedExplores) }],
      })
      const outText = interaction?.output_text || (interaction?.outputs || []).map((o: { text?: string }) => o?.text || '').join('\n') || ''
      return { ...parseCaAgentSelectionResponse(outText, catalog, question), isolatedInteractionId: interaction?.id }
    } catch { /* Fall back to deterministic local scoring when offline or mocked */ }
  }
  return parseCaAgentSelectionResponse('', catalog, question)
}

export interface CreateCaConversationOptions {
  sdk: Looker40SDK; agent?: LookerCaAgentSummary; selection?: CaAgentSelectionResult; userPrompt: string
}

export async function createLookerCaConversation(
  sdkOrOpts: Looker40SDK | CreateCaConversationOptions,
  agentIdArg?: string,
  initialPromptArg?: string,
  agentNameArg?: string
): Promise<{
  caConversationId: string; agentId: string; agentName: string; embedPath: string
  title: string; label: string; assistantReply?: string
}> {
  const opts = sdkOrOpts && typeof sdkOrOpts === 'object' && 'sdk' in sdkOrOpts ? (sdkOrOpts as CreateCaConversationOptions) : undefined
  const sdk: Looker40SDK = opts ? opts.sdk : (sdkOrOpts as Looker40SDK)
  const cleanAgentId = String(opts ? opts.agent?.id || opts.selection?.agentId : agentIdArg || '').trim()
  const resolvedAgentName = String(opts ? opts.agent?.name || opts.selection?.agentName : agentNameArg || cleanAgentId).trim()
  const cleanPrompt = String(opts ? opts.userPrompt : initialPromptArg || '').trim()
  if (!cleanAgentId) throw new Error('Looker CA agent_id is required to create a conversation.')
  const label = cleanPrompt.length > 56 ? `${cleanPrompt.slice(0, 53).trim()}...` : cleanPrompt || `${resolvedAgentName || 'CA'} Conversation`
  const sdkWithCa = sdk as unknown as {
    create_conversation?: (body: Record<string, string>) => Promise<{ id?: string }>
    conversational_analytics_chat?: (body: Record<string, string>) => Promise<{ reply?: string; text?: string; output_text?: string }>
  }

  let caConversationId = ''
  try {
    const payload = { name: label, title: label, agent_id: cleanAgentId }
    const created = typeof sdkWithCa.create_conversation === 'function'
      ? await sdk.ok(sdkWithCa.create_conversation(payload) as never)
      : await rawLookerRequest<{ id?: string }>(sdk, 'POST', '/conversations', undefined, payload)
    caConversationId = String((created as { id?: string } | undefined)?.id || '').trim()
  } catch { /* fall back to generated CA conversation ID */ }
  if (!caConversationId) caConversationId = `ca_conv_${Date.now().toString(36)}`

  let assistantReply = ''
  if (cleanPrompt) {
    try {
      const chatPayload = { conversation_id: caConversationId, agent_id: cleanAgentId, user_message: cleanPrompt }
      const chatRes = typeof sdkWithCa.conversational_analytics_chat === 'function'
        ? await sdk.ok(sdkWithCa.conversational_analytics_chat(chatPayload) as never)
        : await rawLookerRequest<{ reply?: string; text?: string; output_text?: string }>(sdk, 'POST', '/conversational_analytics/chat', undefined, chatPayload)
      const cr = chatRes as { reply?: string; text?: string; output_text?: string } | undefined
      assistantReply = String(cr?.reply || cr?.text || cr?.output_text || '').trim()
    } catch { /* ignore optional initial chat turn failure */ }
  }

  return {
    caConversationId, agentId: cleanAgentId, agentName: resolvedAgentName,
    embedPath: resolveCaEmbedPath(cleanAgentId, caConversationId),
    title: label, label, ...(assistantReply ? { assistantReply } : {}),
  }
}

export type StudioContextCategory = 'explore' | 'dashboard' | 'look' | 'conversation'

export interface StudioContextMention {
  type: StudioContextCategory
  id: string
  title: string
  subtitle?: string
  model?: string
  explore?: string
  folderId?: string
  description?: string
  url?: string
}

export interface HydratedMentionedContext {
  explores: string[]
  extraSources: Array<{ type: 'inline'; content: string; target: string }>
  promptSummary: string
}

function normalizeRawContentMention(raw: Record<string, unknown>, fallbackCategory?: StudioContextCategory): StudioContextMention | null {
  const rawType = String(raw.content_type || raw.type || raw.section || fallbackCategory || '').toLowerCase().trim()

  if (
    rawType.includes('explore') ||
    (typeof raw.model_name === 'string' && typeof raw.explore_name === 'string') ||
    (typeof raw.model === 'string' && typeof raw.explore === 'string')
  ) {
    const model = String(raw.model_name || raw.model || '').trim()
    const explore = String(raw.explore_name || raw.explore || raw.name || '').trim()
    const id = model && explore ? formatExploreId(model, explore) : String(raw.content_id || raw.id || '').trim()
    const parsed = parseExploreId(id)
    if (!parsed) return null
    return {
      type: 'explore', id, model: parsed.modelName, explore: parsed.exploreName,
      title: String(raw.title || raw.label || parsed.exploreName).trim(), subtitle: parsed.modelName,
      description: raw.description ? String(raw.description) : undefined,
      url: raw.content_url || raw.url ? String(raw.content_url || raw.url) : undefined,
    }
  }

  if (rawType.includes('conversation')) {
    const id = String(raw.content_id || raw.id || '').trim()
    if (!id) return null
    return {
      type: 'conversation', id, title: String(raw.title || raw.label || raw.name || id).trim(),
      subtitle: raw.use_case ? String(raw.use_case) : undefined,
      description: raw.description ? String(raw.description) : undefined,
    }
  }

  const isLook = rawType === 'look' || rawType === 'looks'
  const isDash = rawType.includes('dashboard') || (!isLook && fallbackCategory === 'dashboard')
  if (!isLook && !isDash && fallbackCategory !== 'look') return null

  const type: StudioContextCategory = isLook || fallbackCategory === 'look' ? 'look' : 'dashboard'
  const id = String(raw.content_id || raw.content_slug || raw.id || '').trim()
  if (!id) return null
  const title = String(raw.title || raw.name || raw.label || id).trim()
  const folderObj = raw.folder as Record<string, unknown> | undefined
  const folderId = raw.folder_id ? String(raw.folder_id) : folderObj?.id ? String(folderObj.id) : undefined
  const subtitle = folderObj?.name ? String(folderObj.name) : `${type === 'dashboard' ? 'Dashboard' : 'Look'} #${id}`
  return {
    type, id, title, subtitle, folderId,
    description: raw.description ? String(raw.description) : undefined,
    url: raw.content_url || raw.url ? String(raw.content_url || raw.url) : undefined,
  }
}

function dedupeContextMentions(items: StudioContextMention[]): StudioContextMention[] {
  const seen = new Set<string>()
  return items.filter(item => {
    const key = `${item.type}:${item.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function fetchPreloadedContentSummary(sdk: Looker40SDK): Promise<StudioContextMention[]> {
  return coalesceLookerMetadataRequest(
    'meta:content_summary',
    async () => {
      const sdkRec = sdk as unknown as { content_summary?: (params: Record<string, unknown>) => Promise<unknown>; ok?: <T>(p: Promise<T> | T) => Promise<T> }
      const summaryFields = 'id,content_type,content_id,content_slug,content_url,title,description,view_count,favorite_count,last_viewed_at'
      let rawRows: unknown = null
      if (typeof sdkRec.content_summary === 'function') {
        try {
          const callRes = sdkRec.content_summary({ limit: 30, fields: summaryFields })
          rawRows = typeof sdkRec.ok === 'function' ? await sdkRec.ok(callRes) : await callRes
        } catch {
          rawRows = null
        }
      }
      if (!Array.isArray(rawRows) || rawRows.length === 0) {
        try {
          rawRows = await rawLookerRequest<unknown>(sdk, 'GET', '/api/4.0/content_summary', { limit: 30, fields: summaryFields })
        } catch {
          rawRows = null
        }
      }
      if (!Array.isArray(rawRows) || rawRows.length === 0) {
        try {
          rawRows = await sdk.ok(sdk.search_content({ terms: '', types: 'dashboard,look', limit: 30 } as Parameters<Looker40SDK['search_content']>[0]))
        } catch {
          rawRows = []
        }
      }
      const rows = Array.isArray(rawRows) ? rawRows : []
      const mentions: StudioContextMention[] = []
      for (const row of rows) {
        if (row && typeof row === 'object') {
          const normalized = normalizeRawContentMention(row as Record<string, unknown>)
          if (normalized) mentions.push(normalized)
        }
      }
      return dedupeContextMentions(mentions)
    },
    LOOKER_METADATA_CACHE_TTL_MS,
    ['looker:content_summary']
  )
}

export async function searchGlobalContentV2(
  sdk: Looker40SDK,
  params: { term: string; category?: StudioContextCategory | 'all'; limit?: number }
): Promise<StudioContextMention[]> {
  const cleanTerm = String(params.term || '').trim()
  const limit = params.limit ?? 15
  const category = params.category && params.category !== 'all' ? params.category : undefined
  const sections =
    category === 'look' ? ['Looks']
    : category === 'dashboard' ? ['Dashboards', 'LookML Dashboards']
    : category === 'explore' ? ['Explore', 'Self-Service Explore']
    : category === 'conversation' ? ['Conversations']
    : undefined

  let payload: unknown = null
  try {
    payload = await rawLookerRequest<unknown>(
      sdk,
      'GET',
      '/api/4.0/global_search_v2',
      Object.assign({ term: cleanTerm, curate: true, limit }, sections ? { sections } : null)
    )
  } catch {
    try {
      payload = await sdk.ok(
        sdk.search_content(
          Object.assign(
            { terms: cleanTerm, limit },
            category === 'look' ? { types: 'look' } : category === 'dashboard' ? { types: 'dashboard' } : null
          ) as Parameters<Looker40SDK['search_content']>[0]
        )
      )
    } catch {
      payload = []
    }
  }

  const mentions: StudioContextMention[] = []
  const collectFromList = (list: unknown[], sectionHint?: StudioContextCategory) => {
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue
      const rec = entry as Record<string, unknown>
      if (Array.isArray(rec.items) || Array.isArray(rec.results)) {
        const secName = String(rec.name || rec.title || rec.section || rec.type || '').toLowerCase()
        const hint: StudioContextCategory | undefined =
          secName.includes('look') && !secName.includes('lookml') ? 'look'
          : secName.includes('dashboard') ? 'dashboard'
          : secName.includes('explore') ? 'explore'
          : secName.includes('conversation') ? 'conversation'
          : sectionHint
        collectFromList((rec.items || rec.results) as unknown[], hint)
        continue
      }
      const item = normalizeRawContentMention(rec, sectionHint || category)
      if (item && (!category || item.type === category)) mentions.push(item)
    }
  }

  if (Array.isArray(payload)) {
    collectFromList(payload, category)
  } else if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    if (Array.isArray(obj.sections)) collectFromList(obj.sections, category)
    if (Array.isArray(obj.results)) collectFromList(obj.results, category)
    if (Array.isArray(obj.items)) collectFromList(obj.items, category)
  }

  return dedupeContextMentions(mentions).slice(0, limit)
}

function sanitizeContextFilename(rawId: string): string {
  return String(rawId || 'item').trim().replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function summarizeQuerySpec(q: Record<string, unknown> | null | undefined, fixedDates = false, anchorDate?: string) {
  if (!q || typeof q !== 'object') return null
  const model = String(q.model || '').trim()
  const view = String(q.view || q.explore || '').trim()
  const rawFilters = q.filters && typeof q.filters === 'object' ? (q.filters as Record<string, string>) : undefined
  const filters = rawFilters && fixedDates ? normalizeQueryFiltersToFixedDates(rawFilters, anchorDate) : rawFilters
  return {
    model: model || undefined,
    view: view || undefined,
    fields: Array.isArray(q.fields) ? q.fields : undefined,
    pivots: Array.isArray(q.pivots) ? q.pivots : undefined,
    fill_fields: Array.isArray(q.fill_fields) ? q.fill_fields : undefined,
    filters,
    sorts: Array.isArray(q.sorts) ? q.sorts : undefined,
    limit: q.limit !== undefined && q.limit !== null ? String(q.limit) : undefined,
    dynamic_fields: q.dynamic_fields,
    vis_config: q.vis_config && typeof q.vis_config === 'object' ? q.vis_config : undefined,
  }
}

async function fetchLookerEntityRecord(
  sdk: Looker40SDK,
  method: 'dashboard' | 'look',
  paramKey: 'dashboard_id' | 'look_id',
  pathPrefix: '/dashboards' | '/looks',
  id: string
): Promise<Record<string, unknown> | null> {
  try {
    const fn = sdk[method] as unknown as (arg: unknown) => Promise<unknown>
    let raw: unknown
    try {
      raw = await sdk.ok(fn.call(sdk, id))
    } catch {
      raw = await sdk.ok(fn.call(sdk, { [paramKey]: id }))
    }
    if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  } catch {
    try {
      return await rawLookerRequest<Record<string, unknown>>(sdk, 'GET', `${pathPrefix}/${encodeURIComponent(id)}`)
    } catch {
      return null
    }
  }
  return null
}

export async function hydrateMentionedContext(params: {
  sdk: Looker40SDK
  mentions: StudioContextMention[]
  conversations?: UserConversationEntry[]
  selectedExplores?: string[]
  useCase?: string
  anchorDate?: string
}): Promise<HydratedMentionedContext> {
  const { sdk, mentions, conversations = [], selectedExplores = [], useCase, anchorDate } = params
  const fixedDates = useCase === 'data-investigator' || useCase === 'data_investigator'
  const exploresSet = new Set<string>(selectedExplores.filter(Boolean))
  const extraSources: Array<{ type: 'inline'; content: string; target: string }> = []
  const summaryLines: string[] = []

  for (const mention of dedupeContextMentions(mentions)) {
    if (mention.type === 'explore') {
      const expId =
        mention.model && mention.explore
          ? formatExploreId(mention.model, mention.explore)
          : mention.id
      if (parseExploreId(expId)) {
        exploresSet.add(expId)
        summaryLines.push(`- **@explore:${mention.title}** (\`${expId}\`)`)
      }
      continue
    }

    if (mention.type === 'dashboard') {
      const dashId = String(mention.id).trim()
      if (!dashId) continue
      const dashObj = await fetchLookerEntityRecord(sdk, 'dashboard', 'dashboard_id', '/dashboards', dashId)

      if (dashObj) {
        const elements = Array.isArray(dashObj.dashboard_elements)
          ? (dashObj.dashboard_elements as Array<Record<string, unknown>>)
          : []
        const dashExplores = new Set<string>()
        const tiles = elements.map((el) => {
          const resultMaker = el.result_maker as Record<string, unknown> | undefined
          const rawQ = (el.query || resultMaker?.query) as Record<string, unknown> | undefined
          const qSpec = summarizeQuerySpec(rawQ, fixedDates, anchorDate)
          if (qSpec?.model && qSpec?.view) {
            const expId = formatExploreId(qSpec.model, qSpec.view)
            exploresSet.add(expId)
            dashExplores.add(expId)
          }
          return {
            id: el.id ? String(el.id) : undefined,
            title: el.title || el.title_text || undefined,
            type: el.type || undefined,
            subtitle_text: el.subtitle_text || undefined,
            body_text: el.body_text || undefined,
            query: qSpec,
          }
        })
        const safeId = sanitizeContextFilename(dashId)
        const targetPath = `/workspace/context/dashboard_${safeId}.json`
        const payload = {
          id: String(dashObj.id || dashId),
          title: String(dashObj.title || mention.title || dashId),
          description: dashObj.description || undefined,
          folder_id: dashObj.folder_id || (dashObj.folder as Record<string, unknown> | undefined)?.id,
          explores: Array.from(dashExplores),
          dashboard_filters: Array.isArray(dashObj.dashboard_filters) ? dashObj.dashboard_filters : [],
          dashboard_layouts: Array.isArray(dashObj.dashboard_layouts) ? dashObj.dashboard_layouts : [],
          tiles,
        }
        extraSources.push({ type: 'inline', target: targetPath, content: JSON.stringify(payload, null, 2) })
        summaryLines.push(
          `- **@dashboard:${payload.title}** (ID \`${payload.id}\`, saved to \`${targetPath}\`, ${tiles.length} tile(s), explores: ${
            payload.explores.length > 0 ? payload.explores.map((e) => `\`${e}\``).join(', ') : 'none'
          })`
        )
      }
      continue
    }

    if (mention.type === 'look') {
      const lookId = String(mention.id).trim()
      if (!lookId) continue
      const lookObj = await fetchLookerEntityRecord(sdk, 'look', 'look_id', '/looks', lookId)

      if (lookObj) {
        const qSpec = summarizeQuerySpec(
          lookObj.query as Record<string, unknown> | undefined,
          fixedDates,
          anchorDate
        )
        const expId = qSpec?.model && qSpec?.view ? formatExploreId(qSpec.model, qSpec.view) : ''
        if (expId) exploresSet.add(expId)
        const safeId = sanitizeContextFilename(lookId)
        const targetPath = `/workspace/context/look_${safeId}.json`
        const payload = {
          id: String(lookObj.id || lookId),
          title: String(lookObj.title || mention.title || lookId),
          description: lookObj.description || undefined,
          folder_id: lookObj.folder_id || (lookObj.folder as Record<string, unknown> | undefined)?.id,
          explore: expId || undefined,
          query: qSpec,
        }
        extraSources.push({ type: 'inline', target: targetPath, content: JSON.stringify(payload, null, 2) })
        summaryLines.push(
          `- **@look:${payload.title}** (ID \`${payload.id}\`, saved to \`${targetPath}\`${
            expId ? `, explore: \`${expId}\`` : ''
          })`
        )
      }
      continue
    }

    if (mention.type === 'conversation') {
      const convId = String(mention.id).trim()
      if (!convId) continue
      let conv: UserConversationEntry | null =
        conversations.find((c) => c.id === convId || c.label === mention.title) || null
      if (!conv) {
        try {
          conv = await loadSingleConversationArtifact(sdk, convId)
        } catch {
          conv = null
        }
      }
      if (conv) {
        for (const exp of conv.explores || []) {
          if (parseExploreId(exp)) exploresSet.add(exp)
        }
        const safeId = sanitizeContextFilename(conv.id || convId)
        const targetPath = `/workspace/context/conversation_${safeId}.md`
        const turnLines = (conv.messages || []).map(
          (m) => `### ${String(m.role || 'user').toUpperCase()}\n${String(m.text || '')}`
        )
        const mdContent = [
          `# Conversation: ${conv.label || mention.title} (${conv.id})`,
          `- Use Case: ${conv.use_case || conv.type || 'app'}`,
          `- Explores: ${(conv.explores || []).join(', ') || 'none'}`,
          conv.content ? `- Content Metadata: \`${JSON.stringify(conv.content)}\`` : '',
          '',
          '## Transcript',
          ...(turnLines.length > 0 ? turnLines : ['_No messages recorded._']),
        ]
          .filter(Boolean)
          .join('\n\n')
        extraSources.push({
          type: 'inline',
          target: targetPath,
          content: mdContent,
        })
        summaryLines.push(
          `- **@conversation:${conv.label || mention.title}** (ID \`${conv.id}\`, saved to \`${targetPath}\`)`
        )
      }
    }
  }

  return {
    explores: Array.from(exploresSet),
    extraSources,
    promptSummary:
      summaryLines.length > 0
        ? ['### Referenced Looker Context (@-mentions)', ...summaryLines].join('\n')
        : '',
  }
}
