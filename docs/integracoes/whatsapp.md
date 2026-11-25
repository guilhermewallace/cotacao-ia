# WhatsApp Business Cloud API

A integração usa **exclusivamente a API oficial da Meta** (WhatsApp Business Cloud API). Não há automação de WhatsApp Web nem bibliotecas não oficiais.

Nesta versão a integração é de **entrada**: recebe mensagens e as transforma em solicitações de cotação. O envio de respostas pelo WhatsApp não foi implementado.

> No ambiente de demonstração existe uma integração **simulada**, com um número fictício. Ela não fala com a Meta: as mensagens chegam apenas pelo simulador local (`npm run demo:whatsapp` ou o botão em Integrações). A tela deixa isso explícito.

## O que é recebido

| Tipo de mensagem | Tratamento |
|---|---|
| Texto | Os itens são extraídos do próprio texto |
| Documento (PDF, planilha) | Baixado e processado como anexo; a legenda é tratada como texto |
| Imagem (foto de lista, print) | Baixada e lida por visão computacional (exige provedor de IA real) |
| Áudio | Baixado e transcrito, se `TRANSCRIPTION_PROVIDER` estiver configurado |
| Figurinha, localização, reação, contato | Ignorados |
| Eventos de status (`sent`, `delivered`, `read`, `failed`) | Registrados em `channel_events`; não criam solicitação |

Se o telefone do remetente estiver no cadastro de clientes, a solicitação já chega associada ao cliente (e à lista de preços dele).

## Configuração

### 1. No painel da Meta (developers.facebook.com)

1. Crie um aplicativo do tipo **Business** e adicione o produto **WhatsApp**.
2. Em *WhatsApp › Configuração da API*, anote o **Phone Number ID** e o **WhatsApp Business Account ID**.
3. Gere um **token de acesso permanente**: crie um *usuário do sistema* no Gerenciador de Negócios, atribua o aplicativo e o ativo do WhatsApp a ele e gere um token com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`. O token temporário do painel expira em 24 horas e serve só para testes.
4. Em *Configurações do app › Básico*, copie a **Chave secreta do aplicativo**.

### 2. No servidor (variáveis de ambiente)

```dotenv
WHATSAPP_APP_SECRET=<chave secreta do aplicativo>
WHATSAPP_VERIFY_TOKEN=<um valor aleatório escolhido por você>
WHATSAPP_GRAPH_API_VERSION=v25.0
```

Esses dois segredos são do **aplicativo** (um por instalação do Cotação IA), por isso ficam em variáveis de ambiente. A versão da Graph API é usada ao baixar mídias; cada versão tem prazo de validade — consulte as [versões disponíveis](https://developers.facebook.com/docs/graph-api/changelog/versions) e atualize o valor de tempos em tempos. Os valores `dev-only-…` do `.env.example` servem só ao simulador e são recusados em produção.

### 3. Webhook na Meta

Em *WhatsApp › Configuração › Webhook*:

- **URL de retorno de chamada**: `https://SEU-DOMINIO/api/webhooks/whatsapp` (a tela Integrações mostra a URL exata);
- **Token de verificação**: o mesmo valor de `WHATSAPP_VERIFY_TOKEN`;
- assine o campo **`messages`**.

A URL precisa ser pública e HTTPS. Em desenvolvimento, use um túnel (ngrok, Cloudflare Tunnel) e ajuste `APP_URL`.

### 4. No Cotação IA (por empresa)

Em **Integrações › WhatsApp Business**, informe o *Phone Number ID*, o número exibido (opcional), o ID da conta (opcional) e o **token de acesso**. Exige o papel Administrador ou Proprietário.

O token é cifrado com AES-256-GCM antes de ser gravado, vinculado à organização, e nunca é devolvido à interface — só os quatro últimos caracteres. Um mesmo *Phone Number ID* não pode ser vinculado a duas organizações.

O selo "Configurada" indica apenas que as credenciais foram gravadas. A conexão só é comprovada quando a primeira notificação chega ("Última notificação recebida em…").

## Como funciona

```
Meta ──POST──► /api/webhooks/whatsapp
                 1. limite de taxa por IP e limite de tamanho do corpo
                 2. valida X-Hub-Signature-256 (HMAC-SHA256 do corpo BRUTO com a chave do app)
                 3. interpreta o payload (Zod)
                 4. localiza a organização pelo phone_number_id
                 5. ingere cada mensagem (idempotente pelo wamid) e responde 200
worker ──────► baixa as mídias com o token da organização e executa o pipeline
```

- **Verificação do endpoint** (`GET`): responde o `hub.challenge` somente se `hub.verify_token` coincidir (comparação em tempo constante).
- **Assinatura**: calculada sobre os bytes recebidos, antes de qualquer interpretação. Sem assinatura válida a resposta é `401` e nada é gravado.
- **Idempotência**: a Meta reenvia notificações quando não recebe `200` a tempo. Uma chave única `(organização, canal, id externo)` garante que a mesma mensagem — reenviada ou entregue em paralelo — crie uma única solicitação. Eventos de status têm a mesma proteção.
- **Roteamento**: pelo `phone_number_id`. Notificações de um número desconhecido são respondidas com `200` (para a Meta não reenviar) e descartadas.
- **Resposta rápida**: o webhook só valida, grava e enfileira. O download das mídias e a extração ficam no worker.
- **Download de mídia** (`src/modules/inbox/channels/whatsapp/media.ts`): consulta a URL na Graph API e baixa com o token da organização. Só são aceitos hosts da Meta (proteção contra SSRF), com limite de tamanho e de redirecionamentos. Depois do download, o arquivo passa pela mesma validação de conteúdo do upload.
- **Falhas**: erro temporário no download reagenda o job; erro definitivo (mídia expirada) marca o anexo como falho e avisa o revisor.

## Testar sem a Meta

```bash
npm run demo:whatsapp                          # mensagem de exemplo
npm run demo:whatsapp -- --amostra wa-incompativel
npm run demo:whatsapp -- --texto "5 disjuntor bipolar 32A curva C"
npm run demo:whatsapp -- --duplicar            # mesma notificação duas vezes → a 2ª é "duplicates: 1"
npm run demo:whatsapp -- --assinatura-invalida # → HTTP 401
```

O simulador monta a notificação no formato da Cloud API, assina com `WHATSAPP_APP_SECRET` e faz um `POST` no webhook em execução. Requer o seed aplicado (a integração simulada usa o `phone_number_id` fictício `100000000000001`).

Testes automatizados: `tests/unit/webhooks.test.ts` e `tests/integration/webhooks.test.ts`.

## Limites conhecidos

- Não foi testado contra a API real da Meta (não havia credenciais). O adaptador segue a documentação oficial; confira a versão da Graph API em `WHATSAPP_GRAPH_API_VERSION` ao configurar.
- Mensagens em sequência do mesmo remetente viram solicitações separadas (não há agrupamento por conversa).
- Não há envio de mensagens nem de modelos (*templates*).
- O limitador de taxa do webhook é por instância do processo; em produção com várias instâncias, complemente no gateway.
