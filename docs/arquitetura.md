# Arquitetura

Monólito modular em Next.js. Todo o domínio vive em `src/modules` e não depende do framework: a aplicação web, o worker e os testes usam os mesmos serviços.

```
                 ┌──────────── canais ────────────┐
   upload ──────►│ POST /api/uploads              │
   e-mail ──────►│ POST /api/webhooks/email/:prov │──► ingestInboundMessage ──► InboundMessage
   WhatsApp ────►│ POST /api/webhooks/whatsapp    │        (idempotente)         Attachment
                 └────────────────────────────────┘                              QuotationRequest
                                                                                 ProcessingJob ──► fila (BullMQ)
                                                                                                      │
   ┌───────────────────────────────── worker ────────────────────────────────────────────────────────┘
   │  1. baixa mídias pendentes (WhatsApp)        4. normaliza itens e atributos (determinístico)
   │  2. identifica o tipo real de cada arquivo   5. Matching Engine contra o catálogo da organização
   │  3. extrai itens (tabela direta ou IA)       6. grava itens + candidatos → "Aguardando revisão"
   └──────────────────────────────────────────────────────────────────────────────────────────────────
                                                         │
                                   revisão humana ──► cotação ──► PDF / Excel / CSV
```

## Camadas

| Pasta | Responsabilidade | Pode importar |
|---|---|---|
| `src/app` | Rotas, páginas, Server Actions e rotas de API. Sem regra de negócio. | `server`, `modules`, `components` |
| `src/server` | Sessão, contexto de tenant, tratamento de erros de actions e de rotas. | `modules`, `platform` |
| `src/modules` | Regras de negócio, por domínio. | outros módulos, `platform` |
| `src/platform` | Banco, Redis, env, criptografia, logs, erros. | nada do projeto |
| `src/components` | Interface. Componentes de cliente importam dos módulos apenas **tipos**. | `lib` |
| `public/landing` | Arquivos estáticos da página pública (`/`), independentes do painel. Veja [pagina-publica.md](pagina-publica.md). | — |

Convenções que valem em todo o código:

- **Toda função de serviço recebe um `TenantContext`** (organização, ator e papel), resolvido no servidor a partir da sessão, do webhook autenticado ou do job. Nenhum identificador de organização vindo do cliente é usado para autorizar.
- **A autorização acontece no serviço** (`assertCan(ctx, "permissão")`), não na página nem na Server Action. A interface apenas esconde o que o papel não alcança.
- **Entradas externas são validadas com Zod** na borda (Server Actions, rotas, webhooks, saída da IA).
- **Erros de negócio** são `AppError` com código estável e mensagem em português, segura para exibição. Qualquer outro erro é registrado e devolvido de forma genérica.

## Multi-tenancy

Banco único, com `organization_id` em todas as tabelas de negócio. O isolamento tem três camadas independentes:

1. **Serviços**: toda consulta parte de `tenantDb(ctx.organizationId)`.
2. **Cliente Prisma com escopo** (`src/modules/tenancy/tenant-db.ts`): uma extensão que injeta `organization_id` em toda leitura e escrita dos modelos de tenant, carimba as criações e impede que uma atualização mova um registro para outra organização.
3. **Banco**: as tabelas têm chave única `(organization_id, id)` e as relações usam **chaves estrangeiras compostas**. Um item da empresa A não consegue referenciar um produto da empresa B nem por SQL direto.

Consultas em SQL bruto (busca, painel, reivindicação de jobs) não passam pela extensão e filtram `organization_id` explicitamente.

Um ID de outra organização devolve o mesmo "não encontrado" de um ID inexistente, para não revelar a existência do registro. Tudo isso é coberto por `tests/integration/tenant-isolation.test.ts`.

Papéis: **Proprietário**, **Administrador**, **Vendedor** e **Leitura** (`src/modules/identity/permissions.ts`). Atores de sistema (worker, webhook) não recebem permissões de usuário: executam apenas a ingestão e o pipeline.

## Canais de entrada

Todos os canais convergem para `ingestInboundMessage` (`src/modules/inbox/ingest.ts`), que:

- deduplica pela chave `(organização, canal, id externo)` — `wamid` no WhatsApp, `Message-ID` no e-mail, chave do formulário no upload;
- valida cada anexo pelo conteúdo real e o grava no storage privado;
- cria a mensagem, a solicitação e o job de processamento em uma transação;
- enfileira o job (se o envio à fila falhar, a rotina de recuperação o reenvia).

Para criar um canal novo (por exemplo, um formulário público ou uma API), basta escrever um adaptador que autentique a origem, monte uma `IncomingMessage` e chame essa função. O pipeline não muda.

