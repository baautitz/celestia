# Dispositivos e certificados

Acesso por **Device** (Dispositivo): o Celestia emite um certificado de cliente por computador ou celular e só deixa entrar quem o apresenta, salvo quem tem a opção **Acesso sem certificado** (ver [Server Glossary](../../packages/server/GLOSSARY.md)).

## Como funciona

- O servidor Node termina o TLS e valida o certificado de cliente contra a CA do Celestia (`requestCert: true`, `rejectUnauthorized: false`). Não depende de proxy nem de header: o fingerprint vem do socket TLS, nunca de um header da requisição.
- Quem não tem certificado instalado conecta normalmente e não vê seletor no navegador. A negação é da aplicação: só quem exige certificado é recusado.
- O certificado é conferido **no login**. O refresh não o pede de novo: o refresh token guarda o Dispositivo, e a renovação é recusada se ele foi revogado (o cliente web faz logout). Sessões caem em até 5 minutos, a janela do Access Token.
- Mudar a opção **Acesso sem certificado** de um Usuário encerra as sessões dele. Só administradores a alteram.

## Configuração

| Variável | Para quê |
| --- | --- |
| `TLS_CERT_FILE`, `TLS_KEY_FILE` | Certificado público do site (ex.: Let's Encrypt). Recarregado sem reiniciar quando os arquivos mudam. |
| `DEVICE_CA_CERT_FILE`, `DEVICE_CA_KEY_FILE` | CA que emite e valida os certificados dos Dispositivos. |

Em produção as quatro são obrigatórias e o servidor não sobe sem elas (falha fechada). Fora de produção, sem nenhuma, o servidor responde em HTTP puro e ninguém apresenta certificado; um grupo pela metade é erro.

Se houver proxy na frente, ele só pode repassar o TCP (L4/passthrough). Um proxy que termina o TLS perde o certificado do cliente.

## Criar a CA (uma vez por instância)

```bash
pnpm create-ca            # usa DEVICE_CA_CERT_FILE e DEVICE_CA_KEY_FILE; --name "Nome da CA"
```

- A CA vale 20 anos. A chave fica só para o dono (`0600`), fora do banco e do repositório. **Faça backup**: sem ela é preciso reemitir todos os Dispositivos.
- O comando recusa sobrescrever uma CA existente.

## Emitir e revogar

- Emissão em `POST /api/iam/devices` (`system:devices:create`): devolve o `.pfx` (base64) e a senha **uma única vez**. O Celestia não guarda a chave privada nem o arquivo; arquivo perdido = revogar e emitir outro.
- Revogação em `POST /api/iam/devices/:id/revoke` (`system:devices:revoke`): definitiva. Não há CRL: o servidor consulta o Dispositivo no banco.
- Certificado de Dispositivo: 10 anos, sem renovação. O único cancelamento é a revogação.
- Emissão, revogação, login negado por falta de certificado e mudança da opção ficam no Audit Log (plugin `iam`); a senha e o `.pfx` nunca entram.

## Instalação do `.pfx`

Windows e macOS: duplo clique (importar como **não exportável**). Android: Segurança > Certificado de VPN e apps. iOS: baixar o arquivo e instalar em Ajustes > Perfil baixado, digitando a senha.

> A cifra do `.pfx` (AES-256, MAC SHA-256) foi verificada com o OpenSSL 3.5. Ainda precisa ser conferida num aparelho real de cada sistema (em especial iOS e macOS). Se algum recusar, o recuo é para 3DES/SHA-1.
