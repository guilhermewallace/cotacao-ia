# Página pública (landing)

A raiz do site (`/`) é a página de apresentação do produto. Quem não tem sessão vê a página; quem já entrou é levado direto ao `/dashboard`.

Ela é um **documento HTML independente do painel**: não usa React nem Tailwind e não lê sessão, banco ou dados de empresas. Por isso é servida por uma rota (`src/app/route.ts`), e não por uma página do Next.js — os estilos dela e os do app nunca se misturam.

## Onde fica cada coisa

| Arquivo | O que é |
|---|---|
| `src/modules/landing/page.html` | Modelo da página (texto e estrutura). Editável direto; em desenvolvimento, é relido a cada requisição. |
| `public/landing/site.css`, `site.js` | Estilo e comportamento, escritos à mão. São servidos como estão. |
| `public/landing/fonts/` | Fontes servidas pelo próprio site (SIL Open Font License 1.1; textos em `OFL-*.txt`). |
| `public/landing/engine.js` | Motor das demonstrações. **Gerado** — não edite. |
| `src/modules/landing/browser/engine.ts` | Código-fonte do motor. |
| `src/modules/landing/render.ts`, `whatsapp.ts` | Montagem do modelo e link de contato. |
| `scripts/build-landing.ts` | Gera o `engine.js` (`npm run landing:build`). |

## Botões de contato (WhatsApp)

Os botões de ação — menu, topo e fechamento — abrem uma conversa no WhatsApp com o número definido em `LANDING_WHATSAPP_NUMBER`:

```dotenv
# DDI + DDD + número. Sem DDI, o sistema assume Brasil (55).
LANDING_WHATSAPP_NUMBER=5511999999999
# Opcional: mensagem que já vem escrita na conversa.
LANDING_WHATSAPP_MESSAGE=Olá! Vi a página do Cotação IA e quero saber mais.
```

É o link oficial de conversa (`https://wa.me/<número>?text=<mensagem>`): quem clica é levado ao próprio WhatsApp e decide se envia. O sistema não envia nada, e isso não tem relação com a integração da WhatsApp Business Cloud API usada para receber pedidos.

Sem `LANDING_WHATSAPP_NUMBER`, os botões levam às demonstrações da própria página. O link discreto **Entrar**, no menu, leva ao `/login`.

No modelo, as duas variantes ficam em blocos — `<!--@wa-->…<!--@/wa-->` e `<!--@demo-->…<!--@/demo-->` —, e os valores entram como `{{WHATSAPP_URL}}` e `{{LOGIN_URL}}`, sempre escapados. Marcador desconhecido ou sem par faz a montagem falhar; nesse caso a rota registra o erro e redireciona para o `/login`, para que a página pública nunca impeça o acesso ao sistema.

## Demonstrações: o mesmo código do produto

A leitura de itens, a comparação de atributos técnicos e a pontuação de candidatos que rodam na página são **os módulos puros do produto** (`modules/normalization`, `modules/matching/scoring`, `modules/extraction/normalize-item`, o extrator por regras), empacotados para o navegador junto com o catálogo fictício de `src/demo/catalog.ts`. Só a recuperação muda: em vez do PostgreSQL, uma busca em memória com os mesmos sinais (código exato, termos em comum, trigramas, sinônimos).

Consequências práticas:

- **Mudou uma regra de leitura ou de correspondência? Rode `npm run landing:build`.** O teste `tests/unit/landing.test.ts` compara o `engine.js` versionado com um empacotamento novo e falha se ele ficou para trás.
- O motor só pode importar módulos próprios, sem pacotes e sem APIs do Node. O script recusa o contrário e também um pacote acima de 90 KB. Foi por isso que a validação de valores em `modules/normalization/attributes.ts` e o `emptyExtraction` deixaram de depender do Zod.
- Na página, fotos e PDFs são lidos por regras, no navegador; no produto, por IA. O texto da página diz isso. Nada do que o visitante digita sai do navegador.

## Segurança

- A página recebe uma política de conteúdo própria, mais restrita que a do painel (`next.config.ts`, regra para `/`): só arquivos do próprio site, nenhum script embutido, nenhuma chamada de rede (`connect-src 'none'`).
- `'unsafe-inline'` vale apenas para estilos, por causa dos atributos `style` que o `site.js` escreve (larguras de barras e posições do seletor).
- O proxy (`src/proxy.ts`) trata `/` e `/landing/*` como públicos. Todo o resto continua exigindo sessão, e a autorização de verdade segue nos serviços.
- Empresas, pessoas, fabricantes, códigos e preços mostrados são fictícios, e a página diz isso.

## Versão estática (GitHub Pages)

`npm run pages:build` gera `dist/pages/` com a mesma página, montada pelo mesmo `renderLandingPage`, mas com caminhos relativos, sem o link **Entrar** (não há servidor) e com a política de conteúdo numa `<meta>`. O workflow `.github/workflows/pages.yml` publica essa pasta a cada push na `main` que mexa na página. Para ligar os botões de WhatsApp, defina as *variables* `LANDING_WHATSAPP_NUMBER` e `LANDING_WHATSAPP_MESSAGE` do repositório.
