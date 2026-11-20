import { describe, expect, it } from "vitest";
import { safeCertificateUrl } from "./certificate-url";

describe("safeCertificateUrl", () => {
  it("aceita https", () => {
    expect(safeCertificateUrl("https://ca.example.com/verify?c=1", false)).toBe("https://ca.example.com/verify?c=1");
  });
  it("aceita http só em desenvolvimento", () => {
    expect(safeCertificateUrl("http://localhost:4000/verify", true)).toBe("http://localhost:4000/verify");
    expect(safeCertificateUrl("http://ca.example.com/verify", false)).toBeNull();
  });
  it("recusa esquemas perigosos e valores que não são URL", () => {
    expect(safeCertificateUrl("javascript:alert(1)", true)).toBeNull();
    expect(safeCertificateUrl("/relativo", true)).toBeNull();
  });
});
