import { hashSync, verifySync, Algorithm } from "@node-rs/argon2";
import { z } from "zod";

/** Uma regra da política de senha: o rótulo curto para a tela, a mensagem do 400 e o padrão. */
export interface PasswordRule {
  label: string;
  message: string;
  pattern: RegExp;
}

/** Política de senha do IAM; a tela a lê em `GET /api/iam/password-policy`. */
export const PASSWORD_RULES: readonly PasswordRule[] = [
  { label: "8 caracteres", message: "A senha deve conter no mínimo 8 caracteres.", pattern: /^[\s\S]{8,}$/ },
  { label: "1 maiúscula", message: "A senha deve conter ao menos uma letra maiúscula.", pattern: /[A-Z]/ },
  { label: "1 minúscula", message: "A senha deve conter ao menos uma letra minúscula.", pattern: /[a-z]/ },
  { label: "1 número", message: "A senha deve conter ao menos um número.", pattern: /[0-9]/ },
  { label: "1 especial", message: "A senha deve conter ao menos um caractere especial (!@#$%^&*...).", pattern: /[^A-Za-z0-9]/ },
];

export const PasswordPolicySchema = PASSWORD_RULES.reduce((schema, rule) => schema.regex(rule.pattern, rule.message), z.string());

export class PasswordService {
  /**
   * Valida a senha contra a política de complexidade.
   */
  static validate(password: string): { valid: boolean; error?: string } {
    const result = PasswordPolicySchema.safeParse(password);
    if (!result.success) {
      return {
        valid: false,
        error: result.error.errors[0]?.message || "Senha inválida.",
      };
    }
    return { valid: true };
  }

  /**
   * Gera o hash criptográfico exclusivo com o algoritmo **Argon2id**.
   * Formato PHC padrão: $argon2id$v=19$m=19456,t=2,p=1$...
   */
  static hash(password: string): string {
    return hashSync(password, {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19456, // 19 MiB (OWASP)
      timeCost: 2,       // 2 iterações
      parallelism: 1,
    });
  }

  /**
   * Verifica se a senha em texto puro corresponde ao hash Argon2id armazenado.
   */
  static verify(password: string, storedHash: string): boolean {
    if (!storedHash) return false;
    try {
      return verifySync(storedHash, password);
    } catch {
      return false;
    }
  }
}
