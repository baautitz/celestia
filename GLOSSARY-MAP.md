# Glossary Map

## Contexts

- [Core](./packages/core/GLOSSARY.md): the module base that loads and connects everything else
- [Server](./packages/server/GLOSSARY.md): IAM, ERPs and Closing Periods (the Closing Period Plugin is already its own Module)

## Relationships

- **Core → Server**: Server holds the code that will be split into Modules (IAM in the Base System; ERPs and closing periods as Plugins) loaded by Core.
