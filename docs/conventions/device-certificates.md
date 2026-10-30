# Dispositivos e certificados

Acesso por **Device** (Dispositivo): o Celestia emite um certificado de cliente por computador ou celular e só deixa entrar quem o apresenta, salvo quem tem a opção **Acesso sem certificado** (ver os glossários do [Server](../../packages/server/GLOSSARY.md) e da [Autoridade Certificadora](../../services/ca/GLOSSARY.md)). É o mesmo mecanismo do login com certificado do gov.br: o navegador mostra a janela "selecionar certificado". A decisão de manter a CA num serviço à parte está no [ADR 0006](../adr/0006-autoridade-certificadora-como-servico-separado.md).

## Como funciona

A **autoridade certificadora** (CA, `services/ca`) é um processo à parte, no mesmo repositório. Ela é dona da chave da CA, da tabela de Dispositivos (`ca.devices`) e da leitura do certificado. O Celestia (`packages/server`) guarda o Usuário e a opção **Acesso sem certificado**, e fala com a CA por HTTP usando uma **chave em comum** (`CA_SHARED_SECRET`, `Authorization: Bearer`, comparada em tempo constante).

O login tem dois passos:

1. **Senha**, em `POST /api/auth/login` (endereço normal do app). Se o Usuário tem a opção, entra só com ela. Senão o backend abre um **Desafio de Certificado** na CA e responde `{ certificateRequired: true, verifyUrl }`, sem tokens. Senha errada continua em `401 Credenciais inválidas.`, sem revelar a exigência.
2. **Certificado**. O SPA leva o navegador a `verifyUrl` (`https://acesso.<domínio>/verify?challenge=...`), o único endereço com mTLS: é aí, e só aí, que o navegador mostra a janela do certificado. A CA lê o certificado e **sempre** devolve o navegador ao callback fixo (`APP_CALLBACK_URL`, nunca vindo da URL): com `challenge` e `code` (de uso único, 60 s) se achou um Dispositivo ativo, só com `challenge` se não. A página `/login/certificado` do SPA chama `POST /api/auth/login/certificate`, o backend troca o desafio e o código com a CA (servidor para servidor) e abre a sessão. Sem Dispositivo ativo: `403 Dispositivo não autorizado.`, a mesma mensagem para qualquer motivo, e `deny_login_without_certificate` no Audit Log.

- O desafio vive 5 minutos, em memória na CA (limitado), e **qualquer tentativa de troca o consome**: errar o código dá uma chance só. O fingerprint do certificado nunca viaja na URL.
- O refresh **não** pede o certificado de novo: o refresh token guarda o Dispositivo, e a renovação consulta a CA e é recusada (401) se ele foi revogado; o cliente web faz logout (`ApiClient.onSessionExpired`). Sessões caem em até 5 minutos, a janela do Access Token.
- **CA fora do ar**: quem exige certificado falha fechado (login e refresh respondem 503 com mensagem clara); quem tem a isenção não chama a CA e não é afetado.
- Mudar a opção **Acesso sem certificado** de um Usuário encerra as sessões dele, e só administradores a alteram.

## Variáveis de ambiente

