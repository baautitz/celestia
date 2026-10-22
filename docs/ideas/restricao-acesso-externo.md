# Ideia: restringir login de usuários à rede/dispositivos da farmácia

> Status: ideia, NÃO implementado. Decisão pendente.

## Requisito

- Cliente quer acesso de qualquer lugar do mundo para alguns usuários.
- Outros usuários só podem logar nos dispositivos/rede da farmácia.
- Flag por usuário (`allowExternalAccess`): se permitido, loga de qualquer lugar; senão, só da farmácia.
- Deve funcionar de forma transparente em PC e móvel.

## Restrições

- Sem IP fixo; a operadora usa CGNAT (IP público compartilhado e mutável).
- Roteador provavelmente fechado da Vivo (sem DNS override).
- VPN descartada: prende o usuário a um dispositivo ou exige configurar vários.

## Opções avaliadas

| # | Opção | Prova | Funciona com CGNAT | Hardware | Observação |
|---|-------|-------|--------------------|----------|------------|
| 0 | Heartbeat de IP (servidor aprende o IP da farmácia) | IP | Não | Não | Descartada: IP compartilhado/mutável, fraca |
| 1 | Certificado no roteador | - | - | - | Inviável: cert de cliente é apresentado pelo dispositivo, não pela rede |
| 2 | Proxy local na farmácia + DNS dividido, header assinado | Rede | Sim | Caixa + roteador próprio | Mais robusta; exige DNS override (roteador Vivo fechado não permite) |
| 3 | Token de presença na LAN (`gate.cliente.com` -> IP privado) | Rede | Sim | Caixa | Frágil: DNS rebinding do roteador, prompt de acesso à rede local do Chrome. Testar na rede real |
| 4 | **mTLS com CA privada, cert por dispositivo** | Dispositivo | Sim | Nenhum | Mais simples; não prova "está na farmácia" |

## Opção 4 (mTLS) — desenho

1. CA própria (`openssl` ou `step-ca`), chave guardada com segurança.
2. Um certificado de cliente `.p12` (com senha) por dispositivo da farmácia.
3. Reverse proxy (Caddy/nginx) valida o cert contra a CA e repassa ao Hono `X-Client-Cert-Fingerprint`. O proxy remove o header se vier de fora; o Hono só confia no header vindo do proxy.
4. Regra: `allowExternalAccess = false` só loga e dá refresh com fingerprint ativo no banco.
5. Revogação = desativar o dispositivo na tabela (por fingerprint/serial), sem CRL.
6. Dois hostnames para o mesmo app: `app.cliente.com` (sem cert) e `farmacia.cliente.com` (`client_auth` obrigatório). Usuários externos nunca veem prompt de cert.

### Instalação nos clientes

- Windows/macOS: duplo clique no `.p12` (importar como **não exportável**). Firefox tem repositório próprio.
- Android: Segurança > "Certificado de VPN e apps"; exige bloqueio de tela.
- iOS: instala via perfil; Safari apresenta o cert. Chrome iOS: verificar na documentação.

### Pontos de atenção

- Trate o `.p12` como senha: se for copiado, vale em qualquer máquina.
- SPA e API sob o mesmo hostname, senão o navegador pede o cert de novo/falha cross-origin.
- Prova **dispositivo**, não **local**: notebook levado para casa continua logando. Se o requisito for "só dentro da farmácia", usar a opção 2 (ou 3).
- Revalidar também no `refresh` (refresh token dura 7 dias).

## Implementação no Celestia (quando decidido)

- `users.allow_external_access` (boolean) + toggle em IAMUsers.
- Tabela de dispositivos (fingerprint, serial, nome, ativo, criado em).
- Verificação do header no login e no refresh (`iam/middleware.ts`).
- Proxy e CA ficam fora do repositório (infra).
- Seguir AGENTS.md: migration nomeada, permissão `system:*` para gerir dispositivos, commits one-line com aprovação.
