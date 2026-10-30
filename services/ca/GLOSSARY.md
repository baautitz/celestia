# Certificate Authority

The service that approves Devices: it issues, revokes and reads the certificates they present, and answers the rest of Celestia through a key they share.

## Language

**Certificate Authority** (pt-BR: **Autoridade Certificadora**, short: **CA**):
The separate service, with its own key and its own Devices, that issues the certificate of every Device and tells Celestia which Device a browser presented. Celestia never holds the CA key.
_Avoid_: Certificadora de nota fiscal, ICP-Brasil, server certificate

**Device** (pt-BR: **Dispositivo**):
A computer or phone that Celestia approved, holding a certificate that the Certificate Authority issued for it. A Device belongs to the company, not to a User, so any User who requires a certificate can sign in from any active Device.
_Avoid_: Computador, Terminal, Máquina, Certificado (as the name of the Device)

**Revoke** (a Device):
Stop a Device from being accepted while keeping its record. A revoked Device cannot be reactivated; a new Device must be issued.
_Avoid_: Delete, remove, cancel

**Certificate Challenge** (pt-BR: **Desafio de Certificado**):
A short-lived, single-use step of a sign-in, opened after the password is right for a User who requires a certificate. The browser takes it to the Certificate Authority, which attaches the Device it read and hands back a one-time code that Celestia exchanges for that Device.
_Avoid_: Token, session, ticket

## Relationships

- A **Certificate Authority** issues many **Devices**; a **Device** is revoked at most once.
- A **Certificate Challenge** belongs to one **User** (a Celestia concept) and ends with at most one **Device**.
