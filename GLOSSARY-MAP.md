# Glossary Map

## Contexts

- [Core](./packages/core/GLOSSARY.md): the module base that loads and connects everything else
- [Server](./packages/server/GLOSSARY.md): IAM, ERPs and Closing Periods (the Closing Period Plugin is already its own Module)
- [Certificate Authority](./services/ca/GLOSSARY.md): the separate service that issues, revokes and reads the certificates of Devices
- [UI](./packages/ui/GLOSSARY.md): the shared interface components used by the web app and Plugins

## Relationships

- **Server → Certificate Authority**: Server asks the Certificate Authority, with a shared key, to issue and revoke Devices and to settle each Certificate Challenge; it keeps the User and the Certificate Exemption.
- **Core → Server**: Server holds the code that will be split into Modules (IAM in the Base System; ERPs and closing periods as Plugins) loaded by Core.
