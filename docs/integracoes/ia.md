# Inteligência artificial

A IA tem **uma única função**: ler o documento recebido e devolver os itens em formato estruturado. Ela não escolhe produtos, não decide equivalências e não define preços — isso é feito por código determinístico (veja `docs/arquitetura.md`).

## Provedores

| `AI_PROVIDER` | Uso | Lê imagens e PDFs digitalizados? |
|---|---|---|
| `mock` (padrão) | Demonstração e testes. Sem nenhuma chamada externa. | Apenas os documentos de exemplo do seed |
| `anthropic` | Produção | Sim |
| `openai` | Produção | Sim |

```dotenv
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-…
ANTHROPIC_MODEL=claude-sonnet-5-5

# ou
AI_PROVIDER=openai
OPENAI_API_KEY=sk-…
OPENAI_MODEL=gpt-6.2-astra
```

Os identificadores de modelo mudam com frequência. **Confira os nomes vigentes na documentação do provedor antes de publicar** — os valores do `.env.example` são um ponto de partida, não uma garantia. Escolha um modelo com entrada de imagem/PDF e saída estruturada.

A chave de API fica só no servidor (variável de ambiente): não vai para o navegador nem para o banco. Se `AI_PROVIDER` for `anthropic` ou `openai` sem a chave correspondente, a aplicação não inicia e informa o que falta.

A tela **Integrações** mostra o provedor em uso. Com o mock, a tela de revisão avisa que os itens vieram do provedor simulado.

## Como a extração funciona

Para cada documento, o provedor recebe as instruções do sistema (`src/modules/ai/prompt.ts`), o conteúdo (texto, PDF ou imagem) e o **schema** da resposta (`src/modules/ai/schema.ts`), e devolve:

```ts
{
  documentType: "quotation_request" | "other" | "unreadable",
  legibility: "good" | "partial" | "poor",
  customer: { name, taxId, email, phone, contactName } | null,
  items: [{
    originalDescription,   // exatamente como está no documento
    normalizedDescription, // abreviações expandidas; null se não houver ganho
    quantity, unit,        // null quando o documento não informa
    manufacturer, manufacturerCode,
    attributes: [{ name, value }],
    page, sourceExcerpt, confidence, notes
  }],
  warnings: []
}
```

- **Anthropic**: `messages.parse` com `output_config.format` (saída estruturada a partir do schema Zod).
- **OpenAI**: `responses.parse` com `text.format` (idem).

A resposta é validada de novo com Zod do nosso lado. Resposta fora do schema é tratada como erro temporário e repetida; nunca é gravada.

### Proteções contra informação inventada

O prompt instrui o modelo a usar `null` para o que não estiver no documento, mas o sistema **não depende disso**. Em `src/modules/extraction/normalize-item.ts`:

- os atributos técnicos são recalculados por regras a partir do texto original do item; o que o modelo informar só preenche lacunas;
- quando o texto do documento é conhecido, todo número proposto pelo modelo (atributo, descrição normalizada, quantidade) precisa existir nele — caso contrário é descartado, com uma nota para o revisor;
- código e fabricante só são aceitos se aparecerem no documento;
- marcadores de trecho ilegível nunca são convertidos em valor.

Em imagens e PDFs digitalizados não há texto de referência para essa conferência: nesses casos a leitura do modelo é aceita, a legibilidade informada por ele é exibida, e a revisão humana — obrigatória para todo item — é a salvaguarda.

### Quando a IA não é chamada

Planilhas (XLSX, XLS, CSV) com cabeçalho reconhecível — coluna de descrição e de quantidade ou código, ou uma lista de coluna única — são lidas diretamente, linha a linha. É mais barato, exato e rastreável. A solicitação aparece com o provedor `tabular`.

### Falhas

| Situação | Comportamento |
|---|---|
| Erro de rede, limite de taxa (429), erro 5xx | Nova tentativa com espera exponencial, até 5 vezes |
| Credencial inválida, requisição recusada (4xx) | Sem nova tentativa; a solicitação fica "Falha no processamento" e pode ser reprocessada |
| Resposta truncada (documento muito extenso) | Falha definitiva, com mensagem explicativa |
| Um documento falha, outros não | Os itens lidos são mantidos e a falha vira um aviso ao revisor |

Mensagens de erro exibidas ao usuário nunca incluem detalhes internos nem a resposta do provedor.

## O provedor mock

`src/modules/ai/providers/mock.ts` — determinístico, sem rede:

1. **Documentos de exemplo** (os arquivos de `demo/fixtures`) são reconhecidos pelo SHA-256 do conteúdo e recebem uma resposta fixa, preparada em `src/demo/scenarios.ts` — como a que um modelo de visão daria. É o que permite demonstrar a foto de lista manuscrita sem um modelo real.
2. **Qualquer outro texto** passa por um extrator por regras (`heuristic-extractor.ts`): linhas com quantidade, unidade e descrição.
3. **Imagens e PDFs digitalizados desconhecidos não são lidos**: o resultado diz isso claramente, em vez de simular uma leitura.

O mock **não representa a qualidade de um modelo real**. Serve para demonstrar o fluxo e para tornar os testes reprodutíveis.

## Transcrição de áudio

```dotenv
TRANSCRIPTION_PROVIDER=openai    # none (padrão) | openai | mock
OPENAI_API_KEY=sk-…
OPENAI_TRANSCRIPTION_MODEL=gpt-transcribe
```

Usada para áudios recebidos pelo WhatsApp. O áudio é transcrito e o texto segue para a extração. Com `none`, o áudio é armazenado e o revisor é avisado de que ele não foi transcrito.

## Privacidade

Com um provedor real, **o conteúdo dos documentos é enviado a ele**: texto, PDFs e imagens das solicitações, que podem conter nomes, CNPJ/CPF, telefones e e-mails de clientes. Antes de ativar:

- confira os termos de uso e de retenção de dados do provedor e, se aplicável, contrate a opção sem retenção;
- registre esse tratamento no inventário de dados da empresa (LGPD);
- nenhum dado do catálogo, de preços ou de outros clientes é enviado — apenas o documento em processamento.

## Trocar ou adicionar um provedor

Implemente a interface `AiProvider` (`src/modules/ai/types.ts`):

```ts
interface AiProvider {
  readonly name: string;
  readonly model: string;
  readonly capabilities: { images: boolean; pdf: boolean };
  extract(document: ExtractionDocument, context: ExtractionContext): Promise<AiExtraction>;
}
```

e registre-o em `src/modules/ai/index.ts`. Devolva sempre o resultado de `parseAiExtraction(...)` e lance `AiProviderError` indicando se a falha admite nova tentativa. O restante do sistema não muda.

## Limites conhecidos

- Os adaptadores da Anthropic e da OpenAI são testados com clientes simulados (`tests/unit/extraction.test.ts`); **nenhuma chamada real foi feita** durante a construção, por falta de credenciais. A primeira chamada pode exigir ajuste no nome do modelo ou em parâmetros.
- Documentos muito extensos são limitados em páginas e em tamanho antes do envio.
- Não há cache de extrações nem controle de custo por organização.
