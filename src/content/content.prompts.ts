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
  '- competition/score: preencha SÓ se aparecerem EXPLÍCITOS no texto. Se a competição',
  '  NÃO for nomeada, deixe competition "" — NUNCA adivinhe o torneio (não chute "Copa',
  '  América", "Brasileirão" etc.). Idem placar: vazio se não estiver escrito.',
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

// Categorias-âncora do site (navegação + SEO). O modelo escolhe a MAIS próxima; se
// nada servir, pode propor uma curta. Lista guia (não trava) — editável na revisão.
export const CONTENT_CATEGORIES = [
  'Copa do Mundo',
  'Seleção Brasileira',
  'Brasileirão',
  'Libertadores',
  'Copa do Brasil',
  'Futebol Internacional',
  'Análise',
  'Bastidores',
] as const;

// The tom's style guide (NewsTone.promptText) is sandwiched between hard rules so
// the voice can be playful while the facts stay honest. A geração agora devolve um
// PACOTE estruturado (record_article): além do corpo, o SEO/GEO/taxonomia que faz a
// matéria ser achável no Google e citável por buscadores generativos (ChatGPT,
// Perplexity, AI Overviews). TUDO continua preso aos fatos — inclusive dek/FAQ/takeaways.
export function buildGenerateSystem(tonePrompt: string): string {
  return [
    'Você é um redator e editor de SEO esportivo que produz uma matéria ORIGINAL',
    'A PARTIR DE FATOS já apurados, em português do Brasil, com uma VOZ EDITORIAL',
    'específica, pronta para PUBLICAR no site e ATRAIR TRÁFEGO ORGÂNICO.',
    '',
    '═══ VOZ EDITORIAL (siga à risca no title/dek/body) ═══',
    tonePrompt.trim(),
    '',
    '═══ REGRAS INEGOCIÁVEIS (valem para TODOS os campos) ═══',
    '- Use APENAS os fatos fornecidos. É PROIBIDO inventar, supor ou acrescentar',
    '  qualquer informação que não esteja nos fatos (placar, nome, data, número) —',
    '  isso vale também para dek, keyTakeaways, faq, metaDescription e tags.',
    '- PROIBIDO DEDUZIR CONSEQUÊNCIAS não declaradas: se um time venceu, NÃO afirme que o',
    '  outro "foi eliminado", nem "quem ele enfrenta depois", nem como o jogo se desenrolou',
    '  ("reagiu quando precisava", "situação delicada") — nada disso, a menos que esteja nos fatos.',
    '- Não copie frases do texto original (você nem o recebe) — escreva do zero.',
    '- Citações entre aspas só se vierem em quotes, sempre com atribuição a quem falou.',
    '- body: texto corrido, SEM markdown, SEM títulos com #, SEM listas.',
    '',
    '═══ EXTENSÃO (o tamanho SEGUE os fatos) ═══',
    '- O comprimento do body é DITADO pela quantidade de fatos. Poucos fatos → texto curto:',
    '  1–2 parágrafos, ou até uma nota de poucas linhas. NUNCA escreva além do que os',
    '  fatos sustentam. Texto CURTO e 100% fiel > texto longo com invenção.',
    '',
    '═══ SEO (busca tradicional) ═══',
    '- title: a manchete jornalística (na voz editorial), clara e específica, ~60–70 caracteres.',
    '- metaTitle: o <title> da página. ≤60 caracteres, com a PALAVRA-CHAVE no começo. Pode',
    '  ser mais direto/seco que o title (otimizado p/ clique no Google), sem clickbait.',
    '- metaDescription: resumo atrativo de 120–155 caracteres, com a palavra-chave, que',
    '  convide ao clique. Sem aspas, sem reticências no fim.',
    '- focusKeyword: a expressão de busca principal (ex.: "brasil x marrocos copa do mundo").',
    '- keywords: 3–6 termos secundários relacionados (entidades + intenção de busca).',
    '',
    '═══ RESULTADO DE JOGO (quando os FATOS trazem placar/gols) ═══',
    '- É o caso dos resumos de partida. Trate como os portais (ge.globo, ESPN): o PLACAR',
    '  é a manchete e a principal palavra-chave de busca.',
    '- title: comece com "Time A N x M Time B" e complete com dois-pontos + um gancho curto',
    '  do que DECIDIU (quem marcou, virada, o que o resultado mudou na tabela). Ex.:',
    '  "México 1 x 0 Coreia do Sul: Romo decide no fim e seleção assume a ponta do Grupo A".',
    '- metaTitle: "Time A N x M Time B" + contexto (competição/rodada), ≤60 chars. O PLACAR',
    '  NUNCA pode faltar. PROIBIDO genérico ("veja o resultado", "confira como foi").',
    '',
    '═══ GEO (otimização para buscadores generativos / IA) ═══',
    '- dek: UMA frase que responde direto "o que aconteceu" (linha-fina/subtítulo). É o',
    '  trecho que uma IA mais provavelmente cita — factual, completo e autossuficiente.',
    '- keyTakeaways: 3–5 pontos curtos, factuais e extraíveis (placar, gols, números, tabela).',
    '  Cada um deve fazer sentido lido sozinho. Sem opinião sem lastro.',
    '- faq: 2–4 perguntas naturais que o leitor/IA faria sobre o fato (ex.: "Quem marcou os',
    '  gols?", "Como ficou a classificação?"), com respostas CURTAS e 100% fiéis aos fatos.',
    '',
    '═══ TAXONOMIA ═══',
    `- category: escolha a MAIS próxima desta lista — ${CONTENT_CATEGORIES.join(', ')}. Se`,
    '  nenhuma servir, proponha uma categoria curta. Só UMA.',
    '- tags: 3–8 entidades do fato (times, jogadores/técnicos, competição). Nomes canônicos curtos.',
    '- imageAlt: alt-text descritivo p/ a imagem de capa, citando os times/contexto do fato.',
    '',
    'Responda SOMENTE via a ferramenta record_article, preenchendo todos os campos.',
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

// JSON Schema do artigo completo (corpo + SEO + GEO + taxonomia) — forced tool use.
export const GENERATE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'manchete jornalística na voz editorial, ~60–70 chars' },
    body: { type: 'string', description: 'corpo da matéria, texto corrido, sem markdown/títulos/listas' },
    dek: { type: 'string', description: 'linha-fina: 1 frase factual que responde "o que aconteceu" (GEO)' },
    metaTitle: { type: 'string', description: '<title> SEO, ≤60 chars, palavra-chave no começo' },
    metaDescription: { type: 'string', description: 'meta description, 120–155 chars, com palavra-chave' },
    focusKeyword: { type: 'string', description: 'expressão de busca principal' },
    keywords: { type: 'array', items: { type: 'string' }, description: '3–6 termos secundários' },
    category: { type: 'string', description: 'categoria principal (uma só)' },
    tags: { type: 'array', items: { type: 'string' }, description: '3–8 entidades: times, pessoas, competição' },
    keyTakeaways: {
      type: 'array',
      items: { type: 'string' },
      description: 'GEO: 3–5 pontos factuais curtos, extraíveis e autossuficientes',
    },
    faq: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
        },
        required: ['question', 'answer'],
      },
      description: 'GEO: 2–4 perguntas naturais + respostas curtas fiéis aos fatos',
    },
    imageAlt: { type: 'string', description: 'alt-text da imagem de capa' },
  },
  required: [
    'title',
    'body',
    'dek',
    'metaTitle',
    'metaDescription',
    'category',
    'tags',
    'keyTakeaways',
    'faq',
  ],
} as const;

