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

### Menu

**Menu Section** (pt-BR: **Seção do Menu**):
A titled block of the side menu, declared once by a module with an `id`, a label and an `order`. Each menu entry points to a Section by `id`; Sections with no entry the user can access are hidden.
_Avoid_: Grupo, Group (Grupo is a Role)

### ERPs

**ERP**:
A customer's management system that Celestia reads from, registered with a name, an ERP Driver and credentials.
_Avoid_: Connection, source, conexão

**ERP Driver**:
The technology Celestia uses to query an ERP, such as SQL Server.
_Avoid_: ERP type, connector type

**Colaborador** (en: Collaborator):
A person registered as an employee in an ERP, who may have sales attributed to them, whether or not they have sold anything yet. It is not the same as a User, who signs in to Celestia. In sales reports, a sale is attributed to the Colaborador of each item.
_Avoid_: Vendedor, Funcionário, Seller

**Loja** (en: Store):
A branch of the business as registered in an ERP. A sale belongs to the Loja where it was made, which may differ from the Colaborador's Loja.
_Avoid_: Filial, Empresa, Branch

**Vínculo do Colaborador** (en: Collaborator Link):
The optional association of a Colaborador with one User and with the Lojas where they work, which can be more than one. Each part is independent of the other, and a User can be linked to at most one Colaborador.
_Avoid_: Mapping, External

**Pré-vencido** (en: Near-expiry Product):
A product, as registered in an ERP, whose expiry date is close enough that the business wants it sold before it is lost.
_Avoid_: Vencido, Próximo do vencimento

**Lançamento de Pré-vencido** (en: Near-expiry Entry):
A record made by a Colaborador, through their linked User, that they sold a quantity of a Pré-vencido with a given expiry date in a Loja, within an open Closing Period. The same product can be entered more than once.
_Avoid_: Pré-vendido, Registro

**Avaliação do Colaborador** (en: Collaborator Assessment):
A record made by a manager about a Colaborador of one of their Lojas, within a Closing Period, with a description and an amount to discount from the Colaborador, which may be zero. It keeps the Loja it was made in, even if the Colaborador later changes Loja. A Colaborador can be assessed without a Vínculo or a User. Their Lojas are only those confirmed in their Vínculo; a Colaborador with no Loja confirmed appears only under all Lojas, never under the Loja the ERP gives them. The Colaborador sees their own Avaliações only through their linked User.
_Avoid_: Advertência, Desconto, Ocorrência

**Ajuste de Estoque** (en: Stock Adjustment):
A movement registered in an ERP that changes the quantity of one or more products in a Loja, up (+) or down (−), outside of sales and purchases. Celestia only reads it.
_Avoid_: Acerto, Inventário, Movimentação

**Justificativa do Ajuste** (en: Adjustment Justification):
A record made in Celestia that explains one whole Ajuste de Estoque, with a Motivo and an optional note, within the Closing Period the Ajuste belongs to.
_Avoid_: Explicação, Comentário

**Motivo do Ajuste** (en: Adjustment Reason):
One of a list of reasons, kept by the customer, that classifies a Justificativa do Ajuste, such as breakage, expiry or counting error.
_Avoid_: Causa, Tipo

**Furo de Estoque** (en: Stock Shortfall):
The report that gathers the Ajustes de Estoque of a Closing Period with their Justificativas. The Ajustes without a Justificativa are what the business treats as the unexplained shortfall.
_Avoid_: Perda, Quebra

### Metas

**Indicador** (en: Indicator):
A measure that Celestia knows how to calculate for a Colaborador within a Closing Period, such as CMV %, Ticket Médio, Total Foco, sales with an identified customer, Pré-vencidos sold or the units sold of a Lista de Produtos. Indicadores come ready with the Plugin and are not created by the customer; each one knows whether higher or lower is better.
_Avoid_: Métrica, KPI

**Tipo de Meta** (en: Goal Type):
A reusable definition kept by the customer: which Indicador it measures, how the result is shown to the Colaborador, whether the Prêmio is shown to them, how the Prêmio is calculated, and optionally a default Alvo for new Participantes. An inactive Tipo de Meta can no longer be used in new Metas.
_Avoid_: Modelo, Campanha, Plano

