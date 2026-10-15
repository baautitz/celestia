-- Concede system:workspaces:read a todo role que já tenha qualquer system:workspaces:*.
-- Idempotente e só ADD. Sem down: o drizzle não tem rollback e não há como distinguir
-- quem recebeu a chave por esta migration de quem a recebeu depois (remover à mão, se necessário).
UPDATE "roles"
SET "permissions" = "permissions" || '["system:workspaces:read"]'::jsonb
WHERE NOT ("permissions" @> '["system:workspaces:read"]'::jsonb)
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text("permissions") AS p(key)
    WHERE p.key LIKE 'system:workspaces:%'
  );