// ─────────────────────────────────────── Step 3: faithfulness check

// Audita o texto gerado contra a FONTE original (a verdade de fato). O auditor PODE
// ver a fonte — só o GERADOR precisa ser cego pra não copiar. Pega dois problemas:
// (1) FIDELIDADE: afirmação que não está na fonte ou a contradiz (ex.: competição/
//     placar/nome trocado — inclusive erro vindo da extração);
// (2) DERIVAÇÃO: texto colado demais na fonte (paráfrase/condensação reusando aspas,
//     comunicados e estrutura dela, sem conteúdo independente).
export const VERIFY_SYSTEM = [
  'Você é um AUDITOR editorial rigoroso, em português do Brasil. Recebe a FONTE original',
  'e um TEXTO gerado a partir dela por outro processo. NÃO reescreva nada — só audite.',
  '',
  '═══ 1) FIDELIDADE ═══',
  'Liste TODA afirmação do TEXTO que NÃO esteja na FONTE ou que a CONTRADIGA: competição,',
  'placar, nome, número, data trocados ou inventados; dedução de consequência não declarada',
  '(ex.: "foi eliminado", "enfrenta X depois"). A FONTE é a verdade — se o TEXTO afirma algo',
  'que a fonte não diz (ex.: nomeia um torneio que a fonte não nomeia), é problema.',
  '',
  '═══ 2) DERIVAÇÃO ═══',
  'Avalie se o TEXTO é uma paráfrase/condensação PRÓXIMA da FONTE — reaproveitando a',
  'expressão específica dela (aspas literais, frases de comunicado oficial, a mesma',
  'estrutura) sem acrescentar nada independente. derivative=true se for, no fundo, a',
  'fonte reescrita; false se usa só os FATOS crus com texto próprio.',
  '',
  'Responda via record_check: issues (fidelidade — uma frase curta por problema, citando',
  'o trecho; [] se nenhum), derivative (bool) e derivativeReason (curto). Seja rigoroso.',
].join('\n');

