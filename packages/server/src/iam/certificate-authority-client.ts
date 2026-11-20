import { z } from "zod";
import type { Device, IssuedDevice, ValidationErrorBody } from "@platform/shared";

/** A CA não respondeu, respondeu erro de servidor ou não está configurada. Quem exige certificado falha fechado. */
export class CertificateAuthorityUnavailableError extends Error {
  constructor(detail?: string) {
    super(detail ?? "A autoridade certificadora não está disponível. Tente novamente em instantes.");
    this.name = "CertificateAuthorityUnavailableError";
  }
}

/** A CA recusou o pedido por entrada inválida (400); `body` é o contrato `ValidationErrorBody` que ela devolveu. */
export class CertificateAuthorityValidationError extends Error {
  constructor(readonly body: ValidationErrorBody) {
    super("A autoridade certificadora recusou o pedido.");
    this.name = "CertificateAuthorityValidationError";
  }
}

const ValidationBody: z.ZodType<ValidationErrorBody> = z.object({
  error: z.object({ issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })) }),
});

export class DeviceNotFoundError extends Error {
  constructor() {
    super("Dispositivo não encontrado.");
    this.name = "DeviceNotFoundError";
  }
}

export class DeviceStillActiveError extends Error {
  constructor() {
    super("Revogue o Dispositivo antes de excluí-lo.");
    this.name = "DeviceStillActiveError";
  }
}

export type CertificateExchange =
  | { granted: true; userId: string; deviceId: string; deviceName: string }
  /** `userId` só vem quando o desafio existia. */
  | { granted: false; userId?: string };

/**
 * O que o Celestia pede à autoridade certificadora (CA): emitir, revogar e consultar Dispositivos, e abrir e
 * trocar o desafio do login por certificado. A CA é um serviço à parte (`services/ca`), dono da chave e dos Dispositivos.
 */
export interface CertificateAuthorityClient {
  listDevices(): Promise<Device[]>;
  getDevice(id: string): Promise<Device | null>;
  issueDevice(input: { name: string; createdBy?: string }): Promise<IssuedDevice>;
  revokeDevice(id: string, revokedBy?: string): Promise<Device>;
  /** Apaga um Dispositivo já revogado; um ativo lança `DeviceStillActiveError`. */
  deleteDevice(id: string): Promise<void>;
  /** Abre o desafio do login do usuário e devolve o link da CA onde o navegador apresenta o certificado. */
  createChallenge(userId: string): Promise<{ challengeId: string; verifyUrl: string }>;
  exchangeChallenge(input: { challengeId: string; code?: string }): Promise<CertificateExchange>;
}

export const MIN_CA_SHARED_SECRET_LENGTH = 32;
const TIMEOUT_MS = 5000;

export interface HttpCertificateAuthorityOptions {
  baseUrl: string;
  /** Chave em comum com a CA, enviada como `Authorization: Bearer`. */
  secret: string;
  /** Injetável nos testes para chamar a CA em memória. */
  fetch?: typeof fetch;
}

/** Fala com a CA por HTTP usando a chave em comum. Qualquer falha de rede ou 5xx vira `CertificateAuthorityUnavailableError`. */
export class HttpCertificateAuthorityClient implements CertificateAuthorityClient {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly doFetch: typeof fetch;

  constructor({ baseUrl, secret, fetch: doFetch = fetch }: HttpCertificateAuthorityOptions) {
    if (secret.length < MIN_CA_SHARED_SECRET_LENGTH) {
      throw new Error(`CA_SHARED_SECRET precisa ter ao menos ${MIN_CA_SHARED_SECRET_LENGTH} caracteres.`);
    }
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.secret = secret;
    this.doFetch = doFetch;
  }

  /**
   * Chama a CA e devolve a resposta só quando ela pode ser lida pelo método: 2xx, ou o 404/409/403 que o método trata
   * (`handled`). Qualquer outro status falha: 400 vira `CertificateAuthorityValidationError`, o resto
   * `CertificateAuthorityUnavailableError` (chave em comum errada, 5xx, redirecionamento, status inesperado).
   */
  private async call(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, handled: readonly number[] = []): Promise<Response> {
    let res: Response;
    try {
      res = await this.doFetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.secret}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new CertificateAuthorityUnavailableError();
    }
    if (res.ok || handled.includes(res.status)) return res;
    if (res.status === 503) {
      const detail = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      throw new CertificateAuthorityUnavailableError(detail);
    }
    if (res.status === 400) {
      const parsed = ValidationBody.safeParse(await res.json().catch(() => undefined));
      if (parsed.success) throw new CertificateAuthorityValidationError(parsed.data);
    }
    // 401 = chave em comum errada: do ponto de vista do Celestia a CA está inutilizável, e falha fechado.
    throw new CertificateAuthorityUnavailableError();
  }

  /** Lê o corpo JSON de uma resposta aceita; corpo ilegível é CA com defeito, não um sucesso. */
  private async json<T>(res: Response): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch {
      throw new CertificateAuthorityUnavailableError();
    }
  }

  async listDevices(): Promise<Device[]> {
    return this.json<Device[]>(await this.call("GET", "/devices"));
  }

  async getDevice(id: string): Promise<Device | null> {
    const res = await this.call("GET", `/devices/${encodeURIComponent(id)}`, undefined, [404]);
    return res.status === 404 ? null : this.json<Device>(res);
  }

  async issueDevice(input: { name: string; createdBy?: string }): Promise<IssuedDevice> {
    return this.json<IssuedDevice>(await this.call("POST", "/devices", input));
  }

  async revokeDevice(id: string, revokedBy?: string): Promise<Device> {
    const res = await this.call("POST", `/devices/${encodeURIComponent(id)}/revoke`, { revokedBy }, [404]);
    if (res.status === 404) throw new DeviceNotFoundError();
    return this.json<Device>(res);
  }

  async deleteDevice(id: string): Promise<void> {
    const res = await this.call("DELETE", `/devices/${encodeURIComponent(id)}`, undefined, [404, 409]);
    if (res.status === 404) throw new DeviceNotFoundError();
    if (res.status === 409) throw new DeviceStillActiveError();
  }

  async createChallenge(userId: string): Promise<{ challengeId: string; verifyUrl: string }> {
    return this.json(await this.call("POST", "/challenges", { userId }));
  }

  async exchangeChallenge(input: { challengeId: string; code?: string }): Promise<CertificateExchange> {
    const res = await this.call("POST", "/challenges/exchange", input, [403]);
    if (res.status === 403) return { granted: false, userId: (await this.json<{ userId?: string }>(res)).userId };
    return { granted: true, ...(await this.json<{ userId: string; deviceId: string; deviceName: string }>(res)) };
  }
}

/** Sem CA configurada nada é emitido nem aceito: quem exige certificado falha fechado, quem tem a isenção não é afetado. */
export const unavailableCertificateAuthority: CertificateAuthorityClient = {
  listDevices: () => Promise.reject(new CertificateAuthorityUnavailableError()),
  getDevice: () => Promise.reject(new CertificateAuthorityUnavailableError()),
  issueDevice: () => Promise.reject(new CertificateAuthorityUnavailableError()),
  revokeDevice: () => Promise.reject(new CertificateAuthorityUnavailableError()),
  deleteDevice: () => Promise.reject(new CertificateAuthorityUnavailableError()),
  createChallenge: () => Promise.reject(new CertificateAuthorityUnavailableError()),
  exchangeChallenge: () => Promise.reject(new CertificateAuthorityUnavailableError()),
};
