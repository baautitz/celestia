-- O Gestor inicial passa a gerir Dispositivos. Acrescenta só as chaves que faltam, sem mexer nas outras.
UPDATE "iam"."roles"
SET "permissions" = "permissions" || (
	SELECT COALESCE(jsonb_agg(key), '[]'::jsonb)
	FROM jsonb_array_elements_text('["system:devices:read","system:devices:create","system:devices:revoke"]'::jsonb) AS key
	WHERE NOT ("permissions" ? key)
)
WHERE "id" = 'gestor';
