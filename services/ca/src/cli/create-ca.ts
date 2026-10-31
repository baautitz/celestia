import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { DeviceCertificateAuthority } from "../authority.js";

export interface CreateCaFilesInput {
  certFile: string;
  keyFile: string;
  commonName: string;
}

/**
 * Cria a CA que emite os certificados dos Dispositivos e a grava em dois arquivos. A chave fica só para o dono
 * (0600) e nada é sobrescrito: perder a chave obriga a reemitir todos os certificados.
 */
export async function createCaFiles({ certFile, keyFile, commonName }: CreateCaFilesInput): Promise<void> {
  const material = await DeviceCertificateAuthority.create({ commonName });
  try {
    for (const file of [certFile, keyFile]) mkdirSync(dirname(file), { recursive: true });
    // `wx` falha se o arquivo já existe, então uma CA em uso nunca é trocada por engano.
    writeFileSync(keyFile, material.privateKeyPem, { flag: "wx", mode: 0o600 });
    writeFileSync(certFile, material.certificatePem, { flag: "wx", mode: 0o644 });
  } catch (err: unknown) {
    const failure = err as NodeJS.ErrnoException;
    if (failure.code === "EEXIST") {
      throw new Error(`A CA já existe (${failure.path}). Apague os arquivos só se for reemitir todos os Dispositivos.`, { cause: err });
    }
    throw err;
  }
}

async function main() {
  const { values } = parseArgs({ options: { name: { type: "string", default: "Celestia CA" } } });
  const certFile = process.env.DEVICE_CA_CERT_FILE;
  const keyFile = process.env.DEVICE_CA_KEY_FILE;
  if (!certFile || !keyFile) {
    throw new Error("Defina DEVICE_CA_CERT_FILE e DEVICE_CA_KEY_FILE com o caminho dos arquivos da CA.");
  }
  await createCaFiles({ certFile, keyFile, commonName: values.name });
  console.log(`CA criada.\n  Certificado: ${certFile}\n  Chave:       ${keyFile}`);
  console.log("Guarde a chave fora do banco e do repositório, com backup: sem ela é preciso reemitir todos os Dispositivos.");
}

if (typeof process !== "undefined" && process.env?.NODE_ENV !== "test" && !process.env?.VITEST) {
  main().catch((err: Error) => {
    console.error(`Erro: ${err.message}`);
    process.exitCode = 1;
  });
}
