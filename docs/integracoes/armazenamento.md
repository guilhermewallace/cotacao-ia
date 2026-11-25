# Armazenamento de documentos

Os arquivos recebidos (anexos de upload, e-mail e WhatsApp) e as planilhas de importação ficam em **object storage privado**. Nenhum arquivo tem URL pública: cada acesso gera uma **URL temporária**, emitida somente depois de o servidor conferir a sessão, a permissão e a organização dona do arquivo.

## Opções

| `STORAGE_DRIVER` | Uso |
|---|---|
| `s3` | Qualquer storage compatível com S3: o RustFS do `docker-compose.yml` (local), AWS S3, Cloudflare R2, Supabase Storage (API S3) |
| `local` | Disco do servidor (`LOCAL_STORAGE_DIR`). Para desenvolvimento, testes e demonstração sem um storage S3 |

### S3

```dotenv
STORAGE_DRIVER=s3
S3_ENDPOINT=http://localhost:9000      # deixe vazio para a AWS S3
S3_PUBLIC_ENDPOINT=                    # endpoint visto pelo NAVEGADOR, quando diferente do interno
S3_REGION=us-east-1
S3_BUCKET=cotacao-ia
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
S3_FORCE_PATH_STYLE=true               # true para storages locais (RustFS e similares); false para a AWS S3
S3_AUTO_CREATE_BUCKET=false            # true apenas em desenvolvimento: cria o bucket que faltar
SIGNED_URL_TTL_SECONDS=300
```

- O **bucket deve ser privado** (sem política de leitura anônima). Um bucket recém-criado já nasce assim, na AWS e nos storages compatíveis; não acrescente política pública a ele.
- **Criação do bucket.** Com `S3_AUTO_CREATE_BUCKET=true` (o padrão do `.env.example`), cada processo confere o bucket antes da sua primeira gravação e o cria se faltar; o seed de demonstração faz o mesmo. Em produção, crie o bucket pela sua infraestrutura e deixe a opção desligada — a credencial da aplicação não precisa, nem deve, poder criar buckets.
- Use uma credencial restrita a esse bucket, com permissão apenas para ler, gravar e excluir objetos (na AWS: `s3:GetObject`, `s3:PutObject` e `s3:DeleteObject`).
- `S3_PUBLIC_ENDPOINT` existe para o caso em que a aplicação alcança o storage por um endereço interno (`http://storage:9000`) e o navegador por outro (`http://localhost:9000`): as URLs temporárias são assinadas para o endereço público.
- Na AWS S3 (sem `S3_ENDPOINT`), os objetos são gravados com criptografia no servidor (SSE-S3).
- Com `S3_ENDPOINT` definido, o SDK da AWS é configurado para enviar checksums só quando a operação exige. O padrão recente do SDK (CRC32 em toda requisição) nem sempre é aceito por storages compatíveis.
- Ative o versionamento e uma regra de ciclo de vida no bucket conforme a sua política de retenção — a exclusão feita pela aplicação remove o objeto, mas versões antigas dependem da configuração do bucket.

#### Storage local do Docker Compose

O serviço `storage` do `docker-compose.yml` é um [RustFS](https://docs.rustfs.com/installation/docker/) (licença Apache-2.0), em versão fixada:

- API S3 em `http://localhost:9000` e console web em `http://localhost:9001/rustfs/console/`;
- chaves locais `cotacaodev` / `cotacaodevsecret`, iguais no `docker-compose.yml` e no `.env.example` — servem apenas para desenvolvimento;
- portas publicadas só em `127.0.0.1`, justamente porque essas chaves são conhecidas;
- dados no volume `storage-data` (`docker compose down -v` apaga os arquivos).

O projeto não usa o MinIO porque as imagens `minio/minio` e `minio/mc` foram retiradas do Docker Hub. Para usar outro storage local, basta apontar as variáveis `S3_*` para ele.

### Disco local

```dotenv
STORAGE_DRIVER=local
LOCAL_STORAGE_DIR=.data/storage
```

As URLs temporárias apontam para `/api/files/<chave>?exp=…&sig=…`, assinadas com HMAC-SHA256 (`SESSION_SECRET`). A assinatura cobre a chave, a validade, o nome, o tipo e a forma de exibição — nenhum desses parâmetros pode ser adulterado. Com `STORAGE_DRIVER=s3`, essa rota responde 404.

Não use o disco local com mais de uma instância da aplicação nem em hospedagens com sistema de arquivos efêmero.

## Como os arquivos são tratados

- **Chave gerada pelo servidor**: `org/<organização>/inbound/<mensagem>/<anexo>.<extensão>`. O nome original nunca compõe o caminho; é higienizado e guardado no banco apenas para exibição e download.
- **Tipo definido pelo conteúdo**: a extensão e o `Content-Type` gravados vêm da inspeção do arquivo (assinatura binária), não do que o remetente declarou.
- **Exibição no navegador** apenas para PDF, PNG e JPEG. Qualquer outro tipo é entregue como download (`Content-Disposition: attachment`, `application/octet-stream`). No storage local, as respostas também levam `X-Content-Type-Options: nosniff`.
- **Acesso**: a tela usa `/api/attachments/<id>`, que valida a sessão e a posse do anexo e redireciona para a URL temporária. Downloads ficam registrados na auditoria.
- **Hash**: o SHA-256 de cada arquivo é gravado junto do anexo.
- **Exclusão**: pela política de retenção da organização (**Configurações › Empresa**) ou manualmente, por solicitação (**Excluir documentos originais**). O objeto é apagado do storage e o texto extraído é removido do banco; os itens e a cotação permanecem.

O código está em `src/modules/storage`. Para outro tipo de storage, implemente `StorageProvider` (`put`, `get`, `delete`, `exists`, `getSignedUrl`).

## Limites conhecidos

- O adaptador S3 foi exercitado contra um servidor S3 de teste local (gravação, leitura, exclusão, criação de bucket — inclusive sob demanda — e URL pré-assinada). **Não foi testado contra o RustFS do Docker Compose, a AWS S3 nem o R2**: o ambiente de construção não conseguia baixar imagens de contêiner. Esse servidor de teste não confere assinaturas nem aplica controle de acesso, então a recusa de acesso anônimo e de URLs adulteradas — que cabe ao storage — não pôde ser comprovada. Confira no seu ambiente: uma URL sem assinatura, ou com um parâmetro alterado, deve ser recusada.
- Os arquivos passam pela memória do servidor no upload (o limite por arquivo é `MAX_UPLOAD_MB`). Não há upload direto do navegador para o storage.
- Não há antivírus. Se a sua operação exigir, acrescente a verificação em `ingestInboundMessage`, antes da gravação.
