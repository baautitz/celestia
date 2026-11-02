import { createHash, randomBytes } from "node:crypto";
import * as asn1js from "asn1js";
import forge from "node-forge";
import { AttributeTypeAndValue, BasicConstraints, Certificate, Extension, ExtKeyUsage } from "pkijs";

const subtle = globalThis.crypto.subtle;
const RSA = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" } as const;

const DEVICE_VALIDITY_YEARS = 10;
const CA_VALIDITY_YEARS = 20;

const OID = {
  commonName: "2.5.4.3",
  basicConstraints: "2.5.29.19",
  keyUsage: "2.5.29.15",
  extKeyUsage: "2.5.29.37",
  clientAuth: "1.3.6.1.5.5.7.3.2",
};

export interface CertificateAuthorityMaterial {
  /** Certificado da CA em PEM. */
  certificatePem: string;
  /** Chave privada da CA em PEM (PKCS#8). Guardar fora do banco e do repositório. */
  privateKeyPem: string;
}

export interface IssuedDeviceCertificate {
  /** Arquivo PKCS#12 (.pfx) com a chave privada e o certificado do Dispositivo. */
  pfx: Uint8Array;
  /** Senha do .pfx, gerada aqui e mostrada uma única vez. */
  password: string;
  /** SHA-256 do certificado em DER, hexadecimal minúsculo. */
  fingerprint: string;
  /** Número de série do certificado, hexadecimal. */
  serial: string;
  notAfter: Date;
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const toPem = (label: string, der: ArrayBuffer): string => {
  const body = Buffer.from(der).toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
};

const fromPem = (pem: string): ArrayBuffer => {
  const base64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return toArrayBuffer(Buffer.from(base64, "base64"));
};

const yearsFrom = (from: Date, years: number): Date => {
  const to = new Date(from);
  to.setUTCFullYear(to.getUTCFullYear() + years);
  return to;
};

const randomSerial = (): ArrayBuffer => {
  const bytes = randomBytes(16);
  bytes[0] &= 0x7f; // inteiro positivo
  bytes[0] |= 0x40; // sem zeros à esquerda
  return toArrayBuffer(bytes);
};

const name = (certificate: Certificate["subject"], commonName: string) => {
  certificate.typesAndValues.push(
    new AttributeTypeAndValue({ type: OID.commonName, value: new asn1js.Utf8String({ value: commonName }) }),
  );
};

const keyUsageDigitalSignature = new asn1js.BitString({ valueHex: new Uint8Array([0x80]).buffer, unusedBits: 7 });

async function buildCertificate(params: {
  commonName: string;
  issuerCommonName: string;
  publicKey: CryptoKey;
  signingKey: CryptoKey;
  notBefore: Date;
  notAfter: Date;
  isCa: boolean;
}): Promise<Certificate> {
  const cert = new Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ valueHex: randomSerial() });
  name(cert.subject, params.commonName);
  name(cert.issuer, params.issuerCommonName);
  cert.notBefore.value = params.notBefore;
  cert.notAfter.value = params.notAfter;
  await cert.subjectPublicKeyInfo.importKey(params.publicKey);

  const keyUsage = params.isCa
    ? new asn1js.BitString({ valueHex: new Uint8Array([0x06]).buffer, unusedBits: 1 }) // keyCertSign, cRLSign
    : keyUsageDigitalSignature;
  cert.extensions = [
    new Extension({
      extnID: OID.basicConstraints,
      critical: true,
      extnValue: new BasicConstraints({ cA: params.isCa }).toSchema().toBER(false),
    }),
    new Extension({ extnID: OID.keyUsage, critical: true, extnValue: keyUsage.toBER(false) }),
  ];
  if (!params.isCa) {
    cert.extensions.push(
      new Extension({
        extnID: OID.extKeyUsage,
        extnValue: new ExtKeyUsage({ keyPurposes: [OID.clientAuth] }).toSchema().toBER(false),
      }),
    );
  }
  await cert.sign(params.signingKey, "SHA-256");
  return cert;
}

export class DeviceCertificateAuthority {
  private signingKey?: Promise<CryptoKey>;
  private caCertificate: Certificate;

  constructor(private readonly material: CertificateAuthorityMaterial) {
    this.caCertificate = Certificate.fromBER(fromPem(material.certificatePem));
  }

