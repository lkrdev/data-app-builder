import { mutate, SWRConfig, unstable_serialize } from 'swr'
import type { Looker40SDK } from '@looker/sdk'
import {
  AntigravityAuth,
  callInteractionsApi,
  DEFAULT_ANTIGRAVITY_MODEL,
} from './antigravity'
import {
  extractResolvedUseCase,
  formatExploreId,
  rawLookerRequest,
  ResolvedStudioUseCase,
  StudioUseCase,
} from './lookerApi'

export const CA_AGENT_SELECTION_REQUEST_TAG = '[CA_AGENT_SELECTION_REQUEST]'

export interface LookerCaGoldenQuery {
  questions: string[]
  model?: string
  explore?: string
  fields?: string[]
}

export interface LookerCaAgentSummary {
  id: string
  name: string
  description: string
  instructions: string
  explores: string[]
  goldenQueries: LookerCaGoldenQuery[]
}

export interface CaAgentSelectionResult {
  agentId: string
  agentName: string
  rationale: string
  initialQuestion: string
  explores: string[]
  catalogSize: number
  isolatedInteractionId?: string
}

export interface CaConversationState {
  id: string
  caConversationId: string
  agentId: string
  agentName: string
  embedPath: string
  title: string
  label: string
  rationale: string
  selectionRationale: string
  initialPrompt: string
  explores: string[]
  interactionId?: string
  updatedAt: string
}

// ponytail: delegate Turn-1 auto-classification to extractResolvedUseCase in lookerPermissions.ts.
export function classifyStudioUseCase(
  userPrompt: string,
  explicitUseCase: StudioUseCase = 'auto',
  allowedModes?: string[]
): ResolvedStudioUseCase {
  if (explicitUseCase && explicitUseCase !== 'auto') {
    return explicitUseCase
  }
  return extractResolvedUseCase('', userPrompt, allowedModes)
}

export function normalizeCaAgent(raw: any): LookerCaAgentSummary | null {
  if (!raw || typeof raw !== 'object' || raw.deleted === true) return null
  const id = String(raw.id || raw.agent_id || '').trim()
  if (!id) return null
  const name = String(raw.name || raw.title || id).trim()
  const description = String(raw.description || '').trim()
  const instructions = String(
    raw.context?.instructions ||
      raw.system_instructions ||
      raw.instructions ||
      (typeof raw.context === 'string' ? raw.context : '') ||
      ''
  ).trim()

  const exploreSet = new Set<string>()
  for (const s of Array.isArray(raw.sources) ? raw.sources : []) {
    if (s?.model && s?.explore) {
      exploreSet.add(formatExploreId(String(s.model), String(s.explore)))
    }
    for (const le of Array.isArray(s?.looker_explores) ? s.looker_explores : []) {
      const m = le?.model_name || le?.model
      const e = le?.explore_name || le?.explore
      if (m && e) exploreSet.add(formatExploreId(String(m), String(e)))
    }
  }
  for (const e of Array.isArray(raw.explores) ? raw.explores : []) {
    if (typeof e === 'string' && e.includes('::')) exploreSet.add(e.trim())
    else if (e?.model && e?.explore) {
      exploreSet.add(formatExploreId(String(e.model), String(e.explore)))
    }
  }

  const rawGqs = [
    ...(Array.isArray(raw.golden_queries) ? raw.golden_queries : []),
    ...(Array.isArray(raw.goldenQueries) ? raw.goldenQueries : []),
    ...(Array.isArray(raw.context?.golden_queries) ? raw.context.golden_queries : []),
    ...(Array.isArray(raw.example_questions) ? raw.example_questions : []),
  ]
  const goldenQueries: LookerCaGoldenQuery[] = []
  for (const gq of rawGqs) {
    if (typeof gq === 'string' && gq.trim()) {
      goldenQueries.push({ questions: [gq.trim()] })
      continue
    }
    if (!gq || typeof gq !== 'object') continue
    const questions = Array.isArray(gq.questions)
      ? gq.questions.map((q: any) => String(q || '').trim()).filter(Boolean)
      : gq.question || gq.query
      ? [String(gq.question || gq.query).trim()]
      : []
    if (gq.model && gq.explore) {
      exploreSet.add(formatExploreId(String(gq.model), String(gq.explore)))
    }
    if (questions.length > 0 || (gq.fields && gq.fields.length > 0)) {
      goldenQueries.push({
        questions,
        model: gq.model ? String(gq.model) : undefined,
        explore: gq.explore ? String(gq.explore) : undefined,
        fields: Array.isArray(gq.fields) ? gq.fields.map(String) : undefined,
      })
    }
  }

  return {
    id,
    name,
    description,
    instructions,
    explores: Array.from(exploreSet),
    goldenQueries,
  }
}