**Meta** (en: Goal):
A Tipo de Meta applied to one Closing Period, with its Participantes and their Alvos. A Meta can only be changed while its Closing Period is open.
_Avoid_: Objetivo, Target

**Participante** (en: Participant):
A Colaborador taking part in a Meta. A Colaborador who is not a Participante of a Meta neither sees it nor earns from it.
_Avoid_: Elegível, Membro

**Alvo** (en: Target value):
The value a Participante must reach in the Indicador of a Meta. Each Participante has their own Alvo. A Tipo de Meta can have no Alvo, in which case it only pays a percentage of what was sold and is never Atingida or Não atingida.
_Avoid_: Cota

**Lista de Produtos** (en: Product List):
The products of a Meta, each with the number of units a Participante must sell. The Meta is Atingida when the Participante reaches the units of a minimum number of the products.
_Avoid_: Mix, Cesta

**Realizado** (en: Achieved value):
The value of a Meta's Indicador actually reached by a Participante in the Closing Period. For Pré-vencidos it counts only what the ERP confirms was sold, up to what was entered.
_Avoid_: Resultado, Atingido

**Atingimento** (en: Attainment):
How far a Participante got towards their Alvo, as a percentage. For an Indicador where lower is better, getting below the Alvo is above 100%.
_Avoid_: Progresso, Performance

**Exibição** (en: Display):
How a Meta's result is shown to the Participante: **Atingida / Não atingida**, only whether it was reached; **Progresso**, the Realizado, the Alvo and how much is left; or **Contagem**, how many products of a Lista de Produtos were reached. Managers always see the full numbers.
_Avoid_: Modo, Visualização (Visualização is a scope of access)

**Prêmio** (en: Reward):
The amount of money a Participante earns from a Meta in a Closing Period: a fixed amount when Atingida, an amount proportional to the Atingimento, an amount by Faixa, or a percentage of an amount sold.
_Avoid_: Comissão, Bônus, Premiação

**Gatilho** (en: Threshold):
The minimum Atingimento below which a Meta pays no Prêmio.
_Avoid_: Piso, Mínimo

**Teto** (en: Cap):
The maximum Atingimento a Prêmio proportional to the Atingimento takes into account.
_Avoid_: Limite

**Faixa** (en: Tier):
A range of Atingimento that pays one fixed Prêmio, such as 80% pays R$ 50 and 100% pays R$ 100.
_Avoid_: Régua, Degrau

**Apuração** (en: Calculation):
The calculation of the Realizado, Atingimento and Prêmio of every Participante of the Metas of a Closing Period.
_Avoid_: Cálculo, Fechamento

**Meta de Avaliações** (en: Assessment Goal):
A Meta in which each Participante starts the Closing Period with an amount of money and the discounts of their Avaliações in that Closing Period are taken from it, whatever Loja they were made in. Its Prêmio is the Saldo, and it is Atingida while the Saldo is above zero.
_Avoid_: Meta de conduta

**Saldo** (en: Balance):
What is left of a Meta de Avaliações after the discounts. It never goes below zero.
_Avoid_: Restante, Sobra

### Access

**User** (pt-BR: **Usuário**):
A person who signs in to Celestia with a username and password. It is not the same as a person's own account inside an ERP.
_Avoid_: Account, member, ERP user

**Role** (pt-BR: **Grupo**):
A named group of Permissions assigned to users. A user has exactly one Role.
_Avoid_: Perfil, Perfil de Acesso, profile

**Visualização** (en: View):
A scope in which a Plugin report can be seen, such as general, by Loja or individual. A Plugin declares each Visualização as a Permission, and the customer decides which Roles have it.
_Avoid_: Filtro, Modo

**Deactivate** (a User):
Stop a User from signing in while keeping the User. A deactivated User is not removed.
_Avoid_: Delete, remove, block

**Certificate Exemption** (pt-BR: **Acesso sem certificado**):
A flag on a User that lets them sign in without presenting a Device certificate (see the [Certificate Authority glossary](../../services/ca/GLOSSARY.md)). Without it, every User must present the certificate of an active Device.
_Avoid_: Bypass, whitelist

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