| Quem | Variável | Para quê |
| --- | --- | --- |
| backend e CA | `CA_SHARED_SECRET` | Chave em comum (mín. 32 caracteres). Obrigatória nos dois, em qualquer ambiente. |
| backend | `CA_URL` | Endereço interno da CA. Obrigatório em produção; em dev, `http://localhost:3001`. |
| CA | `CA_PORT` | Porta (padrão 3001). |
| CA | `CA_PUBLIC_URL` | Endereço público da CA, com mTLS (`https://acesso.<domínio>`). Obrigatório em produção. |
| CA | `APP_CALLBACK_URL` | Callback do app (`https://app.<domínio>/login/certificado`). Obrigatório em produção; em dev, `http://localhost:5173/login/certificado`. |
| CA | `CA_CERT_SOURCE` | `header` (produção) ou `mock` (só desenvolvimento). |
| CA | `CA_PROXY_SECRET` | Fonte `header`: segredo (mín. 32 caracteres) que o Traefik acrescenta; sem ele o certificado repassado é ignorado. |
| CA | `CA_CERT_HEADER`, `CA_PROXY_SECRET_HEADER` | Opcionais: nomes dos headers (padrão `x-forwarded-tls-client-cert` e `x-celestia-proxy-secret`). |
| CA | `CA_MOCK_DEVICE` | Fonte `mock`: nome de um Dispositivo ativo a simular; sem ele, ninguém apresenta certificado. |
| CA | `DEVICE_CA_CERT_FILE`, `DEVICE_CA_KEY_FILE` | A CA que assina os Dispositivos (`pnpm create-ca`). Obrigatórios em produção; pela metade é erro em qualquer ambiente. |

Em produção a CA só sobe com `CA_CERT_SOURCE=header` e a configuração completa (falha fechada), e o backend só sobe com a chave em comum e `CA_URL`. `mock` é recusado em produção.

## Produção com Traefik (fonte `header`)

O Traefik termina o TLS com o certificado do Let's Encrypt, **exige o certificado de cliente assinado pela CA do Celestia** e o repassa à CA. A CA só confia no header junto do segredo do proxy. A CA e o app ficam sem porta publicada: só o Traefik os alcança, pela rede interna, e **só `/verify` da CA é exposto**; a API da CA (`/devices`, `/challenges`) é interna, usada só pelo backend.

Use um endereço próprio para a leitura do certificado (`acesso.<domínio>`), com a nuvem da Cloudflare **desligada** (só DNS): a Cloudflare, quando faz proxy, termina o TLS e o certificado não chega ao servidor. O mTLS da Cloudflare com a **sua** CA é só do plano Enterprise. O app (`app.<domínio>`) não pede certificado e pode continuar atrás da Cloudflare. Como é só esse endereço que exige certificado, quem não tem um recebe a mensagem do app depois da senha, e não um erro de SSL.

Configuração dinâmica do Traefik (arquivo, não labels: as opções de TLS só existem no arquivo). Use `dev/traefik/dynamic.yml` como modelo; os pontos que importam:

- `tls.options.default.clientAuth`: `caFiles` com **só o certificado público** da CA (`ca.crt`), e `clientAuthType: RequireAndVerifyClientCert` para o endereço `acesso.`. Sem certificado válido nem o handshake completa.
- `passTLSClientCert` com `pem: true`: repassa o certificado em `X-Forwarded-Tls-Client-Cert` (base64 do DER, em URL-encoding). O Traefik descarta o header se o cliente o mandar.
- `headers.customRequestHeaders` com `X-Celestia-Proxy-Secret` igual ao `CA_PROXY_SECRET` da CA. Sobrescreve o que o cliente mandar.
- Roteador ``Host(`acesso.<domínio>`) && Path(`/verify`)`` apontando para a CA.
- O Let's Encrypt continua no roteador, como no resto do Dokploy. Se usar uma porta separada (ex.: 8443) só para esse endereço, o firewall pode liberar a 443 apenas aos IPs da Cloudflare.

A CA sobe como mais um serviço ao lado do app e do Postgres: `pnpm --filter @platform/ca build` e `pnpm --filter @platform/ca start` (`node dist/main.js`), depois de `pnpm db:migrate`.

## Desenvolvimento

`pnpm dev` sobe o backend, a CA e o Vite juntos. No `.env`, `CA_SHARED_SECRET` é obrigatório.

**Dia a dia: simulado.** No `.env`:

```
CA_CERT_SOURCE=mock
CA_MOCK_DEVICE=Caixa 1     # nome de um Dispositivo ativo; sem ele, ninguém apresenta certificado
```

