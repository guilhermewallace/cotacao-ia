# E-mail de entrada

Cada empresa tem um **endereço exclusivo de recebimento**:

```
<identificador-da-empresa>@<EMAIL_INBOUND_DOMAIN>
```

Os e-mails enviados a esse endereço — corpo e anexos — viram solicitações de cotação e seguem o mesmo pipeline dos demais canais.

Não há integração por OAuth com Gmail ou Outlook nesta versão. O recebimento é por **webhook de um provedor de e-mail de entrada** (*inbound parse*), atrás de uma abstração que permite trocar de provedor sem tocar no restante do sistema.

> No ambiente de demonstração nenhum provedor está conectado e o domínio `inbound.cotacao.localhost` não recebe e-mails reais. Use o simulador (`npm run demo:email`).

## Visão geral

```
cliente ──► cotacoes@suaempresa.com.br ──(redirecionamento)──► <chave>@inbound.seudominio.com.br
                                                                      │  MX
                                                               provedor de e-mail de entrada
                                                                      │  webhook HTTPS
                                                   POST /api/webhooks/email/<provedor>
                                                     1. autentica a chamada (antes de ler o conteúdo)
                                                     2. interpreta o formato do provedor
                                                     3. localiza a empresa pelo destinatário
                                                     4. ingere (idempotente pelo Message-ID)
```

O que cada empresa precisa fazer: ativar o recebimento em **Integrações › E-mail de entrada** e divulgar o endereço aos clientes — ou, o mais comum, criar um redirecionamento a partir do e-mail comercial.

- O identificador do endereço é gerado pelo sistema e contém um sufixo aleatório. "Gerar novo endereço" invalida o anterior na hora (útil se ele vazar ou passar a receber spam).
- Também é aceito o formato `qualquercoisa+<chave>@<domínio>` (*plus addressing*).
- E-mails para um endereço desconhecido ou com o recebimento desativado são respondidos com `200` e ignorados.
- Se o e-mail do remetente estiver no cadastro de clientes, a solicitação já chega associada ao cliente.
- Imagens pequenas embutidas no corpo (assinaturas, logotipos) são descartadas.

## Configuração do domínio

```dotenv
EMAIL_INBOUND_DOMAIN=inbound.seudominio.com.br
```

Aponte o registro **MX** desse subdomínio para o provedor escolhido, conforme a documentação dele.

## Provedores

### Postmark Inbound

```dotenv
POSTMARK_WEBHOOK_USER=<usuário à sua escolha>
POSTMARK_WEBHOOK_PASSWORD=<senha longa e aleatória>
```

No Postmark, em *Servers › Inbound › Settings*, configure:

- **Inbound domain**: o valor de `EMAIL_INBOUND_DOMAIN`;
- **Webhook URL**: `https://USUARIO:SENHA@SEU-DOMINIO/api/webhooks/email/postmark`.

O Postmark não assina as requisições; a autenticação recomendada por ele é o HTTP Basic Auth embutido na URL. O adaptador compara as credenciais em tempo constante.

### Webhook genérico assinado

Para qualquer outro provedor, um pequeno serviço intermediário (ou uma função do próprio provedor) pode converter o e-mail para o formato abaixo e assiná-lo.

```dotenv
EMAIL_WEBHOOK_SECRET=<segredo longo e aleatório>
```

`POST /api/webhooks/email/generic`, com `Content-Type: application/json`:

```json
{
  "messageId": "<id-unico@remetente.example>",
  "from": { "address": "compras@cliente.example", "name": "Marina Duarte" },
  "to": ["minhaempresa-ab12cd@inbound.seudominio.com.br"],
  "subject": "Pedido de cotação",
  "text": "Favor cotar…",
  "html": "<p>opcional</p>",
  "date": "2026-11-23T12:00:00Z",
  "attachments": [
    { "fileName": "pedido.pdf", "contentType": "application/pdf", "contentBase64": "JVBERi0x…" }
  ]
}
```

Cabeçalho de assinatura:

```
X-Cotacao-Signature: t=<timestamp em segundos>,v1=<HMAC-SHA256 em hexadecimal>
```

O HMAC é calculado, com `EMAIL_WEBHOOK_SECRET`, sobre `"<timestamp>." + <corpo bruto>`. Assinaturas com mais de alguns minutos são recusadas, para impedir reenvio (*replay*).

Exemplo em Node.js:

```js
import { createHmac } from "node:crypto";

const body = JSON.stringify(payload);
const timestamp = Math.floor(Date.now() / 1000);
const signature = createHmac("sha256", process.env.EMAIL_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("hex");

await fetch("https://SEU-DOMINIO/api/webhooks/email/generic", {
  method: "POST",
  headers: { "content-type": "application/json", "x-cotacao-signature": `t=${timestamp},v1=${signature}` },
  body,
});
```

### Adicionar outro provedor

1. Crie `src/modules/inbox/channels/email/<provedor>.ts` implementando `InboundEmailProvider` (`types.ts`):
   - `isConfigured()` — as credenciais do provedor estão no ambiente?
   - `authenticate(request)` — valida a chamada (assinatura, Basic Auth, token) a partir dos cabeçalhos e do corpo bruto;
   - `parse(request)` — converte o formato do provedor em `ParsedInboundEmail`.
2. Registre o provedor em `handler.ts` (`getInboundEmailProvider`).

A rota `/api/webhooks/email/[provider]`, o roteamento por organização, a idempotência e o pipeline já funcionam para o provedor novo.

## Anexos

Valem as mesmas regras do upload: PDF, XLSX, XLS, CSV, JPG e PNG, com o limite de `MAX_UPLOAD_MB` por arquivo. O tipo é identificado pelo conteúdo. Um anexo não permitido é registrado como **rejeitado**, com o motivo, sem impedir o processamento do restante do e-mail.

O corpo da requisição do webhook é limitado a três vezes `MAX_UPLOAD_MB` (os anexos chegam em base64).

## Testar sem provedor

```bash
npm run demo:email
npm run demo:email -- --amostra mail-incompleto
npm run demo:email -- --anexo demo/fixtures/pedido-cotacao-horizonte-azul.pdf
npm run demo:email -- --duplicar      # o 2º envio responde {"status":"duplicate"}
```

O simulador usa o adaptador genérico: monta o JSON, assina com `EMAIL_WEBHOOK_SECRET` e faz o `POST` no webhook em execução.

Testes automatizados: `tests/unit/webhooks.test.ts` e `tests/integration/webhooks.test.ts`.

## Limites conhecidos

- Não foi testado com o Postmark real nem com outro provedor (não havia credenciais).
- Cada e-mail vira uma solicitação; respostas na mesma conversa não são agrupadas.
- Não há envio de e-mails (confirmação de recebimento, envio da cotação).
