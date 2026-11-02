# Apuração de Metas congelada no fechamento do Período

Enquanto um Período de Fechamento está aberto, a Apuração das Metas (Realizado, Atingimento e Prêmio) é recalculada a partir do ERP a cada consulta. Quando o Período é fechado, o Plugin InovaFarma grava o resultado, reagindo ao evento de fechamento do Módulo `closing_period`. Ao reabrir, volta a recalcular. A alternativa era calcular sempre ao vivo, que é mais simples. Foi descartada porque o ERP aceita alterações retroativas em vendas, e um Prêmio que já foi fechado e pago não pode mudar depois sem ninguém ver.

## Consequences

- Alterar um Tipo de Meta afeta só as Metas dos Períodos abertos. Os fechados mantêm o que foi gravado.
