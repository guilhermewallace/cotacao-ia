# Ambiente de demonstração

`npm run db:seed` cria duas empresas **fictícias** e tudo o que é preciso para percorrer o produto sem nenhum serviço externo. O seed pode ser executado quantas vezes for preciso: ele remove e recria apenas as organizações de demonstração, sem tocar em empresas reais.

> Tudo aqui é inventado: empresas, pessoas, CNPJs, contatos, fabricantes, produtos e preços. Os e-mails usam o domínio reservado `.example` e os telefones seguem o padrão `…9 0000-0XXX`. A interface mostra uma faixa "Ambiente de demonstração" em todas as telas dessas empresas.

## O que é criado

| | Elétrica Central (demonstração) | Volt Sul Distribuidora (demonstração) |
|---|---|---|
| Finalidade | Empresa principal do roteiro | Segunda empresa, para demonstrar o isolamento |
| Produtos | 185, em 12 categorias | 16 |
| Listas de preços | "Tabela Geral 2026" (padrão) e "Construtoras — Parceiros" | 1 |
| Clientes | 5 | — |
| Solicitações | 13 — 8 já cotadas ou em andamento (histórico) e 5 aguardando revisão | — |
| Cotações | 6 (5 finalizadas e 1 em rascunho) | — |
| Integrações | WhatsApp e e-mail **simulados** | — |

**Catálogo** (`src/demo/catalog.ts`): proteção (disjuntores, IDR, DPS), comando (contatores, relés, botões, sinaleiros), cabos, eletrodutos, canaletas, tomadas e interruptores, iluminação, automação (inversores, sensores, fontes, CLP), conexões, acessórios, quadros e aterramento. Cada produto tem código de fabricante, sinônimos e, em alguns casos, códigos equivalentes. Três produtos estão **sem preço**, para demonstrar que o sistema não inventa valores. Os fabricantes (Zentrik, Amperis, Kabrax, Tubovia, Lumivar, Induvia, Bornex, Tekvolt) não existem.

**Contas** — senha em `DEMO_PASSWORD` (`demo1234` no `.env.example`):

| E-mail | Papel |
|---|---|
| `ana.souza@eletricacentral.example` | Proprietária da Elétrica Central e Administradora da Volt Sul |
| `bruno.lima@eletricacentral.example` | Vendedor |
| `carla.mendes@eletricacentral.example` | Leitura |
| `diego.rocha@voltsul.example` | Proprietário da Volt Sul |

## Os seis cenários

As solicitações do seed passam pelo **pipeline de verdade** (armazenamento, extração, normalização e matching); só a IA é substituída pelo provedor mock. Os arquivos ficam em `demo/fixtures`.

| # | Cenário | Origem | O que observar |
|---|---|---|---|
| 1 | **Todos os produtos identificados** | Upload de `pedido-condominio-acacias.csv` (padrão do Excel brasileiro: `;` e Windows-1252) | 5 itens com sugestão forte, lidos sem IA, direto da planilha. No seed esta solicitação já aparece **cotada**; para revisar do zero, envie o arquivo de novo pela caixa de entrada |
| 2 | **Alguns produtos não encontrados** | Upload de `lista-materiais-serra-verde.xlsx` | 12 itens; chave fim de curso, válvula solenoide e manômetro não existem no catálogo e ficam "sem correspondência" — sem candidato "por aproximação". Um botão de emergência fica ambíguo entre dois modelos |
| 3 | **Especificações incompatíveis** | Mensagem de WhatsApp (simulada) | "Disjuntor tripolar 80A": o catálogo não tem 80 A — os de 63, 100 e 50 A aparecem como **descartados**, com a divergência de corrente. "Contator bobina 380V": só há 24 V e 220 V |
| 4 | **Documento pouco legível** | Foto de lista manuscrita, `lista-manuscrita-condominio.jpg` (WhatsApp simulado) | Selo "Documento pouco legível". Em "disj. bipolar 4_A" o segundo dígito está borrado: a corrente **não é preenchida** e o item fica ambíguo entre os disjuntores bipolares do catálogo. "fita isol." vem sem quantidade |
| 5 | **Múltiplos itens** | E-mail (simulado) com `pedido-cotacao-horizonte-azul.pdf` | 8 itens extraídos do PDF, dados do cliente lidos do documento, cliente reconhecido pelo e-mail do remetente e preços da lista "Construtoras — Parceiros" |
| 6 | **Informações incompletas** | E-mail (simulado) só com texto | "Cabo flexível 4mm", "Disjuntor bipolar", "Canaleta 30x30", "Fonte 24V": nenhum com quantidade; três ficam ambíguos por falta de especificação (cor, corrente, potência) e só a canaleta tem sugestão forte. A tela avisa para confirmar as quantidades com o cliente |

A foto manuscrita foi criada artificialmente para a demonstração. O provedor mock a reconhece pelo hash do arquivo e devolve uma leitura preparada (`src/demo/scenarios.ts`), como a que um modelo de visão produziria. **Outras imagens não são lidas pelo mock** — a tela informa isso, em vez de simular um resultado.

## Simular os canais

Com a aplicação e o worker no ar:

```bash
npm run demo:whatsapp                     # nova mensagem de WhatsApp (fictícia)
npm run demo:whatsapp -- --amostra wa-incompativel
npm run demo:whatsapp -- --texto "12 tomada 2P+T 10A branca"
npm run demo:email -- --anexo demo/fixtures/pedido-cotacao-horizonte-azul.pdf
npm run demo:email -- --duplicar          # demonstra a idempotência
```

Ou, pela interface: **Integrações › Simulador local de canais**.

O simulador monta a notificação no formato real do canal, assina com o segredo local e a envia ao webhook — o mesmo caminho de produção, sem tráfego externo. Nenhuma mensagem real é enviada ou recebida.

## Testar o isolamento

1. Entre como `ana.souza@eletricacentral.example`, abra uma solicitação e copie o endereço (`/solicitacoes/<id>`).
2. Saia e entre como `diego.rocha@voltsul.example`.
3. Cole o endereço: a resposta é "Página não encontrada" — a mesma de um ID que não existe.

Ana pertence às duas empresas: o seletor no topo da barra lateral troca a empresa ativa, e os dados nunca se misturam.

## Regerar os arquivos de exemplo

```bash
npm run fixtures:generate
```

Recria o PDF, a planilha e o CSV a partir de `src/demo/scenarios.ts`. A imagem manuscrita é um arquivo estático. Como o mock reconhece os documentos pelo hash, a resposta preparada do PDF só vale para o arquivo gerado por esse script.

## Usar com dados reais

O seed não é necessário em produção. Crie a empresa com:

```bash
npm run org:create -- --nome "Distribuidora Exemplo" --email dono@exemplo.com.br --usuario "Nome do Dono"
```

Depois, importe o catálogo em **Catálogo › Importar planilha** e configure as integrações. Não rode o seed em um banco de produção.