  /** Cria uma CA nova (20 anos). Chamada uma única vez por instância. */
  static async create(options: { commonName: string; now?: Date }): Promise<CertificateAuthorityMaterial> {
    const now = options.now ?? new Date();
    const pair = (await subtle.generateKey(RSA, true, ["sign", "verify"])) as CryptoKeyPair;
    const cert = await buildCertificate({
      commonName: options.commonName,
      issuerCommonName: options.commonName,
      publicKey: pair.publicKey,
      signingKey: pair.privateKey,
      notBefore: now,
      notAfter: yearsFrom(now, CA_VALIDITY_YEARS),
      isCa: true,
    });
    return {
      certificatePem: toPem("CERTIFICATE", cert.toSchema().toBER(false)),
      privateKeyPem: toPem("PRIVATE KEY", await subtle.exportKey("pkcs8", pair.privateKey)),
    };
  }

  private getSigningKey(): Promise<CryptoKey> {
    this.signingKey ??= subtle.importKey("pkcs8", fromPem(this.material.privateKeyPem), RSA, false, ["sign"]);
    return this.signingKey;
  }

  /** Emite o certificado de um Dispositivo (10 anos) e o empacota num .pfx. Não guarda a chave privada. */
  async issue(options: { name: string; now?: Date }): Promise<IssuedDeviceCertificate> {
    const now = options.now ?? new Date();
    const pair = (await subtle.generateKey(RSA, true, ["sign", "verify"])) as CryptoKeyPair;
    const issuerCn = this.caCertificate.subject.typesAndValues[0]?.value.valueBlock.value as string;
    const notAfter = yearsFrom(now, DEVICE_VALIDITY_YEARS);
    const cert = await buildCertificate({
      commonName: options.name,
      issuerCommonName: issuerCn,
      publicKey: pair.publicKey,
      signingKey: await this.getSigningKey(),
      notBefore: now,
      notAfter,
      isCa: false,
    });

    const der = cert.toSchema().toBER(false);
    const password = randomBytes(18).toString("base64url");
    const pfx = await buildPfx({ cert, caCertificate: this.caCertificate, privateKey: pair.privateKey, password, friendlyName: options.name });

    return {
      pfx: new Uint8Array(pfx),
      password,
      fingerprint: createHash("sha256").update(Buffer.from(der)).digest("hex"),
      serial: Buffer.from(cert.serialNumber.valueBlock.valueHexView).toString("hex"),
      notAfter,
    };
  }
}

/**
 * Empacota chave e certificado num .pfx no formato legado (PBE-SHA1-3DES + MAC HMAC-SHA1 do PKCS#12), o único que
 * o Windows (crypt32/certmgr) importa em todas as versões; iOS, macOS e Linux também o aceitam. O PBES2/AES-256 com
 * MAC PBKDF2 gerado antes era recusado pelo Windows ("senha incorreta"/arquivo inválido).
 */
async function buildPfx(params: {
  cert: Certificate;
  /** Certificado da CA, embutido no .pfx para o Windows já confiar na cadeia sem instalar a CA à mão. */
  caCertificate: Certificate;
  privateKey: CryptoKey;
  password: string;
  friendlyName: string;
}): Promise<ArrayBuffer> {
  const certDer = Buffer.from(params.cert.toSchema().toBER(false)).toString("binary");
  const keyDer = Buffer.from(await subtle.exportKey("pkcs8", params.privateKey)).toString("binary");
  const caDer = Buffer.from(params.caCertificate.toSchema().toBER(false)).toString("binary");
  const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(certDer));
  const caCert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(caDer));
  const key = forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(keyDer));
  // O forge reescreve o certificado ao empacotar (acrescenta parâmetros NULL ao algoritmo), o que invalida a assinatura.
  // Por isso os bytes DER originais, exatamente como a CA assinou, entram no .pfx sem passar pela reserialização.
  const originals = new Map<object, string>([[cert, certDer], [caCert, caDer]]);
  const original = forge.pki.certificateToAsn1;
  forge.pki.certificateToAsn1 = (c) => {
    const der = originals.get(c);
    return der ? forge.asn1.fromDer(der) : original(c);
  };
  let p12: forge.asn1.Asn1;
  try {
    p12 = forge.pkcs12.toPkcs12Asn1(key, [cert, caCert], params.password, {
      algorithm: "3des",
      friendlyName: params.friendlyName,
      generateLocalKeyId: true,
      useMac: true,
      count: 2048,
    });
  } finally {
    forge.pki.certificateToAsn1 = original;
  }
  return toArrayBuffer(Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary"));
}
