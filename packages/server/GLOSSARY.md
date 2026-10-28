# Server

The API behind Celestia: identity and permissions, ERPs, and the closing periods that business work happens in.

## Language

### Closing

**Closing Period** (pt-BR: **Período de Fechamento**):
One contiguous range of dates of any length, from a start date to an end date inclusive, in which a closing is carried out. A date belongs to at most one Closing Period that is not cancelled.
_Avoid_: Workspace, Área de Trabalho, session, period

**Cancel** (a Closing Period):
Remove a Closing Period so its dates become free for another one. It is the only way to release dates; an open or closed Closing Period always holds them.
_Avoid_: Delete, reopen

**Close** (a Closing Period):
Mark a Closing Period as finished. A closed Closing Period still holds its dates and its range cannot be edited.
_Avoid_: Conclude, finish

**Reopen** (a Closing Period):
Return a closed Closing Period to open, so its range can be edited or it can be cancelled.
_Avoid_: Unclose, undo

**Open** / **Closed**:
The two states of a Closing Period. An open Closing Period can have its range edited and be cancelled.
_Avoid_: Concluded, concluído, active

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

**Colaborador** (en: Collaborator):
A person who makes sales in an ERP, identified by the `codigoColaborador` External. It is not the same as a User, who signs in to Celestia. In sales reports, a sale is attributed to the Colaborador of each item.
_Avoid_: Vendedor, Funcionário, Seller

### Access

**User** (pt-BR: **Usuário**):
A person who signs in to Celestia with a username and password. It is not the same as a person's own account inside an ERP, which Externals link to it.
_Avoid_: Account, member, ERP user

**Role** (pt-BR: **Perfil**):
A named group of Permissions assigned to users. A user has exactly one Role.
_Avoid_: Perfil de Acesso, group, profile

**Deactivate** (a User):
Stop a User from signing in while keeping the User. A deactivated User is not removed.
_Avoid_: Delete, remove, block

**Permission**:
A key that authorizes one action, written `<module>:<resource>:<verb>`.
_Avoid_: Privilege, right, scope

**Administrator**:
A user with full access who bypasses the Permission matrix and is granted every valid Permission. It is a flag on the user, not a Role.
_Avoid_: Super user, root, admin role

### Audit

**Audit Log**:
The single record of what happened across the whole system, shared by the Base System and every Plugin.
_Avoid_: History, event log, trail

**Log Entry**:
One record in the Audit Log: who did what, when. Each Log Entry has attributes that the Plugin writing it defines, so the Audit Log needs no fixed set of fields. A Log Entry stays readable after its Plugin is removed from the build, and its author stays identifiable after the User is deactivated.
_Avoid_: Event, row, audit record