export function buildVerifyContents(source: string, text: string): string {
  return [
    'FONTE ORIGINAL (a verdade):',
    (source || '(sem corpo)').trim().slice(0, 6000),
    '',
    'TEXTO GERADO (a auditar):',
    text.trim(),
  ].join('\n');
}

export const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: { type: 'string' },
      description: 'afirmações do texto sem lastro na fonte ou que a contradizem; [] se nenhuma',
    },
    derivative: {
      type: 'boolean',
      description: 'true se o texto é paráfrase/condensação próxima da fonte (reusa expressão dela)',
    },
    derivativeReason: { type: 'string', description: 'por que é derivado (curto); "" se não for' },
  },
  required: ['issues', 'derivative'],
} as const;

// ─────────────────────────────────────── Step 3 (variante): fontes generativas
//
// Para matéria gerada a partir dos NOSSOS FATOS estruturados (ex.: resumo de partida),
// não existe prosa-fonte de terceiro: a "fonte" é o próprio JSON de fatos. Então só
// faz sentido auditar FIDELIDADE (invenção/contradição) — NÃO derivação (reusar
// placar/nomes/minutos dos fatos é o esperado, não um problema).
export const VERIFY_FACTS_SYSTEM = [
  'Você é um AUDITOR editorial rigoroso, em português do Brasil. Recebe um conjunto de',
  'FATOS estruturados (JSON, a verdade) e um TEXTO gerado a partir deles. NÃO reescreva —',
  'só audite a FIDELIDADE aos fatos.',
  '',
  'Liste em issues APENAS afirmação do TEXTO que de fato NÃO se sustente nos FATOS ou que os',
  'CONTRADIGA: competição, placar, nome, número, minuto, contagem ou colocação na tabela',
  'trocados/inventados; e DEDUÇÃO de consequência que os fatos não suportam (ex.: "foi',
  'eliminado", "está classificado", "enfrenta X na próxima fase").',
  '',
  'issues é SÓ a lista de PROBLEMAS REAIS. NÃO escreva seu raciocínio nela. Se ao analisar',
  'algo você concluir que é fiel/aceitável/"sem problema", NÃO inclua esse item — deixe-o',
  'FORA da lista. Cada item de issues deve ser um problema concreto, não uma ponderação.',
  '',
  'O que é FIEL e NÃO deve ser listado:',
  '- reaproveitar os dados dos FATOS (placar, nomes, minutos, assistências, estatísticas, tabela);',
  '- ler direto um valor (ex.: "venceu" quando há 1 vitória na tabela);',
  '- ARREDONDAMENTO razoável (80.663 → "80 mil"; 51,4% → "51%"; "quase metade");',
  '- SINÔNIMO de posição/função compatível com os fatos (ex.: "F" → "centroavante/atacante");',
  '- linguagem do TOM (gíria, ironia) que não cria fato novo.',
  '',
  'Responda via record_check: issues (uma frase curta por PROBLEMA real, citando o trecho;',
  '[] se nenhum problema real).',
].join('\n');

export function buildVerifyFactsContents(factsJson: string, text: string): string {
  return [
    'FATOS (a verdade):',
    factsJson.trim().slice(0, 12000),
    '',
    'TEXTO GERADO (a auditar):',
    text.trim(),
  ].join('\n');
}

export const VERIFY_FACTS_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: { type: 'string' },
      description: 'afirmações do texto sem lastro nos fatos ou que os contradizem; [] se nenhuma',
    },
  },
  required: ['issues'],
} as const;
