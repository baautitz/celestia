# Dispositivos e certificados

Acesso por **Device** (Dispositivo): o Celestia emite um certificado de cliente por computador ou celular e só deixa entrar quem o apresenta, salvo quem tem a opção **Acesso sem certificado** (ver [Server Glossary](../../packages/server/GLOSSARY.md)). É o mesmo mecanismo do login com certificado do gov.br: o navegador mostra a janela "selecionar certificado".

## Como funciona

- Quem **termina o TLS** é quem vê o certificado do cliente. O Node nunca termina TLS: ele fica atrás de um proxy (o Traefik do Dokploy), que valida o certificado contra a CA do Celestia e o repassa em um header. O app calcula o fingerprint (SHA-256 do DER) e consulta a tabela de Dispositivos. Há duas **fontes** do certificado (`CLIENT_CERT_SOURCE`): `header` (produção) e `mock` (desenvolvimento).
- O certificado é conferido **no login**. O refresh não o pede de novo: o refresh token guarda o Dispositivo, e a renovação é recusada se ele foi revogado (o cliente web faz logout). Sessões caem em até 5 minutos, a janela do Access Token.
- Quem exige certificado e não o apresenta é negado pela aplicação (403), com a mesma mensagem para qualquer motivo. Mudar a opção **Acesso sem certificado** de um Usuário encerra as sessões dele, e só administradores a alteram.

## Fontes do certificado (`CLIENT_CERT_SOURCE`)

| Fonte | Variáveis | Uso |
| --- | --- | --- |
| `header` | `PROXY_SHARED_SECRET` (mín. 32 caracteres), `DEVICE_CA_CERT_FILE`, `DEVICE_CA_KEY_FILE` | **Produção atrás do Traefik do Dokploy.** O proxy valida a cadeia e repassa o certificado. |
| `mock` | `DEV_CLIENT_CERT_DEVICE` (opcional) | **Só desenvolvimento.** Recusado em produção. |

Em produção `CLIENT_CERT_SOURCE=header` é obrigatório e o servidor não sobe sem a configuração completa (falha fechada). Fora de produção, sem nenhuma configuração, ninguém apresenta certificado (só entra quem tem o acesso sem certificado). Configuração pela metade é erro em qualquer ambiente. Opcionais da fonte `header`: `CLIENT_CERT_HEADER` (padrão `x-forwarded-tls-client-cert`) e `PROXY_SECRET_HEADER` (padrão `x-celestia-proxy-secret`).

### Produção com Traefik (fonte `header`)

O Traefik termina o TLS com o certificado do Let's Encrypt (o Node não tem certificado de site), **exige o certificado de cliente assinado pela CA do Celestia** e repassa o certificado ao app. O app só confia no header junto do segredo do proxy, e fica sem porta publicada: só o Traefik o alcança, pela rede interna.

Use um endereço próprio para o login por certificado (como o gov.br), com a nuvem da Cloudflare **desligada** (só DNS): a Cloudflare, quando faz proxy, termina o TLS e o certificado não chega ao servidor. O mTLS da Cloudflare com a **sua** CA é só do plano Enterprise. O endereço sem certificado (para quem tem a opção ligada) pode continuar atrás da Cloudflare.

Configuração dinâmica do Traefik (arquivo, não labels: as opções de TLS só existem no arquivo). Use `dev/traefik/dynamic.yml` como modelo; os pontos que importam:

- `tls.options.default.clientAuth`: `caFiles` com **só o certificado público** da CA (`ca.crt`), e `clientAuthType: RequireAndVerifyClientCert` no endereço exclusivo de certificado. Sem certificado válido nem o handshake completa, então um scanner não chega ao app.
- `passTLSClientCert` com `pem: true`: repassa o certificado em `X-Forwarded-Tls-Client-Cert` (base64 do DER, em URL-encoding). O Traefik descarta o header se o cliente o mandar.
- `headers.customRequestHeaders` com `X-Celestia-Proxy-Secret` igual ao `PROXY_SHARED_SECRET` do app. Sobrescreve o que o cliente mandar.
- O Let's Encrypt continua no roteador, como no resto do Dokploy. Se usar uma porta separada (ex.: 8443) só para esse endereço, o firewall pode liberar a 443 apenas aos IPs da Cloudflare.

