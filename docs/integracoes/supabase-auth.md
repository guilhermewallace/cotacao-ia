# Autenticação com Supabase Auth

Em produção, a autenticação é feita pelo **Supabase Auth**. O provedor de demonstração (`AUTH_PROVIDER=demo`) existe apenas para rodar o projeto sem serviços externos e é recusado quando `NODE_ENV=production`.

O Supabase responde a uma única pergunta: **quem é a pessoa**. A autorização — a quais empresas ela pertence e com qual papel — é sempre decidida pelo banco do Cotação IA (`users` e `memberships`).

## Configuração

1. Crie um projeto em supabase.com.
2. Em *Project Settings › API*, copie a **Project URL** e a **publishable key** (em projetos antigos, a chave `anon`).
3. No `.env`:

```dotenv
AUTH_PROVIDER=supabase
SUPABASE_URL=https://<projeto>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
SESSION_SECRET=<openssl rand -base64 48>
```

4. Em *Authentication › Sign In / Providers*, mantenha **Email** habilitado e **exija confirmação de e-mail**.
5. Recomendado: desabilite o cadastro público (*Allow new users to sign up*). Mesmo que alguém se cadastre, sem vínculo com uma empresa só verá a tela "Sua conta ainda não tem acesso".

A chave *service role* **não é usada** e não deve ser configurada na aplicação.

## Como uma pessoa ganha acesso

1. Um administrador da empresa adiciona a pessoa em **Configurações › Membros** (nome, e-mail, papel). Isso cria o registro em `users` e em `memberships` — ainda sem vínculo com o Supabase.
   Para a primeira empresa, use `npm run org:create -- --nome "Empresa" --email dono@empresa.com.br --usuario "Nome"`.
2. A conta é criada no Supabase com o **mesmo e-mail** — pelo painel (*Authentication › Users › Add user* ou *Invite*) ou pelo fluxo de convite que você preferir.
3. No primeiro login, o sistema vincula a conta do Supabase ao usuário convidado **somente se o Supabase confirmar que o e-mail foi verificado**. Isso impede que alguém se aproprie do convite de outra pessoa cadastrando-se com o e-mail dela sem comprová-lo.
4. A partir daí, o vínculo é pelo ID do usuário no Supabase; trocar o e-mail no Supabase não muda o acesso.

Esta versão tem apenas a tela de login. Cadastro, convite por e-mail e recuperação de senha ficam por conta dos fluxos do próprio Supabase (por exemplo, o link de recuperação enviado pelo painel).

## Como funciona

- **Login no servidor**: o formulário envia e-mail e senha a uma Server Action, que chama `signInWithPassword` com `@supabase/ssr`. A sessão fica em cookies `httpOnly`.
- **Validação a cada requisição**: `getUser()` confere o token com o Supabase — o conteúdo do cookie, sozinho, não é considerado prova.
- **Renovação do token**: feita em `src/proxy.ts`, que pode gravar os cookies atualizados na resposta.
- **Empresa ativa**: guardada em um cookie de preferência. A cada requisição o servidor confere no banco se a pessoa é membro daquela empresa; se não for, usa a primeira empresa a que ela pertence.
- **Limite de tentativas** de login por IP e por conta (em memória, por instância). Complemente com a proteção contra abuso do Supabase (*Attack Protection*, CAPTCHA).
- **Mensagem única** para e-mail inexistente e senha incorreta.

O código está em `src/modules/identity/auth/supabase-provider.ts`, `src/modules/identity/users.ts` (`resolveUser`) e `src/server/session.ts`.

## Trocar de provedor de autenticação

`AuthProvider` (`src/modules/identity/auth/types.ts`) tem três métodos: `signIn`, `getIdentity` e `signOut`. Um provedor novo (Auth0, Keycloak, Entra ID) precisa apenas devolver uma identidade com e-mail, indicação de e-mail verificado e ID estável do usuário.

## Limites conhecidos

- Não foi testado contra um projeto Supabase real (não havia credenciais). O adaptador segue a documentação do `@supabase/ssr`.
- Sem autenticação em dois fatores na aplicação — configure o MFA no Supabase se necessário (o adaptador precisará tratar o desafio).
- Sem login social nem SSO corporativo.
- Encerrar a sessão de um usuário removido depende da validade do token do Supabase; a remoção do vínculo em **Membros**, porém, corta o acesso aos dados imediatamente.
