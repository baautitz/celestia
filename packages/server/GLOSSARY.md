# Server

The API behind Celestia: identity and permissions, ERP connections, and the closing periods that business work happens in.

## Language

### Closing

**Closing Period** (pt-BR: **Período de Fechamento**):
One contiguous range of dates of any length, from a start date to an end date inclusive, in which a closing is carried out. A date belongs to at most one Closing Period that is not cancelled.
_Avoid_: Workspace, Área de Trabalho, session, period

**Cancel** (a Closing Period):
Remove a Closing Period so its dates become free for another one. It is the only way to release dates; an open or concluded Closing Period always holds them.
_Avoid_: Delete, reopen

### ERPs

**ERP**:
A customer's management system that Celestia reads from, registered with a name, an ERP Driver and credentials.
_Avoid_: Connection, source, conexão

**ERP Driver**:
The technology Celestia uses to query an ERP, such as SQL Server.
_Avoid_: ERP type, connector type

**Externals**:
The values that map a user to an ERP's own concepts, such as the user's ID, company or region in that ERP. A user has a set of Externals per ERP. The fields are declared by the module that integrates that ERP, not fixed by the platform.
_Avoid_: External IDs, mapping, identifiers