## Pipeline de documentos

`src/modules/processing/pipeline.ts` — executado pelo worker, uma vez por mensagem:

1. **Download de mídias** remotas (WhatsApp), com lista de hosts permitidos.
2. **Detecção do tipo** pelo conteúdo: PDF, planilha, imagem, áudio.
3. **Extração**, na estratégia mais barata que resolve:
   - planilha com cabeçalho reconhecível → leitura direta das linhas, **sem IA** (cada item aponta a linha de origem);
   - PDF com texto → texto extraído + IA;
   - PDF digitalizado e imagens → IA com visão;
   - áudio → transcrição + IA;
   - texto da mensagem → IA.
4. **Validação** da saída da IA com o schema Zod (`src/modules/ai/schema.ts`).
5. **Normalização determinística** (`src/modules/extraction/normalize-item.ts`): unidades, quantidades e atributos técnicos são recalculados por regras a partir do texto original.
6. **Matching** de cada item contra o catálogo.
7. Gravação atômica dos itens e candidatos; a solicitação passa a "Aguardando revisão".

**Nunca inventar.** Quando o texto do documento é conhecido, qualquer número proposto pela IA (corrente, quantidade, código) que não exista nele é descartado, com uma nota para o revisor. Um trecho ilegível (`4_A`) nunca vira um valor. Quantidade ausente fica nula.

### Filas, novas tentativas e recuperação

O estado do job vive no banco (`ProcessingJob`); o BullMQ só agenda.

- **Idempotência**: o worker reivindica o job com um `UPDATE … WHERE status = 'QUEUED'` atômico. Um segundo worker — ou uma segunda entrega — encontra o job já reivindicado e não faz nada. O `jobId` da fila é o ID do job no banco.
- **Novas tentativas**: falhas temporárias (rede, limite de taxa, erro 5xx do provedor) são reagendadas com espera exponencial, até 5 tentativas. Falhas definitivas (credencial inválida, arquivo corrompido) não são repetidas.
- **Recuperação**: a cada minuto e na inicialização, o worker reenfileira jobs que ficaram no banco sem chegar à fila e jobs em execução sem *heartbeat* (worker que caiu).
- **Falha final**: a solicitação fica marcada como "Falha no processamento", com mensagem segura, e pode ser reprocessada pela interface.

`QUEUE_DRIVER=inline` substitui o Redis por execução no próprio processo — útil para demonstração e testes.

## Matching Engine

`src/modules/matching` — em duas etapas, para que a parte que decide seja pura e testável.

**1. Recuperação** (`retrieval.ts`, SQL, sempre filtrando a organização e produtos ativos). Cada estratégia traz até 20 candidatos:

| Estratégia | Como |
|---|---|
| SKU exato | código normalizado igual ao SKU |
| Código do fabricante | igual ao código do produto ou a um código equivalente cadastrado |
| Busca textual | `to_tsvector('portuguese', search_text)` com consulta OU e `ts_rank_cd` (índice GIN) |
| Similaridade (fuzzy) | `pg_trgm` sobre a descrição normalizada (índice GIN de trigramas) |
| Sinônimos | `pg_trgm` sobre os sinônimos cadastrados |
| Semântica | ponto de extensão — desligado nesta versão |

**2. Pontuação** (`scoring.ts`, função pura):

- **Código idêntico** vale 0,99 (SKU), 0,97 (fabricante) ou 0,95 (código equivalente).
- Sem código: `0,55 × semelhança de texto + 0,45 × atributos conferidos`. A semelhança de texto combina cobertura dos termos do pedido (números pesam o dobro; o tipo do produto, o triplo) e trigramas.
- **Atributo crítico divergente torna o candidato incompatível**: ele sai da lista e vai para "descartados", com a divergência descrita (`Corrente: pedido 32 A × produto 40 A`). A pontuação fica limitada a 0,29.
- Atributo que o catálogo não informa conta como **desconhecido**: não reprova, mas reduz a pontuação.
- Unidade diferente e divergências não críticas (cor, por exemplo) descontam pontos.
- Texto muito diferente limita a pontuação a 0,25, mesmo com atributos iguais — uma válvula 24 Vcc não é uma fonte 24 Vcc.

**Classificação do item:**

| Resultado | Critério |
|---|---|
| Sugestão forte | melhor candidato ≥ 0,78, ao menos 0,08 à frente do segundo e sem dúvida técnica |
| Ambíguo | há candidatos plausíveis, mas a escolha exige análise |
| Sem correspondência | nenhum candidato compatível ≥ 0,35 |