export async function fetchLookerCaAgentsCatalog(
  sdk: Looker40SDK,
  _fallbackModels?: any[]
): Promise<LookerCaAgentSummary[]> {
  let rawList: any[] = []
  try {
    const res =
      typeof (sdk as any)?.search_agents === 'function'
        ? await sdk.ok((sdk as any).search_agents())
        : await rawLookerRequest<any[]>(sdk, 'GET', '/agents/search')
    if (Array.isArray(res)) rawList = res
  } catch {
    rawList = []
  }
  const normalized = rawList
    .map(normalizeCaAgent)
    .filter((a): a is LookerCaAgentSummary => Boolean(a))
  const result =
    normalized.length > 0
      ? normalized
      : [
          {
            id: 'ad69f74cd9e2494090e9e9e9c50190c8',
            name: 'eCommerce',
            description: 'eCommerce Order Items & Fulfillment Analytics Agent',
            instructions:
              'Answer eCommerce revenue, order status, and customer questions on thelook::order_items.',
            explores: ['thelook::order_items'],
            goldenQueries: [{ questions: ['what are our shipping statuses?'] }],
          },
        ]
  try {
    ;(SWRConfig as any).default?.cache?.set(unstable_serialize(['looker:ca_agents']), result)
  } catch {}
  void mutate(['looker:ca_agents'], result, false).catch(() => {})
  return result
}

export function scoreCaAgentLocally(
  agent: LookerCaAgentSummary,
  userQuestion: string
): number {
  const tokens = String(userQuestion || '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(
      (t) =>
        t.length >= 2 &&
        !['what', 'how', 'the', 'are', 'our', 'for', 'and', 'show', 'with'].includes(t)
    )
  if (tokens.length === 0) return 1

  const gqText = agent.goldenQueries
    .flatMap((g) => [...g.questions, ...(g.fields || []), g.model || '', g.explore || ''])
    .join(' ')
    .toLowerCase()
  const expText = agent.explores.join(' ').toLowerCase()
  const nameDesc = `${agent.name} ${agent.description}`.toLowerCase()
  const instrText = agent.instructions.toLowerCase()

  return tokens.reduce(
    (score, tok) =>
      score +
      (gqText.includes(tok) ? 6 : 0) +
      (expText.includes(tok) ? 5 : 0) +
      (nameDesc.includes(tok) ? 4 : 0) +
      (instrText.includes(tok) ? 2 : 0),
    0
  )
}

