# Cotação IA

SaaS multi-tenant que automatiza o recebimento e o processamento de **solicitações de cotação** para distribuidoras de materiais elétricos e de automação industrial.

O vendedor recebe o pedido do cliente por **upload**, **e-mail** ou **WhatsApp**; o sistema extrai os itens, normaliza, busca no catálogo, apresenta os candidatos com a justificativa técnica e, depois da **revisão humana**, monta a cotação e exporta em **PDF, Excel ou CSV**.

```
receber solicitação → extrair itens → normalizar → buscar no catálogo → apresentar candidatos
                    → revisão humana → montar cotação → exportar
```

> **Ambiente de demonstração.** O seed cria a empresa fictícia "Elétrica Central", com 185 produtos, clientes e solicitações inventados. Todas as telas identificam esses dados como fictícios, e as integrações simuladas aparecem como **simuladas** — nunca como conectadas a serviços reais.

---

## Sumário

1. [Como rodar](#como-rodar)
2. [Contas de demonstração e roteiro](#contas-de-demonstração-e-roteiro)
3. [Comandos](#comandos)
4. [Stack](#stack)
5. [Arquitetura em um minuto](#arquitetura-em-um-minuto)
6. [Testes](#testes)
7. [Integrações externas](#integrações-externas)
8. [Segurança e LGPD](#segurança-e-lgpd)
9. [O que foi e o que não foi verificado](#o-que-foi-e-o-que-não-foi-verificado)
10. [Fora do escopo desta versão](#fora-do-escopo-desta-versão)
11. [Solução de problemas](#solução-de-problemas)

---

## Como rodar

**Pré-requisitos:** Node.js 22.12 ou superior, npm e Docker (com Docker Compose).

```bash
# 1. Dependências (o postinstall regenera o cliente Prisma em src/generated/prisma)
npm install

# 2. Configuração local — os valores de exemplo funcionam sem nenhum serviço externo
cp .env.example .env

# 3. Infraestrutura: PostgreSQL 16, Redis 7 e um storage compatível com S3 (RustFS)
docker compose up -d

# 4. Banco de dados (migrations) + dados de demonstração
npm run demo:setup

# 5. Aplicação web + worker de processamento (dois processos)
npm run dev:all
```

Abra **http://localhost:3000**. A raiz é a [página pública](docs/pagina-publica.md) do produto; clique em **Entrar** (ou abra `/login`) e use uma das [contas de demonstração](#contas-de-demonstração-e-roteiro). Quem já tem sessão cai direto no painel.

Para os botões da página pública abrirem uma conversa no seu WhatsApp, defina `LANDING_WHATSAPP_NUMBER` no `.env` (DDI + DDD + número). Sem ele, os botões levam às demonstrações da própria página.

`npm run dev:all` sobe o Next.js e o worker lado a lado. Se preferir terminais separados: `npm run dev` e `npm run worker`.

O bucket privado do storage é criado pela própria aplicação (`S3_AUTO_CREATE_BUCKET=true` no `.env.example`); não há passo manual. As portas do PostgreSQL, do Redis e do storage ficam publicadas só em `127.0.0.1`, porque as credenciais locais são conhecidas.

### Sem Redis e sem storage S3 (apenas PostgreSQL)

Para uma demonstração mínima, altere no `.env`:

```dotenv
QUEUE_DRIVER=inline     # processa no próprio servidor web; dispensa Redis e o worker
STORAGE_DRIVER=local    # arquivos em .data/storage, com URLs assinadas; dispensa o contêiner de storage
```

Use esse modo só para demonstração e testes: em produção, o processamento deve ficar no worker.

### Tudo em contêineres

```bash
docker compose --profile app up -d --build
```

Sobe também `web` (porta 3000), `worker` e um serviço `migrate` que aplica as migrations. A imagem roda com `NODE_ENV=production`, e nesse modo a aplicação **recusa os segredos de exemplo**. Antes de subir, edite o `.env`:

- gere `SESSION_SECRET` (`openssl rand -base64 48`) e `ENCRYPTION_KEY` (`openssl rand -base64 32`);
- para manter o login de demonstração, defina `ALLOW_DEMO_AUTH_IN_PRODUCTION=true` (ou configure o Supabase Auth);
- remova ou substitua os segredos `dev-only-…` de webhook.

Depois, rode o seed uma vez: `docker compose --profile app run --rm web npm run db:seed`.

---

## Contas de demonstração e roteiro

Com `AUTH_PROVIDER=demo`, todas as contas usam a senha definida em `DEMO_PASSWORD` (`demo1234` no `.env.example`).

| Conta | Papel | Para ver |
|---|---|---|
| `ana.souza@eletricacentral.example` | Proprietária (e Administradora da Volt Sul) | Tudo, inclusive a troca de empresa |
| `bruno.lima@eletricacentral.example` | Vendedor | Revisão e cotações; sem acesso a catálogo/integrações |
| `carla.mendes@eletricacentral.example` | Leitura | Apenas consulta |
| `diego.rocha@voltsul.example` | Proprietário da Volt Sul | Outra empresa: nada da Elétrica Central é visível |

**Roteiro sugerido (5 minutos):**

1. **Painel** — indicadores, solicitações por dia e por canal, resultado da identificação.
2. **Caixa de entrada → Nova solicitação** — envie `demo/fixtures/lista-materiais-serra-verde.xlsx`. A tela acompanha o processamento sozinha.
3. **Revisão** — documento original à esquerda, itens à direita. Aceite as sugestões fortes, escolha entre os candidatos ambíguos, veja os produtos **descartados por incompatibilidade técnica** (com o motivo) e marque o que não existe como "não encontrado". Atalhos: `J`/`K` navegam, `A` aceita o 1º candidato, `N` marca não encontrado.
4. **Gerar cotação** — edite quantidades, preços, descontos, validade e observações; salve, finalize e exporte em PDF, Excel ou CSV.
5. **Integrações → Simulador local** — gere uma mensagem de WhatsApp ou um e-mail fictícios, que passam pelo webhook de verdade (assinatura, roteamento e idempotência).
6. Entre como `diego.rocha@voltsul.example` e confira o isolamento entre empresas.

Os cenários do seed estão descritos em [`docs/demo.md`](docs/demo.md): todos os itens identificados, itens não encontrados, especificações incompatíveis, documento pouco legível, múltiplos itens e informações incompletas.

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` / `npm run worker` | Servidor web (Next.js) / worker de processamento |
| `npm run dev:all` | Os dois acima, juntos |
| `npm run build` / `npm run start` | Build e execução em modo produção |
| `npm run worker:build` | Empacota o worker em `dist/worker.mjs` (`node dist/worker.mjs`) |
| `npm run db:migrate` | Aplica as migrations (`prisma migrate deploy`) |
| `npm run db:migrate:sql` | Aplica as mesmas migrations só com o driver `pg` — veja [Solução de problemas](#solução-de-problemas) |
| `npm run db:seed` | Recria o ambiente de demonstração (não toca em empresas reais) |
| `npm run demo:setup` | `db:migrate` + `db:seed` |
| `npm run demo:whatsapp` / `npm run demo:email` | Simuladores locais de webhook (`-- --duplicar` demonstra a idempotência) |
| `npm run org:create -- --nome "Empresa" --email dono@empresa.com.br --usuario "Nome"` | Cria uma empresa real e seu proprietário |
| `npm run retention:purge` | Aplica agora a política de retenção de documentos |
| `npm run landing:build` | Regenera o motor das demonstrações da página pública (`public/landing/engine.js`) — rode ao mudar regras de leitura ou de correspondência |
| `npm test` | Testes unitários e de integração |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |

---

## Stack

| Camada | Tecnologia |
|---|---|
| Web | Next.js 16 (App Router, Turbopack), React 19, TypeScript 5.9 |
| Interface | Tailwind CSS 4, componentes no padrão shadcn/ui (Radix UI), lucide-react |
| Banco | PostgreSQL 16 (`pg_trgm`, `unaccent`, busca textual em português), Prisma 7 |
| Filas | Redis 7 + BullMQ 6, com worker em processo separado |
| Arquivos | Storage compatível com S3 (RustFS no ambiente local) com URLs pré-assinadas |
| Autenticação | Supabase Auth (produção) ou provedor de demonstração |
| IA | Anthropic ou OpenAI, atrás de uma abstração; provedor mock determinístico para demonstração e testes |
| Testes | Vitest |

É um **monólito modular**: um único repositório e um único deploy, com o worker rodando como processo independente a partir do mesmo código.

---

## Arquitetura em um minuto

```
src/
  app/            Rotas do Next.js: páginas (pt-BR), Server Actions e rotas de API (webhooks, upload, exportação)
  components/     Interface: primitivas (ui/), casca do app (shell/), gráficos, componentes de cliente
  server/         Sessão, contexto de tenant, wrapper de Server Actions, utilitários HTTP
  modules/        Domínio — sem dependência do Next.js; usado pela web, pelo worker e pelos testes
    identity/       autenticação (abstração), papéis e permissões, membros, organizações
    tenancy/        contexto de tenant e cliente Prisma com escopo de organização
    inbox/          ingestão única + adaptadores de canal (upload, e-mail, WhatsApp)
    documents/      inspeção de arquivos, PDF, planilhas, CSV
    ai/             abstração de provedor, schema Zod da extração, Anthropic, OpenAI, mock
    extraction/     extração e normalização determinística dos itens
    normalization/  texto, unidades e atributos técnicos (corrente, tensão, polos, seção…)
    matching/       Matching Engine híbrido (recuperação em SQL + pontuação pura)
    catalog/        produtos, sinônimos, códigos, listas de preços, importação
    pricing/        resolução de preço (lista do cliente → lista padrão → catálogo)
    requests/       consulta e revisão humana das solicitações
    quotations/     cotações, totais (aritmética decimal) e exportação
    processing/     jobs, fila, pipeline, worker, recuperação e retenção
    storage/        object storage privado (S3 ou disco) com URLs temporárias
    audit/          trilha de auditoria
    landing/        página pública ("/"): modelo HTML, link de contato e motor das demonstrações
  platform/       Infraestrutura transversal: env, banco, Redis, criptografia, logs, erros
  demo/           Catálogo, cenários, seed e simulador do ambiente de demonstração
public/landing/   CSS, JS, fontes e motor (gerado) da página pública
prisma/           schema.prisma, migrations versionadas e seed
scripts/          worker, simuladores, criação de empresa, retenção, migrations em SQL, motor da página pública
tests/            unit/ (funções puras) e integration/ (PostgreSQL e Redis reais)
```

Pontos centrais — detalhes em [`docs/arquitetura.md`](docs/arquitetura.md):

- **Um pipeline para todos os canais.** Cada canal é um adaptador fino que entrega uma `IncomingMessage` a `ingestInboundMessage`. Dali em diante (armazenamento, fila, extração, matching, revisão) o caminho é o mesmo. Um canal novo não exige mudança no pipeline.
- **A IA extrai; o sistema decide.** O modelo de linguagem só transforma o documento em itens estruturados (validados com Zod). Normalização, busca no catálogo, validação de atributos e pontuação são determinísticas e testáveis. Números que o modelo "deduzir" e que não constem no documento são descartados.
- **Compatibilidade técnica antes de semelhança textual.** Um disjuntor de 32 A nunca é sugerido para um pedido de 40 A: produtos com atributo crítico divergente saem da lista de candidatos e aparecem como "descartados", com o motivo.
- **Nada é aprovado sozinho.** Toda sugestão — mesmo a "forte" — depende de uma ação explícita do revisor. Preços vêm só do catálogo ou das listas importadas; produto sem preço fica sem preço até alguém informá-lo.
- **Isolamento em três camadas.** Autorização nos serviços de domínio (nunca só na interface), cliente Prisma com escopo de organização e chaves estrangeiras compostas `(organization_id, id)` no banco.

---

## Testes

```bash
docker compose up -d      # PostgreSQL (banco cotacao_test) e Redis
npm test                  # tudo
npm run test:unit         # só funções puras (não precisa de banco)
npm run test:integration  # PostgreSQL real; o teste da fila usa Redis e é ignorado se ele não estiver no ar
```

Os testes de integração recriam o schema do banco `cotacao_test` a cada execução, aplicando as migrations versionadas. Não usam nenhum serviço externo: IA mock, fila em linha e storage em disco temporário.

| Área | Arquivo | Exemplos do que é verificado |
|---|---|---|
| Matching | `unit/matching-scoring`, `integration/matching` | 32 A × 40 A, código × descrição contraditórios, sinônimos, erro de digitação, produto inativo |
| Atributos técnicos | `unit/attributes` | corrente, polos, seção, tensão CA/CC, diâmetro, faixa de ajuste, trecho ilegível |
| Extração estruturada | `unit/extraction` | schema Zod, descarte de valores não presentes no documento, provedores com clientes simulados |
| Importação de catálogo | `integration/catalog-import` | CSV brasileiro, Excel, atualização por SKU, sinônimos, reimportação, lista de preços |
| Isolamento entre empresas | `integration/tenant-isolation` | leitura e escrita cruzadas por ID, cliente com escopo, chaves compostas no banco |
| Idempotência de webhooks | `integration/webhooks`, `unit/webhooks` | reentrega, entregas simultâneas, assinatura inválida, roteamento, mídias |
| Processamento de documentos | `integration/pipeline`, `integration/queue-bullmq` | os seis cenários de exemplo, novas tentativas, recuperação de jobs, retenção |
| Geração de cotações | `integration/quotation`, `unit/quotation-totals` | numeração concorrente, totais, preços, ciclo de vida, exportações |
| Permissões | `integration/permissions`, `unit/security` | cada papel, proteção de proprietários, atores de sistema |
| Schema | `integration/schema-drift` | migrations × `schema.prisma`, índices e restrições |
| Página pública | `unit/landing`, `unit/proxy` | link do WhatsApp, montagem do modelo, motor em dia com o produto, rotas públicas × protegidas |

---

## Integrações externas

Nenhuma integração exige credencial para rodar a demonstração. Cada uma tem um adaptador, testes com simulações e um guia de configuração:

| Integração | Guia | Sem credenciais… |
|---|---|---|
| WhatsApp Business Cloud API (oficial da Meta) | [`docs/integracoes/whatsapp.md`](docs/integracoes/whatsapp.md) | o webhook responde 503; o simulador local funciona |
| E-mail de entrada por webhook | [`docs/integracoes/email.md`](docs/integracoes/email.md) | os adaptadores respondem 503; o simulador local funciona |
| IA — Anthropic ou OpenAI | [`docs/integracoes/ia.md`](docs/integracoes/ia.md) | usa o provedor mock (identificado na interface) |
| Supabase Auth | [`docs/integracoes/supabase-auth.md`](docs/integracoes/supabase-auth.md) | usa o login de demonstração (recusado em produção) |
| Object storage S3 | [`docs/integracoes/armazenamento.md`](docs/integracoes/armazenamento.md) | usa o storage S3 local (contêiner) ou o disco |

Todas as variáveis estão documentadas em [`.env.example`](.env.example). A configuração é validada na inicialização: se um provedor é escolhido sem as credenciais dele, a aplicação informa o que falta e não sobe.

---

## Segurança e LGPD

Resumo — a lista completa e o checklist de produção estão em [`docs/seguranca-lgpd.md`](docs/seguranca-lgpd.md).

- **Isolamento por organização** verificado no backend, com teste automatizado para cada tipo de recurso; um ID de outra empresa responde como inexistente (proteção contra IDOR).
- **Papéis** Proprietário, Administrador, Vendedor e Leitura, conferidos em cada serviço.
- **Uploads** validados pelo conteúdo real do arquivo (assinatura binária), com limite de tamanho e de quantidade.
- **Arquivos privados**: nunca há URL pública; cada acesso gera uma URL temporária depois da verificação de autorização.
- **Webhooks** autenticados pelo corpo bruto (HMAC da Meta; HMAC com carimbo de tempo ou Basic Auth no e-mail) e idempotentes.
- **Credenciais de integração** cifradas com AES-256-GCM e vinculadas à organização; a interface exibe apenas uma máscara.
- **Auditoria** de ações relevantes; **retenção** configurável e **exclusão** manual dos documentos originais.
- **Erros** inesperados nunca expõem detalhes internos ao usuário; os logs mascaram segredos.

---

## O que foi e o que não foi verificado

Este projeto foi construído e exercitado em um ambiente isolado, com PostgreSQL 16 e Redis reais. Para que você saiba exatamente em que pode confiar:

**Verificado**

- `npm run lint`, `npm run typecheck` e `npm run build` sem erros.
- 227 testes automatizados (unitários e de integração) passando, incluindo o teste com Redis + BullMQ.
- Página pública em `/` (Chromium automatizado, em `next dev` e em `next start`): desktop, tablet e celular, demonstrações funcionando sob a política de conteúdo restrita, botões apontando para o WhatsApp configurado, **Entrar** → login → painel, e `/` levando ao painel quando há sessão. Auditoria automática de acessibilidade (axe-core) sem violações. O clique que abre o WhatsApp não foi exercitado: depende do aplicativo de quem visita.
- Fluxo completo no navegador (Chromium automatizado): login → upload → processamento pelo worker → revisão → cotação → edição → finalização → exportação em PDF, Excel e CSV — com o storage em disco e também com `STORAGE_DRIVER=s3` (apontado para um servidor S3 de teste local).
- Com `STORAGE_DRIVER=s3`: seed completo, bucket criado pela aplicação, anexos entregues por URL pré-assinada (PDF e imagem exibidos na tela de revisão), `401` sem sessão e `404` para usuário de outra organização.
- Webhooks de WhatsApp e de e-mail via HTTP, com os simuladores locais: assinatura válida e inválida, reentrega e roteamento.
- Worker empacotado (`dist/worker.mjs`) processando a fila.

**Não verificado — exige o seu ambiente ou as suas credenciais**

- **`prisma migrate deploy` não foi executado aqui.** O ambiente de construção bloqueava o download do motor de schema do Prisma (`binaries.prisma.sh`). As migrations em `prisma/migrations` foram escritas no formato do Prisma e aplicadas diretamente no PostgreSQL 16 — é com elas que todos os testes rodam, e um teste compara tabelas, colunas e enums com o `schema.prisma`. Ainda assim, a primeira execução de `npm run db:migrate` será na sua máquina. Se o Prisma apontar diferenças cosméticas ao rodar `prisma migrate dev` (nomes de índices ou de restrições), gere uma migration de ajuste. `npm run db:migrate:sql` é uma alternativa equivalente e testada.
- **Chamadas reais à Anthropic, à OpenAI, à Meta, ao Supabase e a um provedor de e-mail não foram feitas** (não há credenciais). Os adaptadores seguem a documentação oficial e são testados com clientes simulados; a primeira chamada real pode pedir ajustes — em especial os identificadores de modelo em `ANTHROPIC_MODEL` e `OPENAI_MODEL`, que devem ser conferidos na documentação do provedor.
- **O storage S3 foi exercitado só contra um servidor S3 de teste local**, não contra o RustFS do Docker Compose, a AWS S3 nem o R2. Esse servidor de teste não confere assinaturas nem aplica controle de acesso, então a recusa de acessos anônimos e de URLs adulteradas — que cabe ao storage — não pôde ser comprovada aqui. Os testes automatizados usam o storage em disco e, para o adaptador S3, um cliente simulado.
- **Docker Compose e Dockerfile não foram executados.** O ambiente de construção tinha Docker, mas bloqueava o Docker Hub e os outros registros de imagens testados, então nenhuma imagem pôde ser baixada. O `docker-compose.yml` foi validado com `docker compose config` nos dois perfis, e a imagem do storage (`rustfs/rustfs:1.0.6`) e a sua configuração seguem a documentação oficial do RustFS — mas a primeira execução real será na sua máquina. Se o contêiner `storage` der problema, veja [Solução de problemas](#solução-de-problemas): a aplicação roda sem ele.
- O **visualizador de PDF** embutido na tela de revisão usa o leitor do próprio navegador. Foi verificado no Chromium; em outros navegadores (ou em dispositivos sem leitor de PDF embutido) use "Ver texto extraído", "Abrir em nova aba" ou "Baixar".
- Não houve teste de carga nem auditoria de segurança independente.

---

## Fora do escopo desta versão

Por decisão de produto, o MVP **não** inclui: CRM completo, ERP próprio, controle avançado de estoque, integrações reais com ERPs, automação financeira, emissão fiscal, pagamentos, aprovação automática de pedidos, agentes autônomos que negociem preços nem portal completo para clientes finais.

Também ficaram para depois: busca semântica (o ponto de extensão existe — veja a arquitetura), envio de respostas pelo WhatsApp/e-mail, OAuth com Gmail/Outlook, cadastro de usuários por convite com e-mail transacional e limitador de taxa distribuído.

---

## Solução de problemas

**O `npm install` avisa que `prisma generate` falhou, ou `npm run db:migrate` não baixa o motor do Prisma (`binaries.prisma.sh` bloqueado).**
Redes corporativas às vezes bloqueiam esse host — foi o caso do ambiente em que este projeto foi construído. O que fazer:

- a pasta entregue já inclui o cliente Prisma gerado (`src/generated/prisma`), então a aplicação roda mesmo sem o `prisma generate`. Ele só precisa ser refeito se você alterar o `schema.prisma`;
- aplique as migrations com `npm run db:migrate:sql`, que usa só o driver `pg` e registra o resultado em `_prisma_migrations` (compatível com `prisma migrate deploy`), e depois rode `npm run db:seed`;
- para liberar os comandos do Prisma, aponte para um espelho interno com a variável oficial `PRISMA_ENGINES_MIRROR`.

Em execução, o cliente Prisma não usa binário nativo: ele roda com o adaptador `pg`.

**`npm install` termina com "3 high severity vulnerabilities".**
Os três alertas vêm da cadeia de dependências da **CLI do Prisma** (pacote `effect`, via `@prisma/config`), usada apenas em desenvolvimento — não fazem parte do código que atende requisições. Não rode `npm audit fix --force`: a "correção" proposta rebaixa o Prisma para uma versão incompatível. Reavalie quando houver uma versão do Prisma que atualize essa dependência.

**O npm aponta para um registro corporativo.**
O `.npmrc` do projeto fixa `registry=https://registry.npmjs.org/`. Remova a linha se quiser usar o registro da sua empresa.

**`npm run typecheck` acusa erro em `.next/…/types/validator.ts` (por exemplo, `Cannot find module '../../src/app/page.js'`).**
São tipos gerados por uma execução anterior do Next.js, de antes de uma rota mudar de lugar. Apague a pasta `.next` (ou rode `npx next typegen`) e repita; `npm run dev` e `npm run build` também os regeneram.

**A solicitação fica "Na fila de processamento".**
O worker não está rodando (`npm run worker`) ou o Redis está fora do ar. Quando o worker voltar, os jobs pendentes são recuperados sozinhos.

**A imagem do storage não baixa, o contêiner `storage` não fica de pé ou o seed avisa que não conseguiu acessar o storage S3.**
Veja `docker compose ps` e `docker compose logs storage`. A aplicação não depende desse contêiner: defina `STORAGE_DRIVER=local` no `.env` (arquivos em `.data/storage`, igualmente privados e com URLs temporárias) e rode `npm run demo:setup` de novo. Para usar outra versão do RustFS, troque a tag da imagem em `docker-compose.yml`; qualquer outro storage compatível com S3 também serve — ajuste as variáveis `S3_*` (detalhes em [`docs/integracoes/armazenamento.md`](docs/integracoes/armazenamento.md)).

**"Não foi possível obter este arquivo" na revisão, com `STORAGE_DRIVER=s3`.**
O navegador precisa alcançar o endpoint do storage. Com a aplicação em contêiner, defina `S3_PUBLIC_ENDPOINT` com o endereço visto de fora (ex.: `http://localhost:9000`).

**Em `npm run dev`, a página recarrega sem parar.**
O cache de desenvolvimento do Turbopack ficou inconsistente. Aconteceu uma vez durante a construção deste projeto — ao que tudo indica, depois de o servidor de desenvolvimento ser encerrado à força. Pare o servidor, apague a pasta `.next` e suba de novo.

**Os botões do simulador estão desabilitados.**
Faltam `WHATSAPP_APP_SECRET` e `EMAIL_WEBHOOK_SECRET` no `.env` (o `.env.example` já traz valores locais) ou o ambiente não é o de demonstração.

**Porta ocupada.**
`PORT=3100 npm run dev` muda a porta do Next.js; ajuste também `APP_URL`.
