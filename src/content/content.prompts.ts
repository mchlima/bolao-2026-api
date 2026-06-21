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
  '  NUNCA acrescente um nome ou detalhe ausente: se o texto diz só "Room", use "Room"',
  '  (não invente primeiro nome). Nome/número/data só se estiver LITERALMENTE no texto.',
  '',
  '  ═══ APENAS FATO DURO (anti-derivação) ═══',
  '- Capture só FATOS VERIFICÁVEIS: placar, gols, eventos do jogo, estatísticas, jogadores/',
  '  técnicos, lesões, contratações, classificação, datas, dados de contexto (demografia, números).',
  '- É PROIBIDO capturar a EXPRESSÃO/CURADORIA de OUTROS VEÍCULOS de imprensa: NÃO registre',
  '  o que "o Marca/AS/Olé/ESPN disse", nem frases editoriais/opinativas deles ("resistência',
  '  caribenha", "atuação memorável"). Isso é expressão alheia, não fato — fica de fora.',
  '- quotes: SOMENTE falas de PESSOAS do fato (jogador, técnico, dirigente), com quem falou.',
  '  NUNCA aspas/frases de jornais ou veículos. Se não houver fala de pessoa, [].',
  '- keyFacts: frases factuais e neutras, com SUAS palavras (não copie a frase da fonte).',
  '  Capture todos os fatos duros; mas se o texto é só repercussão/opinião de imprensa,',
  '  pode sobrar pouco fato — tudo bem, melhor poucos fatos do que copiar a curadoria alheia.',
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

// ───────────────────────────────────────── Topic discovery (web search)

// The search call is ONLY for discovery: it runs web searches and we harvest the
// real article URLs/titles/dates from the results. We deliberately ignore Claude's
// prose so the downstream pipeline (fetch → extract → generate) stays the source
// of truth — no facts ever come from the model's head.
export const SEARCH_SYSTEM = [
  'Você é um assistente de PAUTA esportiva. Sua única tarefa é USAR A BUSCA para',
  'encontrar NOTÍCIAS/REPORTAGENS RECENTES (idealmente últimas 48h) sobre o assunto.',
  '',
  'BUSQUE matérias jornalísticas sobre fatos novos: resultados, lesões, contratações,',
  'declarações, convocações, escalações, bastidores. Inclua termos como "notícia",',
  '"últimas" e o nome do veículo quando ajudar a achar reportagem (não dado bruto).',
  '',
  'EVITE (não são notícia): páginas de TABELA/CLASSIFICAÇÃO, ESTATÍSTICAS, calendário,',
  'elenco, verbetes da Wikipédia e AGREGADORES de placar (sofascore, flashscore,',
  '365scores, fbref e afins). Prefira o link da MATÉRIA, não da página-índice.',
  '',
  'NÃO escreva matéria, NÃO resuma, NÃO invente — apenas busque. Os artigos achados',
  'serão processados depois. Pode responder de forma bem curta.',
].join('\n');

export function buildSearchPrompt(query: string): string {
  return [
    'Assunto da pauta — busque NOTÍCIAS/REPORTAGENS recentes (últimas 48h) sobre:',
    query.trim(),
    '',
    'Quero links de matérias jornalísticas, não páginas de tabela, estatística ou Wikipédia.',
  ].join('\n');
}

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
    '- PROIBIDO DEDUZIR CONSEQUÊNCIAS não declaradas: se um time venceu, NÃO afirme que o',
    '  outro "foi eliminado", nem "quem ele enfrenta depois", nem como o jogo se desenrolou',
    '  ("reagiu quando precisava", "situação delicada") — nada disso, a menos que esteja nos fatos.',
    '- Não copie frases do texto original (você nem o recebe) — escreva do zero.',
    '- Citações entre aspas só se vierem em quotes, sempre com atribuição a quem falou.',
    '- Não use markdown, títulos com #, nem listas. Texto corrido, pronto para publicar.',
    '- Comece com uma manchete curta na primeira linha, depois o corpo.',
    '',
    '═══ EXTENSÃO (o tamanho SEGUE os fatos) ═══',
    '- O comprimento é DITADO pela quantidade de fatos. Poucos fatos → texto curto:',
    '  1–2 parágrafos, ou até uma nota de poucas linhas. NUNCA escreva além do que os',
    '  fatos sustentam.',
    '- É melhor um texto CURTO e 100% fiel do que um texto longo com invenção.',
    '  Encher linguiça, repetir ou criar narrativa/contexto fora dos fatos é falha grave.',
    '- Só desenvolva um fato com contexto que esteja NOS PRÓPRIOS fatos.',
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

// ─────────────────────────────────────── Step 3: faithfulness check

// Confere o texto gerado contra os fatos. Não reescreve — só audita. Sinaliza
// qualquer afirmação sem lastro (invenção, dedução não declarada, nome/número novo,
// aspas de veículo) pra matéria ir pra revisão com o motivo apontado.
export const VERIFY_SYSTEM = [
  'Você é um AUDITOR de fidelidade factual, em português do Brasil. Recebe os FATOS',
  '(JSON, a única verdade) e um TEXTO gerado a partir deles. NÃO reescreva o texto.',
  '',
  'Sua tarefa: listar TODA afirmação do TEXTO que NÃO esteja sustentada pelos FATOS —',
  'invenção, dedução de consequência não declarada (ex.: dizer que um time "foi',
  'eliminado" ou "enfrenta X depois" sem isso nos fatos), nome/número/data novo, ou',
  'aspas/frase atribuída a veículo de imprensa.',
  '',
  'Responda via a ferramenta record_check: ok=true só se TUDO tiver lastro; senão',
  'ok=false e issues com uma frase curta por problema (citando o trecho). Seja rigoroso.',
].join('\n');

export function buildVerifyContents(facts: Record<string, unknown>, text: string): string {
  return ['FATOS:', JSON.stringify(facts, null, 2), '', 'TEXTO GERADO:', text.trim()].join('\n');
}

export const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'true se toda afirmação do texto tem lastro nos fatos' },
    issues: {
      type: 'array',
      items: { type: 'string' },
      description: 'uma frase curta por afirmação sem lastro (vazio se ok=true)',
    },
  },
  required: ['ok', 'issues'],
} as const;
