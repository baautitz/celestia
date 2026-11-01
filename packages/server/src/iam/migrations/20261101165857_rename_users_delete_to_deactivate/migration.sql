-- "Inativar/Excluir Usuários" vira só "Inativar Usuários": excluir passa a ser só de Administrador.
-- Quem tinha a chave antiga fica com a nova, sem repetir nem mexer nas outras.
UPDATE "iam"."roles"
SET "permissions" = (
	SELECT COALESCE(jsonb_agg(DISTINCT key), '[]'::jsonb)
	FROM jsonb_array_elements_text("permissions") AS t(original)
	CROSS JOIN LATERAL (SELECT CASE WHEN original = 'system:users:delete' THEN 'system:users:deactivate' ELSE original END AS key) AS k
)
WHERE "permissions" ? 'system:users:delete';
