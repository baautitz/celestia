import type { Device, IssuedDevice } from "@platform/shared";

/** A CA não respondeu, respondeu erro de servidor ou não está configurada. Quem exige certificado falha fechado. */
export class CertificateAuthorityUnavailableError extends Error {
  constructor(detail?: string) {
    super(detail ?? "A autoridade certificadora não está disponível. Tente novamente em instantes.");
    this.name = "CertificateAuthorityUnavailableError";
  }
}

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

  private async call(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<Response> {
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
    // 401 = chave em comum errada: do ponto de vista do Celestia a CA está inutilizável, e falha fechado.
    if (res.status === 503) {
      const detail = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      throw new CertificateAuthorityUnavailableError(detail);
    }
    if (res.status >= 500 || res.status === 401) throw new CertificateAuthorityUnavailableError();
    return res;
  }

  async listDevices(): Promise<Device[]> {
    return (await (await this.call("GET", "/devices")).json()) as Device[];
  }

  async getDevice(id: string): Promise<Device | null> {
    const res = await this.call("GET", `/devices/${encodeURIComponent(id)}`);
    return res.status === 404 ? null : ((await res.json()) as Device);
  }

  async issueDevice(input: { name: string; createdBy?: string }): Promise<IssuedDevice> {
    return (await (await this.call("POST", "/devices", input)).json()) as IssuedDevice;
  }

  async revokeDevice(id: string, revokedBy?: string): Promise<Device> {
    const res = await this.call("POST", `/devices/${encodeURIComponent(id)}/revoke`, { revokedBy });
    if (res.status === 404) throw new DeviceNotFoundError();
    return (await res.json()) as Device;
  }

  async deleteDevice(id: string): Promise<void> {
    const res = await this.call("DELETE", `/devices/${encodeURIComponent(id)}`);
    if (res.status === 404) throw new DeviceNotFoundError();
    if (res.status === 409) throw new DeviceStillActiveError();
  }

  async createChallenge(userId: string): Promise<{ challengeId: string; verifyUrl: string }> {
    return (await (await this.call("POST", "/challenges", { userId })).json()) as { challengeId: string; verifyUrl: string };
  }

  async exchangeChallenge(input: { challengeId: string; code?: string }): Promise<CertificateExchange> {
    const res = await this.call("POST", "/challenges/exchange", input);
    if (res.status === 403) return { granted: false, userId: ((await res.json()) as { userId?: string }).userId };
    if (!res.ok) return { granted: false };
    return { granted: true, ...((await res.json()) as { userId: string; deviceId: string; deviceName: string }) };
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
