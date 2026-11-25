# Segurança e LGPD

O que está implementado, onde fica no código, o que é coberto por teste — e o que ainda depende de você antes de publicar.

## Controles implementados

### Isolamento entre organizações

| Controle | Onde | Teste |
|---|---|---|
| Contexto de tenant resolvido no servidor (sessão, webhook ou job); nenhum ID de organização do cliente é usado para autorizar | `src/server/session.ts`, `src/modules/tenancy/context.ts` | `integration/tenant-isolation` |
| Cliente Prisma com escopo: filtra leituras, carimba criações, impede mover registros entre organizações | `src/modules/tenancy/tenant-db.ts` | idem |
| Chaves estrangeiras compostas `(organization_id, id)` em todas as relações entre tabelas de negócio | `prisma/schema.prisma` | idem (tentativas por SQL direto) |
| SQL bruto sempre com filtro explícito de `organization_id` | busca, painel, jobs | idem |
| ID de outra organização = "não encontrado" (não revela existência; proteção contra IDOR) | `src/platform/ids.ts`, serviços | idem |
| Troca de empresa ativa só entre empresas das quais o usuário é membro | `src/app/(app)/actions.ts` | — |

### Autenticação e autorização

| Controle | Onde |
|---|---|
| Supabase Auth em produção; o provedor de demonstração é recusado com `NODE_ENV=production` | `src/platform/env.ts` |
| Sessão em cookies `httpOnly`, `SameSite=Lax`, `Secure` em produção; token validado no servidor a cada requisição | `src/modules/identity/auth` |
| Permissões por papel verificadas **em cada serviço** (`assertCan`), não só na interface | `src/modules/identity/permissions.ts` |
| Só proprietários promovem, rebaixam ou removem proprietários; a empresa nunca fica sem proprietário | `src/modules/identity/users.ts` |
| Atores de sistema (worker, webhook) sem permissões de usuário | `permissions.ts` |
| Vínculo da conta por convite + e-mail verificado | `resolveUser` |
| Limite de tentativas de login por IP e por conta; mensagem única para e-mail/senha inválidos | `src/app/login/actions.ts` |
| Destino pós-login restrito a caminhos internos (sem redirecionamento aberto) | idem |

Testes: `integration/permissions`, `unit/security`.

### Entradas e endpoints públicos