Verificado com o Traefik v3.1 de verdade: certificado válido entra; sem certificado e com certificado de outra CA a conexão cai no handshake; header e segredo forjados são sobrescritos; falar direto com o app, com o certificado no header mas sem o segredo, dá 403.

### Desenvolvimento

**Dia a dia: simulado.** No `.env`:

```
CLIENT_CERT_SOURCE=mock
DEV_CLIENT_CERT_DEVICE=Caixa 1     # nome de um Dispositivo ativo; sem ele, ninguém apresenta certificado
```

Toda requisição vale como vinda desse Dispositivo (o servidor avisa no boot). Emita o Dispositivo pela tela uma vez e desenvolva normalmente pelo Vite. Trocar `DEV_CLIENT_CERT_DEVICE` por um nome inexistente (ou removê-lo) mostra a negação.

**Testar o certificado de verdade, com a janela do Chrome.** No `.env`:

```
CLIENT_CERT_SOURCE=header
PROXY_SHARED_SECRET=<32+ caracteres>
DEVICE_CA_CERT_FILE=/caminho/ca.crt
DEVICE_CA_KEY_FILE=/caminho/ca.key
```

Depois: `pnpm create-ca` (uma vez), `docker compose up -d postgres`, `pnpm dev:server`, `pnpm dev:web` e `pnpm dev:cert` (sobe o Traefik de `docker-compose.cert.yaml`, só Linux, pela rede do host). Emita um Dispositivo, instale o `.pfx` no navegador e abra `https://localhost:8443` (o certificado do site é o autoassinado do Traefik: aceite o aviso uma vez). Entre com um Usuário que exige certificado e escolha o certificado na janela. Para voltar ao dia a dia, troque para `mock`.

## Criar a CA (uma vez por instância)

```bash
pnpm create-ca            # usa DEVICE_CA_CERT_FILE e DEVICE_CA_KEY_FILE; --name "Nome da CA"
```

- A CA vale 20 anos. A chave fica só para o dono (`0600`), fora do banco e do repositório. **Faça backup**: sem ela é preciso reemitir todos os Dispositivos.
- O comando recusa sobrescrever uma CA existente. Só o `ca.crt` (público) vai para o Traefik; a `ca.key` fica onde o app a lê.

## Emitir e revogar

- Pela tela **Dispositivos** (menu Administração & IAM): "Novo Dispositivo" emite o certificado e mostra a senha uma única vez, com o download do `.pfx`; o botão de revogar pede confirmação. A opção **Permitir acesso sem certificado** fica no formulário de Usuário, visível só para administradores, e a lista de Usuários mostra a coluna **Acesso**.
- Se o servidor recusar renovar a sessão (ex.: Dispositivo revogado), o cliente web sai sozinho (`ApiClient.onSessionExpired`).
- Emissão em `POST /api/iam/devices` (`system:devices:create`): devolve o `.pfx` (base64) e a senha **uma única vez**. O Celestia não guarda a chave privada nem o arquivo; arquivo perdido = revogar e emitir outro.
- Revogação em `POST /api/iam/devices/:id/revoke` (`system:devices:revoke`): definitiva. Não há CRL: o servidor consulta o Dispositivo no banco.
- Certificado de Dispositivo: 10 anos, sem renovação. O único cancelamento é a revogação.
- Emissão, revogação, login por Dispositivo, login negado por falta de certificado e mudança da opção ficam no Audit Log (plugin `iam`); a senha e o `.pfx` nunca entram.

## Instalação do `.pfx`

Windows e macOS: duplo clique (importar como **não exportável**). Android: Segurança > Certificado de VPN e apps. iOS: baixar o arquivo e instalar em Ajustes > Perfil baixado, digitando a senha.

> A cifra do `.pfx` (AES-256, MAC SHA-256) foi verificada com o OpenSSL 3.5. Ainda precisa ser conferida num aparelho real de cada sistema (em especial iOS e macOS). Se algum recusar, o recuo é para 3DES/SHA-1.
