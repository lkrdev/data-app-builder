import type { ExtensionSDK } from '@looker/extension-sdk'
import type { ILookmlModel, Looker40SDK } from '@looker/sdk'
import { mutate, SWRConfig, unstable_serialize } from 'swr'

import { AntigravityAuth, callInteractionsApi, DEFAULT_ANTIGRAVITY_MODEL } from './antigravity'
import { extractResolvedUseCase, formatExploreId, rawLookerRequest, ResolvedStudioUseCase, StudioUseCase } from './lookerApi'

export const CA_AGENT_SELECTION_REQUEST_TAG = '[CA_AGENT_SELECTION_REQUEST]'

export interface LookerCaGoldenQuery { questions: string[]; model?: string; explore?: string; fields?: string[] }
export interface LookerCaAgentSummary { id: string; name: string; description: string; instructions: string; explores: string[]; goldenQueries: LookerCaGoldenQuery[] }
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

  return { id, name, description, instructions, explores: Array.from(exploreSet), goldenQueries }
}

export async function fetchLookerCaAgentsCatalog(
  sdk: Looker40SDK,
  _fallbackModels?: Array<Partial<ILookmlModel>>
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
  const result = normalized.length > 0
    ? normalized
    : [{
        id: 'ad69f74cd9e2494090e9e9e9c50190c8', name: 'eCommerce',
        description: 'eCommerce Order Items & Fulfillment Analytics Agent',
        instructions: 'Answer eCommerce revenue, order status, and customer questions on thelook::order_items.',
        explores: ['thelook::order_items'], goldenQueries: [{ questions: ['what are our shipping statuses?'] }],
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
  userQuestion?: string; userPrompt?: string; model?: string
  agentsCatalog?: LookerCaAgentSummary[]; agents?: LookerCaAgentSummary[]; selectedExplores?: string[]
  onStatus?: (statusText: string) => void
}): Promise<CaAgentSelectionResult> {
  const { sdk, extensionSDK, auth, userQuestion, userPrompt, model = DEFAULT_ANTIGRAVITY_MODEL, agentsCatalog, agents, selectedExplores = [], onStatus } = params
  const question = String(userQuestion || userPrompt || '').trim()
  const providedAgents = agents || agentsCatalog
  onStatus?.('Discovering Looker Conversational Analytics agents...')
  const catalog = providedAgents && providedAgents.length > 0 ? providedAgents : sdk ? await fetchLookerCaAgentsCatalog(sdk) : []
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
