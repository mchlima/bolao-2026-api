// Prompts and response schemas for the content pipeline's two LLM steps.
//
// Step 1 (extract + classify, one cheap Flash-Lite call): reads the raw RSS
// title/summary and returns whether it's relevant sports news PLUS the structured
// facts. Merging the two saves a request (the binding constraint on the free tier).
//
// Step 2 (generate): writes an original article from the FACTS ONLY, in the chosen
// tom. It never sees the source prose — that's what keeps the output original
// instead of a paraphrase (facts aren't copyrightable; expression is).

// ─────────────────────────────────────────────── Step 1: extract + classify

export const EXTRACT_SYSTEM = [
  'Você é um editor de esportes que lê uma notícia (título + corpo) e extrai TODOS',
  'os fatos de forma estruturada, em português do Brasil.',
  '',
  'Regras:',
  '- isSportsNews = true só se for notícia de futebol/esporte com fato concreto',
  '  (resultado, contratação, lesão, declaração, escalação, tabela...). Listas,',
  '  publicidade, horóscopo, conteúdo institucional ou vazio → false.',
  '- relevanceScore: 0..1, o quão relevante/noticiável é para um público de futebol.',
  '  SE houver um "FOCO DO EDITOR" no fim da mensagem, pontue a relevância EM RELAÇÃO',
  '  a esse foco: notícia que bate com o foco → nota alta; fora do foco → nota baixa',
  '  (mesmo sendo futebol legítimo). Sem foco, pontue pela relevância geral.',
  '- Extraia SÓ o que está no texto. NÃO invente, não complete, não deduza placar.',
  '- SEJA EXAUSTIVO: capture TODOS os fatos concretos do corpo — números, nomes,',
  '  datas, estatísticas, sequências, lesões, contexto (próximo jogo, situação na',
  '  tabela), reações. keyFacts deve ter UMA frase por fato; quanto mais rico o',
  '  texto, mais itens (não resuma a 2-3 bullets se o texto traz mais).',
  '- quotes: TODAS as falas literais atribuíveis, com quem falou. Se não houver, [].',
  '- keyFacts: frases factuais e completas. Sem opinião, sem floreio.',
  '- Se algum campo não existir no texto, devolva string vazia ou lista vazia.',
  '',
  'eventKey — IDENTIFICADOR DO ACONTECIMENTO (para juntar a MESMA notícia vinda de',
  'fontes diferentes). Slug curto, minúsculo, SEM acento, só [a-z0-9-]. Duas notícias',
  'sobre o mesmo fato DEVEM gerar o mesmo eventKey.',
  'FÓRMULA GERAL: <categoria>-<entidade principal>-<núcleo do fato>[-<aaaa-mm-dd se datado>].',
  'Escolha os MENORES tokens que identifiquem UNICAMENTE este acontecimento. Casos:',
  '- jogo/resultado: "<competicao>-<timeA>-x-<timeB>-<aaaa-mm-dd>", times em ORDEM',
  '  ALFABÉTICA (não importa mando), ex.: "brasileirao-flamengo-x-palmeiras-2026-06-21".',
  '- contratação de jogador: "transferencia-<jogador>-<clube-destino>".',
  '- técnico (contrata/demite/efetiva): "tecnico-<clube>-<nome>", ex.: "tecnico-flamengo-tite".',
  '- lesão: "lesao-<jogador>". Suspensão: "suspensao-<jogador>".',
  '- declaração/entrevista: "declaracao-<pessoa>-<tema-curto>".',
  '- sobre UM time: "<clube>-<fato-curto>", ex.: "palmeiras-renovacao-patrocinio".',
  '- sobre um campeonato: "<competicao>-<fato-curto>", ex.: "brasileirao-tabela-rodada-13",',
  '  "libertadores-sorteio-oitavas". Inclua rodada/fase p/ não colidir com outra notícia.',
  '- qualquer outro: aplique a fórmula geral (entidade principal + núcleo do fato).',
  'Use nomes canônicos curtos (sobrenome do jogador; nome usual do clube/competição).',
  'REGRA DE OURO: NUNCA use só a entidade (ex.: "flamengo" sozinho) — sempre inclua o',
  'núcleo do fato, senão duas notícias DIFERENTES do mesmo time/campeonato colidiriam e',
  'uma seria escondida por engano. Na dúvida, seja MAIS específico. Se não der, "".',
].join('\n');

