import { createHash, randomBytes } from "node:crypto";
import * as asn1js from "asn1js";
import {
  AlgorithmIdentifier,
  Attribute,
  AttributeTypeAndValue,
  AuthenticatedSafe,
  BasicConstraints,
  CertBag,
  Certificate,
  EncryptedContentInfo,
  Extension,
  ExtKeyUsage,
  PBES2Params,
  PBKDF2Params,
  PFX,
  PKCS8ShroudedKeyBag,
  PrivateKeyInfo,
  SafeBag,
  SafeContents,
  setEngine,
  CryptoEngine,
} from "pkijs";

const PBES2_OID = "1.2.840.113549.1.5.13";
/** Tamanho do salt do PBKDF2 do .pfx. O pkijs usa 64 bytes, que a libksba (gpgsm, Kleopatra) recusa; 16 é o padrão do OpenSSL. */
const PBES2_SALT_BYTES = 16;

/** Igual ao motor do pkijs, só que o PBES2 do .pfx usa um salt de 16 bytes, aceito por todos os importadores. */
class CelestiaCryptoEngine extends CryptoEngine {
  override async encryptEncryptedContentInfo(parameters: Parameters<CryptoEngine["encryptEncryptedContentInfo"]>[0]): Promise<EncryptedContentInfo> {
    const contentOid = this.getOIDByAlgorithm(parameters.contentEncryptionAlgorithm, true, "contentEncryptionAlgorithm");
    const hmacOid = this.getOIDByAlgorithm({ name: "HMAC", hash: { name: parameters.hmacHashAlgorithm } } as Algorithm, true, "hmacHashAlgorithm");
    const iv = this.getRandomValues(new Uint8Array(16));
    const salt = this.getRandomValues(new Uint8Array(PBES2_SALT_BYTES));
    const passwordKey = await this.importKey("raw", new Uint8Array(parameters.password), "PBKDF2", false, ["deriveKey"]);
    const derivedKey = await this.deriveKey(
      { name: "PBKDF2", hash: { name: parameters.hmacHashAlgorithm }, salt, iterations: parameters.iterationCount },
      passwordKey,
      parameters.contentEncryptionAlgorithm,
      false,
      ["encrypt"],
    );
    const encrypted = await this.encrypt({ name: parameters.contentEncryptionAlgorithm.name, iv }, derivedKey, new Uint8Array(parameters.contentToEncrypt));
    const pbkdf2 = new PBKDF2Params({
      salt: new asn1js.OctetString({ valueHex: toArrayBuffer(salt) }),
      iterationCount: parameters.iterationCount,
      prf: new AlgorithmIdentifier({ algorithmId: hmacOid, algorithmParams: new asn1js.Null() }),
    });
    const pbes2 = new PBES2Params({
      keyDerivationFunc: new AlgorithmIdentifier({ algorithmId: this.getOIDByAlgorithm({ name: "PBKDF2" }, true, "PBKDF2"), algorithmParams: pbkdf2.toSchema() }),
      encryptionScheme: new AlgorithmIdentifier({ algorithmId: contentOid, algorithmParams: new asn1js.OctetString({ valueHex: toArrayBuffer(iv) }) }),
    });
    return new EncryptedContentInfo({
      contentType: parameters.contentType,
      contentEncryptionAlgorithm: new AlgorithmIdentifier({ algorithmId: PBES2_OID, algorithmParams: pbes2.toSchema() }),
      encryptedContent: new asn1js.OctetString({ valueHex: encrypted }),
    });
  }
}

setEngine("celestia", new CelestiaCryptoEngine({ name: "celestia", crypto: globalThis.crypto }));

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
  keyBag: "1.2.840.113549.1.12.10.1.2",
  certBag: "1.2.840.113549.1.12.10.1.3",
  friendlyName: "1.2.840.113549.1.9.20",
  localKeyId: "1.2.840.113549.1.9.21",
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
      certificatePem: toPem("CERTIFICATE", cert.toSchema(true).toBER(false)),
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

    const der = cert.toSchema(true).toBER(false);
    const password = randomBytes(18).toString("base64url");
    const pfx = await buildPfx({ cert, privateKey: pair.privateKey, password, friendlyName: options.name });

    return {
      pfx: new Uint8Array(pfx),
      password,
      fingerprint: createHash("sha256").update(Buffer.from(der)).digest("hex"),
      serial: Buffer.from(cert.serialNumber.valueBlock.valueHexView).toString("hex"),
      notAfter,
    };
  }
}

/** Liga a chave ao certificado dentro do .pfx e dá um nome legível; sem isso Windows, macOS e iOS não importam o par. */
const bagAttributes = (friendlyName: string, localKeyId: ArrayBuffer) => [
  new Attribute({ type: OID.friendlyName, values: [new asn1js.BmpString({ value: friendlyName })] }),
  new Attribute({ type: OID.localKeyId, values: [new asn1js.OctetString({ valueHex: localKeyId })] }),
];

async function buildPfx(params: {
  cert: Certificate;
  privateKey: CryptoKey;
  password: string;
  friendlyName: string;
}): Promise<ArrayBuffer> {
  const attributes = () => bagAttributes(params.friendlyName, localKeyId);
  const localKeyId = toArrayBuffer(randomBytes(20));
  const passwordBuffer = toArrayBuffer(Buffer.from(params.password, "utf8"));
  const encryption = {
    password: passwordBuffer,
    contentEncryptionAlgorithm: { name: "AES-CBC", length: 256, iv: new Uint8Array(randomBytes(16)) },
    hmacHashAlgorithm: "SHA-256",
    iterationCount: 100000,
  };

  const privateKeyInfo = new PrivateKeyInfo({
    schema: asn1js.fromBER(await subtle.exportKey("pkcs8", params.privateKey)).result,
  });
  const keyBag = new PKCS8ShroudedKeyBag({ parsedValue: privateKeyInfo });
  await keyBag.makeInternalValues(encryption);

  const pfx = new PFX({
    parsedValue: {
      integrityMode: 0,
      authenticatedSafe: new AuthenticatedSafe({
        parsedValue: {
          safeContents: [
            {
              privacyMode: 0,
              value: new SafeContents({ safeBags: [new SafeBag({ bagId: OID.keyBag, bagValue: keyBag, bagAttributes: attributes() })] }),
            },
            {
              privacyMode: 1,
              value: new SafeContents({
                safeBags: [new SafeBag({
                    bagId: OID.certBag,
                    bagValue: new CertBag({ parsedValue: params.cert }),
                    bagAttributes: attributes(),
                  }),],
              }),
            },
          ],
        },
      }),
    },
  });
  await pfx.parsedValue!.authenticatedSafe!.makeInternalValues({ safeContents: [{}, encryption] });
  await pfx.makeInternalValues({
    password: passwordBuffer,
    iterations: 100000,
    pbkdf2HashAlgorithm: { name: "SHA-256" } as Algorithm,
    hmacHashAlgorithm: "SHA-256",
  });
  return pfx.toSchema().toBER(false);
}
