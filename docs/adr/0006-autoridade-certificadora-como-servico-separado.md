---
status: accepted
---

# A autoridade certificadora é um serviço separado, dono dos Dispositivos

O acesso por Dispositivo (certificado de cliente, como o login do gov.br) usa uma CA própria. Ela vive em `services/ca`, um processo à parte no mesmo repositório, e é a única que tem a chave da CA, a tabela de Dispositivos (schema `ca`) e a leitura do certificado. O Celestia fala com ela por HTTP com uma chave em comum, e o navegador só chega em `GET /verify`.

O login fica em dois passos: a senha é conferida no Celestia; só quem exige certificado é levado à CA (`acesso.<domínio>`, com mTLS no Traefik), que lê o certificado e devolve o navegador ao app por um callback fixo com um código de uso único. O Celestia troca o código com a CA, servidor para servidor, e abre a sessão.

Isso foi decidido porque o certificado do cliente só chega a quem termina o TLS, e o Traefik do Dokploy (atrás da Cloudflare) é quem o termina. Separar a CA mantém o mTLS num único endereço, tira a chave da CA do processo que atende os usuários e deixa o resto do sistema sem saber de cabeçalhos nem de TLS.

## Alternativas descartadas

- **Node termina o mTLS (socket)**: incompatível com Traefik e Cloudflare, que terminam o TLS antes do app.
- **Traefik repassa o certificado direto ao backend (header)**: funcionava, mas exigia mTLS no endereço inteiro do app (quem não tem o certificado via um erro de SSL, não a tela de login) e deixava a chave da CA no processo principal.
- **Cloudflare mTLS**: com a CA própria só existe no plano Enterprise, e o plano Free só entrega o hash do certificado.
- **CA dentro do mesmo processo, só em outro módulo**: não separa a chave nem o endereço com mTLS.

## Consequências

- Os desafios de login ficam em memória (`ChallengeStore`), então a CA roda em **uma única instância**: com várias réplicas o desafio aberto numa não existe na outra. Reiniciar a CA no meio de um login só obriga o usuário a tentar de novo. Escalar para mais de uma instância exige mover os desafios para um armazenamento compartilhado.
- `GET /devices` devolve todos os Dispositivos, sem paginação: a lista é limitada na prática pelo número de aparelhos de uma instância (uma por cliente) e a emissão exige uma ação manual de administrador.
- A emissão grava o Dispositivo depois de gerar o certificado; se a gravação falha, o `.pfx` nunca é devolvido, então um certificado órfão não vale nada (o login só aceita fingerprint cadastrado e ativo).