Um código que identifica um produto e uma descrição que aponta para outro (código do modelo 220 V, texto pedindo 24 V) nunca resultam em sugestão forte.

Os limiares estão em `MATCHING_THRESHOLDS`. Todos os resultados — inclusive a sugestão forte — aguardam a decisão de uma pessoa.

### Atributos técnicos

`src/modules/normalization` reconhece 25 atributos (tensão, tipo de tensão, corrente, faixa de ajuste, polos, fases, seção, condutores, diâmetro, dimensões, material, rosca, potência, curva, corrente residual, capacidade de interrupção, tipo de saída, contatos, frequência, grau de proteção, cor, comprimento, temperatura de cor…). Cada um é marcado como **crítico** ou não, e a comparação devolve `MATCH`, `MISMATCH` ou `UNKNOWN`.

Os atributos do produto são derivados da descrição no cadastro e na importação, e os do pedido, do texto do item. As mesmas regras valem para os dois lados.

### Busca semântica

Preparada, mas **desligada**. O que existe:

- a interface `SemanticRetriever` (`src/modules/matching/semantic.ts`), já consultada por `PgCandidateRetriever` e já considerada na pontuação como mais um sinal de semelhança;
- a imagem do PostgreSQL no Docker Compose (`pgvector/pgvector:pg16`) traz a extensão `vector` disponível.

Para habilitar: criar uma migration com `CREATE EXTENSION vector`, uma coluna `embedding vector(N)` em `products` e um índice HNSW; gerar os embeddings no cadastro e na importação; e fornecer uma implementação de `SemanticRetriever` que faça a busca por similaridade de cosseno filtrando `organization_id`. A validação de atributos continua valendo: semelhança semântica nunca torna compatível um produto tecnicamente diferente.

## Preços e cotações

- **Resolução de preço** (`src/modules/pricing/resolve.ts`): lista do cliente → lista padrão da organização → preço de catálogo → **sem preço**. A origem fica gravada em cada item (`PRICE_LIST`, `CATALOG`, `MANUAL`).
- **Totais** (`src/modules/quotations/totals.ts`): aritmética decimal exata, arredondamento "meio para cima" em duas casas. O que o navegador mostra durante a edição é uma prévia; o valor oficial é sempre recalculado no servidor.
- **Numeração**: `COT-<ano>-<5 dígitos>`, por organização, obtida com um incremento atômico — criações simultâneas não repetem número.
- **Fotografia**: a cotação copia descrição, unidade, preço e dados do cliente. Alterações posteriores no catálogo não a modificam; "Atualizar preços" é uma ação explícita.
- **Ciclo de vida**: rascunho → finalizada (travada; pode ser reaberta) ou cancelada (definitivo; devolve a solicitação à revisão).

## Modelo de dados

`prisma/schema.prisma` — 19 modelos: `Organization`, `User`, `Membership`, `Customer`, `Product`, `ProductAlias`, `PriceList`, `PriceListItem`, `Integration`, `InboundMessage`, `Attachment`, `ChannelEvent`, `QuotationRequest`, `RequestedItem`, `ProductMatch`, `Quotation`, `QuotationItem`, `ProcessingJob` e `AuditLog`.

As migrations ficam em `prisma/migrations`. A segunda adiciona o que o Prisma não expressa no schema: o índice de busca textual, o índice parcial que garante uma única lista de preços padrão por organização e as restrições `CHECK` (quantidades positivas, percentuais entre 0 e 100, preços não negativos…).

## Decisões e alternativas

| Decisão | Por quê |
|---|---|
| Monólito modular, worker no mesmo repositório | Um time pequeno, um deploy; os módulos já têm fronteiras claras caso algum precise sair. |
| Banco único com `organization_id` | Simples de operar e de migrar; o isolamento é reforçado por chaves compostas e por testes. |
| Matching determinístico, IA só na extração | Resultados reproduzíveis, explicáveis e testáveis; custo de IA proporcional ao número de documentos, não de produtos. |
| Planilhas lidas sem IA quando possível | Mais barato, exato e rastreável por linha. |
| Server Actions para mutações, rotas para arquivos e webhooks | Menos código de API; rotas onde é preciso o corpo bruto ou arquivos grandes. |
| Componentes no padrão shadcn/ui, escritos no projeto | Sem dependência de registro externo; fáceis de adaptar. |
| Gráficos em SVG próprio | Dois gráficos simples não justificam uma biblioteca de gráficos. |
| Página pública como HTML estático, servida por uma rota | Fica isolada do React e do Tailwind do painel, carrega rápido e aceita uma política de conteúdo sem script embutido. As demonstrações reutilizam os módulos puros do produto, empacotados para o navegador. |