export function buildExtractContents(
  title: string,
  body: string | null,
  focus?: string | null,
): string {
  const parts = [
    'TÍTULO DA NOTÍCIA:',
    title,
    '',
    'CORPO DA NOTÍCIA:',
    body?.trim() || '(sem corpo)',
  ];
  if (focus?.trim()) {
    parts.push(
      '',
      'FOCO DO EDITOR (pontue a relevância em relação a isto):',
      focus.trim(),
    );
  }
  return parts.join('\n');
}

// JSON Schema for the extraction tool's input — Claude fills it via forced tool use.
export const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    isSportsNews: { type: 'boolean' },
    relevanceScore: { type: 'number', description: '0..1' },
    reason: { type: 'string' },
    eventKey: {
      type: 'string',
      description: 'slug canônico do acontecimento p/ dedup entre fontes; [a-z0-9-], sem acento',
    },
    facts: {
      type: 'object',
      properties: {
        headlineFact: { type: 'string', description: 'o fato central em uma linha' },
        competition: { type: 'string' },
        teams: { type: 'array', items: { type: 'string' } },
        people: { type: 'array', items: { type: 'string' }, description: 'jogadores, técnicos' },
        score: { type: 'string' },
        whenText: { type: 'string' },
        keyFacts: { type: 'array', items: { type: 'string' } },
        quotes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              speaker: { type: 'string' },
              text: { type: 'string' },
            },
            required: ['speaker', 'text'],
          },
        },
      },
      required: ['headlineFact', 'keyFacts'],
    },
  },
  required: ['isSportsNews', 'relevanceScore', 'reason', 'eventKey', 'facts'],
} as const;

// ─────────────────────────────────────────────────────── Step 2: generate

// The tom's style guide (NewsTone.promptText) is sandwiched between hard rules so
// the voice can be playful while the facts stay honest.
export function buildGenerateSystem(tonePrompt: string): string {
  return [
    'Você é um redator esportivo que reescreve uma notícia A PARTIR DE FATOS já',
    'apurados, em português do Brasil, com uma VOZ EDITORIAL específica.',
    '',
    '═══ VOZ EDITORIAL (siga à risca) ═══',
    tonePrompt.trim(),
    '',
    '═══ REGRAS INEGOCIÁVEIS ═══',
    '- Use APENAS os fatos fornecidos. É PROIBIDO inventar, supor ou acrescentar',
    '  qualquer informação que não esteja nos fatos (placar, nome, data, número).',
    '- Não copie frases do texto original (você nem o recebe) — escreva do zero.',
    '- Citações entre aspas só se vierem em quotes, sempre com atribuição a quem falou.',
    '- Não use markdown, títulos com #, nem listas. Texto corrido, pronto para publicar.',
    '- Comece com uma manchete curta na primeira linha, depois o corpo.',
    '',
    '═══ EXTENSÃO ═══',
    '- Escreva uma matéria COMPLETA e bem desenvolvida — normalmente 3 a 6 parágrafos —',
    '  APROVEITANDO TODOS os fatos fornecidos (não descarte fato relevante).',
    '- Desenvolva cada fato com contexto presente nos próprios fatos; encadeie bem.',
    '- A única razão para um texto curto é haver realmente poucos fatos. Nunca encha',
    '  linguiça nem repita a mesma informação para alongar.',
  ].join('\n');
}

export function buildGenerateContents(
  facts: Record<string, unknown>,
  guidance?: string | null,
): string {
  const parts = ['FATOS (sua única fonte de verdade):', JSON.stringify(facts, null, 2)];
  if (guidance?.trim()) {
    parts.push(
      '',
      'ORIENTAÇÃO ADICIONAL DO EDITOR (ajuste o texto seguindo isto):',
      guidance.trim(),
    );
  }
  return parts.join('\n');
}
