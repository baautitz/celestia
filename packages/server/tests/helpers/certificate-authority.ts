import { createCaApp, DeviceCertificateAuthority, MemoryDeviceStore } from "@platform/ca";
import type { IssuedDevice } from "@platform/shared";
import { HttpCertificateAuthorityClient } from "../../src/iam/certificate-authority-client.js";

const SECRET = "chave-em-comum-com-mais-de-32-caracteres";
const CALLBACK = "https://app.exemplo.com/login/certificado";

let material: ReturnType<typeof DeviceCertificateAuthority.create> | undefined;
/** Gerar a chave RSA custa algumas centenas de ms: uma CA por arquivo de teste basta. */
const sharedMaterial = () => (material ??= DeviceCertificateAuthority.create({ commonName: "Celestia CA (teste)" }));

/**
 * A autoridade certificadora de verdade, em memória, atrás do cliente HTTP do backend (sem rede). O certificado que
 * o navegador "apresenta" ao ler o link do desafio é escolhido por um header de teste; em produção vem do proxy.
 */
export async function createTestCertificateAuthority(options: { withAuthority?: boolean } = {}) {
  const deviceStore = new MemoryDeviceStore();
  const app = createCaApp({
    deviceStore,
    authority: options.withAuthority === false ? undefined : new DeviceCertificateAuthority(await sharedMaterial()),
    sharedSecret: SECRET,
    publicUrl: "https://acesso.exemplo.com",
    callbackUrl: CALLBACK,
    readCertificate: (c) => c.req.header("x-test-fingerprint"),
  });
  const state = { down: false };
  const client = new HttpCertificateAuthorityClient({
    baseUrl: "http://ca.test",
    secret: SECRET,
    fetch: (input, init) => (state.down ? Promise.reject(new TypeError("fetch failed")) : Promise.resolve(app.request(String(input), init))),
  });

  /** Emite um Dispositivo pela API da CA, como o painel faz. */
  const issueDevice = (name = "Caixa 1"): Promise<IssuedDevice> => client.issueDevice({ name });

  /** O navegador segue o link do desafio apresentando `fingerprint` e volta ao callback; devolve o que o SPA enviaria ao backend. */
  const followVerifyUrl = async (verifyUrl: string, fingerprint?: string) => {
    const res = await app.request(new URL(verifyUrl).pathname + new URL(verifyUrl).search, {
      headers: fingerprint ? { "x-test-fingerprint": fingerprint } : {},
    });
    const location = new URL(res.headers.get("location")!);
    return { challengeId: location.searchParams.get("challenge")!, code: location.searchParams.get("code") ?? undefined };
  };

  /** Simula a CA fora do ar: toda chamada do backend falha como uma falha de rede. */
  const setDown = (down: boolean) => {
    state.down = down;
  };

  return { app, client, deviceStore, issueDevice, followVerifyUrl, setDown };
}

export type TestCertificateAuthority = Awaited<ReturnType<typeof createTestCertificateAuthority>>;