A CA trata toda leitura como vinda desse Dispositivo (e avisa no boot), sem Traefik nem janela do navegador. Quem exige certificado faz o fluxo completo (senha, ida à CA em `http://localhost:3001`, volta ao app), só que sem a janela. Emita o Dispositivo pela tela uma vez (entrando com o administrador, que tem a isenção). Trocar `CA_MOCK_DEVICE` por um nome inexistente mostra a negação.

**Testar o certificado de verdade, com a janela do Chrome.** `*.localhost` aponta para o próprio computador, então `acesso.localhost` funciona sem mexer em `/etc/hosts`. No `.env`:

```
CA_CERT_SOURCE=header
CA_PROXY_SECRET=<32+ caracteres>
CA_PUBLIC_URL=https://acesso.localhost:8443
DEVICE_CA_CERT_FILE=/caminho/ca.crt
DEVICE_CA_KEY_FILE=/caminho/ca.key
```

Depois: `pnpm create-ca` (uma vez), `docker compose up -d postgres`, `pnpm db:migrate`, `pnpm dev` e `pnpm dev:cert` (sobe o Traefik de `docker-compose.cert.yaml`, só Linux, pela rede do host). O app continua em `http://localhost:5173`. Emita um Dispositivo, instale o `.pfx` no navegador e entre com um Usuário que exige certificado: depois da senha o navegador vai a `https://acesso.localhost:8443/verify` (o certificado do site é o autoassinado do Traefik: aceite o aviso uma vez) e mostra a janela do certificado. No Chrome do Linux, instale o `.pfx` em Configurações > Privacidade e segurança > Segurança > Gerenciar certificados > Seus certificados > Importar. Para voltar ao dia a dia, troque para `mock`.

## Criar a CA (uma vez por instância)

```bash
pnpm create-ca            # usa DEVICE_CA_CERT_FILE e DEVICE_CA_KEY_FILE; --name "Nome da CA"
```

- A CA vale 20 anos. A chave fica só para o dono (`0600`), fora do banco e do repositório. **Faça backup**: sem ela é preciso reemitir todos os Dispositivos.
- O comando recusa sobrescrever uma CA existente. Só o `ca.crt` (público) vai para o Traefik; a `ca.key` fica onde a CA a lê.

## Emitir e revogar

- Pela tela **Dispositivos** (menu Administração & IAM), no painel do Celestia: "Novo Dispositivo" emite o certificado e mostra a senha uma única vez, com o download do `.pfx`; o botão de revogar pede confirmação. A opção **Permitir acesso sem certificado** fica no formulário de Usuário, visível só para administradores, e a lista de Usuários mostra a coluna **Acesso**. O painel nunca fala com a CA diretamente: o backend repassa o pedido com a chave em comum, mantendo as permissões `system:devices:*` e o Audit Log.
- Emissão em `POST /api/iam/devices` (`system:devices:create`): devolve o `.pfx` (base64) e a senha **uma única vez**. A CA não guarda a chave privada nem o arquivo, só o fingerprint (SHA-256 do DER) e os metadados; arquivo perdido = revogar e emitir outro.
- Revogação em `POST /api/iam/devices/:id/revoke` (`system:devices:revoke`): definitiva e idempotente. Não há CRL: a CA consulta o Dispositivo no banco dela.
- Certificado de Dispositivo: 10 anos, sem renovação. O único cancelamento é a revogação.
- Emissão, revogação, login por Dispositivo, login negado por falta de certificado e mudança da opção ficam no Audit Log (plugin `iam`); a senha e o `.pfx` nunca entram.

## Instalação do `.pfx`

Windows e macOS: duplo clique (importar como **não exportável**). Android: Segurança > Certificado de VPN e apps. iOS: baixar o arquivo e instalar em Ajustes > Perfil baixado, digitando a senha.

> A cifra do `.pfx` (AES-256, MAC SHA-256) foi verificada com o OpenSSL 3.5. Ainda precisa ser conferida num aparelho real de cada sistema (em especial iOS e macOS). Se algum recusar, o recuo é para 3DES/SHA-1.