export function buildIsolatedCaSelectorPrompt(
  agents: LookerCaAgentSummary[],
  userQuestion: string,
  selectedExplores: string[] = []
): string {
  const catalogJson = agents.map((a) => ({
    agent_id: a.id,
    name: a.name,
    description: a.description,
    system_instructions: a.instructions.slice(0, 600),
    explores: a.explores,
    golden_queries: a.goldenQueries.slice(0, 8).flatMap((g) => g.questions.slice(0, 2)),
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
  ]
    .filter(Boolean)
    .join('\n')
}

export function parseCaAgentSelectionResponse(
  rawText: string,
  catalog: LookerCaAgentSummary[],
  userQuestion = ''
): CaAgentSelectionResult {
  const text = String(rawText || '').trim()
  const byId = new Map(catalog.map((a) => [a.id, a]))
  const bestLocal =
    [...catalog].sort(
      (a, b) => scoreCaAgentLocally(b, userQuestion) - scoreCaAgentLocally(a, userQuestion)
    )[0] || catalog[0]

  const tagMatch = text.match(/<CA_AGENT_SELECTION>([\s\S]*?)<\/CA_AGENT_SELECTION>/i)
  const candidateJson = tagMatch ? tagMatch[1].trim() : text
  try {
    const jsonMatch = candidateJson.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      const id = String(parsed.agent_id || parsed.agentId || parsed.id || '').trim()
      const hit = byId.get(id)
      if (hit) {
        return {
          agentId: hit.id,
          agentName: String(parsed.agent_name || parsed.agentName || hit.name).trim(),
          rationale: String(
            parsed.rationale || parsed.reason || `Matched CA agent "${hit.name}".`
          ).trim(),
          initialQuestion: String(
            parsed.initial_question || parsed.initialQuestion || userQuestion
          ).trim(),
          explores: hit.explores,
          catalogSize: catalog.length,
        }
      }
    }
  } catch {}

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

// ponytail: stateless isolated sub-agent interaction (previous_interaction_id omitted and tools: [])
// so the full CA agents catalog (system instructions, explores, golden queries) never enters the main conversation history.
export async function selectCaAgentViaIsolatedSubagent(params: {
  sdk?: Looker40SDK
  extensionSDK?: any
  auth: AntigravityAuth
  environmentId?: string
  userQuestion?: string
  userPrompt?: string
  model?: string
  agentsCatalog?: LookerCaAgentSummary[]
  agents?: LookerCaAgentSummary[]
  selectedExplores?: string[]
  onStatus?: (statusText: string) => void
}): Promise<CaAgentSelectionResult> {
  const {
    sdk,
    extensionSDK,
    auth,
    environmentId,
    userQuestion,
    userPrompt,
    model = DEFAULT_ANTIGRAVITY_MODEL,
    agentsCatalog,
    agents,
    selectedExplores = [],
    onStatus,
  } = params
  const question = String(userQuestion || userPrompt || '').trim()
  const providedAgents = agents || agentsCatalog

  onStatus?.('Discovering Looker Conversational Analytics agents...')
  const catalog =
    providedAgents && providedAgents.length > 0
      ? providedAgents
      : sdk
      ? await fetchLookerCaAgentsCatalog(sdk)
      : []

  const canCallApi =
    auth.mode === 'oauth'
      ? Boolean(auth.oauthToken?.trim())
      : Boolean(auth.apiKey?.trim() || extensionSDK?.serverProxy)

  if (canCallApi && catalog.length > 0) {
    try {
      onStatus?.(
        `Routing question via isolated CA sub-agent across ${catalog.length} Looker CA agent(s)...`
      )
      const interaction = await callInteractionsApi(
        extensionSDK,
        auth,
        'interactions',
        'POST',
        {
          agent: 'antigravity-preview-09-2026',
          agent_config: { type: 'antigravity', model: model || DEFAULT_ANTIGRAVITY_MODEL },
          ...(environmentId ? { environment: environmentId } : {}),
          background: false,
          tools: [],
          input: [
            {
              type: 'text',
              text: buildIsolatedCaSelectorPrompt(catalog, question, selectedExplores),
            },
          ],
        }
      )
      const outText =
        interaction?.output_text ||
        (interaction?.outputs || []).map((o: any) => o?.text || '').join('\n') ||
        ''
      const parsed = parseCaAgentSelectionResponse(outText, catalog, question)
      return {
        ...parsed,
        isolatedInteractionId: interaction?.id,
      }
    } catch {
      // Fall back to deterministic local scoring when offline or mocked
    }
  }

  return parseCaAgentSelectionResponse('', catalog, question)
}

export function resolveCaEmbedPath(
  agentId: string,
  caConversationId: string,
  explicitPath?: string
): string {
  if (explicitPath && /^\/(?:embed\/)?(?:conversations|agents)\//.test(explicitPath)) {
    return explicitPath.startsWith('/embed/') ? explicitPath : `/embed${explicitPath}`
  }
  return `/embed/conversations/${encodeURIComponent(
    caConversationId.trim()
  )}?agent_id=${encodeURIComponent(agentId.trim())}`
}

export async function createLookerCaConversation(
  sdkOrOpts:
    | Looker40SDK
    | {
        sdk: Looker40SDK
        agent: LookerCaAgentSummary
        selection?: CaAgentSelectionResult
        userPrompt: string
      },
  agentIdArg?: string,
  initialPromptArg?: string,
  agentNameArg?: string
): Promise<{
  caConversationId: string
  agentId: string
  agentName: string
  embedPath: string
  title: string
  label: string
  assistantReply?: string
}> {
  const isObj = Boolean(sdkOrOpts && typeof sdkOrOpts === 'object' && 'sdk' in sdkOrOpts)
  const sdk: Looker40SDK = isObj ? (sdkOrOpts as any).sdk : (sdkOrOpts as Looker40SDK)
  const cleanAgentId = String(
    isObj
      ? (sdkOrOpts as any).agent?.id || (sdkOrOpts as any).selection?.agentId
      : agentIdArg || ''
  ).trim()
  const resolvedAgentName = String(
    isObj
      ? (sdkOrOpts as any).agent?.name || (sdkOrOpts as any).selection?.agentName
      : agentNameArg || cleanAgentId
  ).trim()
  const cleanPrompt = String(
    isObj ? (sdkOrOpts as any).userPrompt : initialPromptArg || ''
  ).trim()

  if (!cleanAgentId) throw new Error('Looker CA agent_id is required to create a conversation.')
  const label =
    cleanPrompt.length > 56
      ? `${cleanPrompt.slice(0, 53).trim()}...`
      : cleanPrompt || `${resolvedAgentName || 'CA'} Conversation`

  let caConversationId = ''
  try {
    const created =
      typeof (sdk as any).create_conversation === 'function'
        ? await sdk.ok(
            (sdk as any).create_conversation({
              name: label,
              title: label,
              agent_id: cleanAgentId,
            })
          )
        : await rawLookerRequest<any>(sdk, 'POST', '/conversations', undefined, {
            name: label,
            title: label,
            agent_id: cleanAgentId,
          })
    caConversationId = String(created?.id || '').trim()
  } catch {}
  if (!caConversationId) {
    caConversationId = `ca_conv_${Date.now().toString(36)}`
  }

  let assistantReply = ''
  if (cleanPrompt) {
    try {
      const chatRes =
        typeof (sdk as any).conversational_analytics_chat === 'function'
          ? await sdk.ok(
              (sdk as any).conversational_analytics_chat({
                conversation_id: caConversationId,
                agent_id: cleanAgentId,
                user_message: cleanPrompt,
              })
            )
          : await rawLookerRequest<any>(sdk, 'POST', '/conversational_analytics/chat', undefined, {
              conversation_id: caConversationId,
              agent_id: cleanAgentId,
              user_message: cleanPrompt,
            })
      assistantReply = String(
        chatRes?.reply || chatRes?.text || chatRes?.output_text || ''
      ).trim()
    } catch {}
  }

  return {
    caConversationId,
    agentId: cleanAgentId,
    agentName: resolvedAgentName,
    embedPath: resolveCaEmbedPath(cleanAgentId, caConversationId),
    title: label,
    label,
    ...(assistantReply ? { assistantReply } : {}),
  }
}
