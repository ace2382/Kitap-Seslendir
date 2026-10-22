import { describe, expect, it } from "vitest";
import { MAX_PDF_BYTES, UserError, assertPdfFile, describeError } from "./errors.ts";

describe("assertPdfFile", () => {
  it("boş dosyayı reddeder", () => {
    expect(() => assertPdfFile({ name: "a.pdf", size: 0 })).toThrow("boş");
  });
  it("PDF olmayan dosyayı reddeder", () => {
    expect(() => assertPdfFile({ name: "a.txt", size: 10, type: "text/plain" })).toThrow("PDF");
  });
  it("çok büyük dosyayı reddeder", () => {
    expect(() => assertPdfFile({ name: "a.pdf", size: MAX_PDF_BYTES + 1 })).toThrow("çok büyük");
  });
  it("geçerli PDF'i kabul eder", () => {
    expect(() => assertPdfFile({ name: "Hikaye.PDF", size: 1234 })).not.toThrow();
    expect(() => assertPdfFile({ name: "indirilen", size: 1, type: "application/pdf" })).not.toThrow();
  });
});

describe("describeError", () => {
  const named = (name: string, message = "") => Object.assign(new Error(message), { name });
  it("parola korumalı PDF", () => {
    expect(describeError(named("PasswordException", "No password given"))).toContain("parola");
  });
  it("bozuk PDF — İngilizce ham mesaj sızmaz", () => {
    const text = describeError(named("InvalidPDFException", "Invalid PDF structure."));
    expect(text).toContain("bozuk");
    expect(text).not.toContain("Invalid");
  });
  it("PDF başlığı yoksa bozuk sayar", () => {
    expect(describeError(new Error("No PDF header found"))).toContain("bozuk");
  });
  it("depolama dolu", () => {
    expect(describeError(named("QuotaExceededError"))).toContain("depolama");
  });
  it("UserError mesajını aynen geçirir", () => {
    expect(describeError(new UserError("Özel mesaj"))).toBe("Özel mesaj");
  });
  it("bilinmeyen hatada Türkçe genel mesaj verir", () => {
    expect(describeError(new Error("boom"))).toContain("Tekrar dene");
    expect(describeError(undefined)).toContain("Tekrar dene");
  });
});