| Controle | Onde |
|---|---|
| Validação com Zod de toda entrada de Server Actions, rotas e webhooks | `src/app/**/actions.ts`, serviços |
| Upload: tipo definido pelo conteúdo real (assinatura binária), limite de tamanho lido de fato (não só `Content-Length`), limite de quantidade | `src/modules/documents/inspect.ts`, `src/server/http.ts` |
| Rotas com cookie que alteram estado exigem mesma origem (CSRF); Server Actions têm a verificação nativa do Next.js | `assertSameOrigin` |
| Webhook do WhatsApp: HMAC-SHA256 do corpo bruto com a chave do app, comparação em tempo constante | `channels/whatsapp/signature.ts` |
| Webhook de e-mail: HMAC com carimbo de tempo (anti-*replay*) ou Basic Auth, conforme o provedor | `channels/email` |
| Idempotência por chave única `(organização, canal, id externo)` | `src/modules/inbox/ingest.ts` |
| Download de mídia só de hosts da Meta, com limite de tamanho e de redirecionamentos (SSRF) | `channels/whatsapp/media.ts` |
| Limite de taxa em login, upload, importação e webhooks (em memória, por instância) | `src/server/http.ts` |
| Busca no catálogo com consultas parametrizadas; o texto do usuário nunca é concatenado em SQL | `matching/retrieval.ts`, `catalog/products.ts` |
| Exportação CSV com neutralização de fórmulas (*CSV injection*) | `quotations/export/csv.ts` |
| Cabeçalhos: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` e CSP básica (`frame-ancestors`, `object-src`, `base-uri`, `form-action`) | `next.config.ts` |

Testes: `unit/webhooks`, `integration/webhooks`, `integration/pipeline`, `integration/matching` (entradas hostis).

### Dados e segredos

| Controle | Onde |
|---|---|
| Arquivos em storage privado; acesso só por URL temporária emitida após autorização | `src/modules/storage`, `inbox/attachments.ts` |
| Chave de armazenamento gerada pelo servidor; nome original higienizado | `storage/index.ts`, `documents/inspect.ts` |
| Token do WhatsApp cifrado com AES-256-GCM, vinculado à organização (dado autenticado adicional); a interface recebe só uma máscara | `src/platform/crypto.ts`, `integrations.ts` |
| Segredos de aplicação apenas em variáveis de ambiente; validação na inicialização | `src/platform/env.ts` |
| Segredos de exemplo (`dev-only-…`, chaves do `.env.example`) recusados em produção | idem |
| Logs estruturados com mascaramento de campos sensíveis (tokens, senhas, cabeçalhos de autorização) | `src/platform/logger.ts` |
| Erros inesperados nunca chegam ao usuário com detalhes internos | `src/server/actions.ts`, `processing/runner.ts` |
| Preços e totais com aritmética decimal; valores recalculados no servidor | `quotations/totals.ts` |

### Auditoria

`audit_logs` registra quem fez o quê e quando: revisão de itens, cotações (criação, edição, finalização, exportação), catálogo e importações, membros e papéis, integrações e credenciais, download e exclusão de documentos, expurgo por retenção. A consulta fica em **Configurações › Auditoria** (Administrador e Proprietário). A aplicação não oferece edição nem exclusão desses registros.

## LGPD

O Cotação IA trata dados pessoais de **contatos de clientes** (nome, e-mail, telefone, eventualmente CPF) e o **conteúdo dos documentos** recebidos. Em geral a distribuidora é a controladora e quem opera o sistema, a operadora — confirme com o seu jurídico.

| Princípio / direito | O que o sistema oferece |
|---|---|
| Minimização | Cadastro de clientes enxuto; nenhum dado sensível é solicitado |
| Limitação da conservação | **Retenção configurável** por empresa (Configurações › Empresa): após N dias, anexos, texto das mensagens e texto extraído são apagados automaticamente pelo worker. Itens e cotações (registros comerciais) permanecem |
| Eliminação a pedido do titular | **Excluir documentos originais** na tela da solicitação (Administrador/Proprietário), com registro na auditoria |
| Segurança | Controles descritos acima |
| Transparência sobre operadores | Com IA real, os documentos são enviados ao provedor escolhido — veja `docs/integracoes/ia.md` |
| Dados fictícios | O ambiente de demonstração usa apenas empresas, pessoas e contatos inventados (domínio `.example`, telefones evidentemente fictícios) |

O que **não** existe e pode ser necessário: relatório de dados por titular, anonimização de clientes, eliminação completa de uma organização por interface, registro de consentimento e painel de incidentes.

## Checklist antes de publicar

**Configuração**

- [ ] `NODE_ENV=production` e `APP_URL` com o endereço HTTPS público.
- [ ] `SESSION_SECRET` e `ENCRYPTION_KEY` gerados para o ambiente e guardados em um cofre de segredos. Faça cópia de segurança da `ENCRYPTION_KEY`: perdê-la invalida as credenciais de integração salvas.
- [ ] `AUTH_PROVIDER=supabase`, com confirmação de e-mail e, de preferência, cadastro público desabilitado.
- [ ] Segredos reais de webhook (`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `EMAIL_WEBHOOK_SECRET` ou credenciais do Postmark).
- [ ] `AI_PROVIDER` real, com os termos de tratamento de dados do provedor revisados.

**Infraestrutura**

- [ ] HTTPS em toda a aplicação, com HSTS no proxy reverso ou CDN.
- [ ] O proxy reverso deve **sobrescrever** `X-Forwarded-For` (o limite de taxa e a auditoria confiam nesse cabeçalho).
- [ ] Banco com TLS, usuário sem privilégios de superusuário, cópias de segurança e teste de restauração.
- [ ] Bucket privado, criado pela infraestrutura (`S3_AUTO_CREATE_BUCKET=false`), com credencial restrita a ele, criptografia em repouso e política de ciclo de vida.
- [ ] Redis sem exposição pública, com senha e persistência.
- [ ] Limite de taxa e proteção contra abuso no gateway ou CDN (o limitador interno é por instância).
- [ ] Coleta centralizada de logs e alertas para falhas de processamento e respostas 5xx.

**Aplicação**

- [ ] CSP completa, com *nonces*, se a sua política exigir (a atual cobre enquadramento, plugins, `<base>` e destino de formulários).
- [ ] Remover as organizações de demonstração do banco de produção (ou nunca rodar o seed nele).
- [ ] Definir a retenção de documentos de cada empresa.
- [ ] Revisão de segurança independente e teste de intrusão.

## Limites conhecidos

- Limitador de taxa em memória: não é compartilhado entre instâncias e é zerado a cada reinício.
- Sem antivírus nos anexos.
- Sem autenticação em dois fatores na aplicação (pode ser configurada no Supabase, com ajuste no adaptador).
- Sem *Row Level Security* no PostgreSQL: o isolamento é feito na aplicação e pelas chaves compostas. RLS seria uma quarta camada, útil se outros sistemas acessarem o mesmo banco.
- A sessão de demonstração não tem revogação no servidor antes do vencimento do token (12 horas).
- Nenhuma auditoria de segurança externa foi realizada.
