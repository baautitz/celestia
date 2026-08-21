import { hashSync, verifySync, Algorithm } from "@node-rs/argon2";
import { z } from "zod";

/**
 * Schema Zod estrito para política de senha:
 * - Mínimo de 8 caracteres
 * - Pelo menos uma letra maiúscula
 * - Pelo menos uma letra minúscula
 * - Pelo menos um número
 * - Pelo menos um caractere especial (!@#$%^&*...)
 */
export const PasswordPolicySchema = z
  .string()
  .min(8, "A senha deve conter no mínimo 8 caracteres.")
  .regex(/[A-Z]/, "A senha deve conter ao menos uma letra maiúscula.")
  .regex(/[a-z]/, "A senha deve conter ao menos uma letra minúscula.")
  .regex(/[0-9]/, "A senha deve conter ao menos um número.")
  .regex(
    /[^A-Za-z0-9]/,
    "A senha deve conter ao menos um caractere especial (!@#$%^&*...).",
  );

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
