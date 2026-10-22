// Kullanıcıya gösterilecek hatalar. pdf.js ve tarayıcı hatalarının İngilizce ham
// mesajları arayüze sızmaz; burada anlaşılır Türkçe metinlere çevrilir.

export const MAX_PDF_BYTES = 100 * 1024 * 1024;
export const MAX_PDF_PAGES = 3000;

export class UserError extends Error {
  code: string;
  constructor(message: string, code = "USER") {
    super(message);
    this.name = "UserError";
    this.code = code;
  }
}

export function assertPdfFile(file: { name: string; size: number; type?: string }): void {
  const looksLikePdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
  if (!looksLikePdf) throw new UserError("Lütfen bir PDF dosyası seç.", "NOT_PDF");
  if (!file.size) throw new UserError("Seçtiğin PDF dosyası boş.", "EMPTY");
  if (file.size > MAX_PDF_BYTES) {
    const mb = Math.round(MAX_PDF_BYTES / 1024 / 1024);
    throw new UserError(`PDF çok büyük (${mb} MB üzeri). Daha küçük bir dosya seçmeyi dene.`, "TOO_LARGE");
  }
}

type ErrLike = { name?: unknown; message?: unknown; code?: unknown };

export function describeError(e: unknown, fallback = "Beklenmeyen bir hata oluştu. Tekrar dene."): string {
  if (e instanceof UserError) return e.message;
  const err = (typeof e === "object" && e !== null ? e : {}) as ErrLike;
  const name = typeof err.name === "string" ? err.name : "";
  const message = typeof err.message === "string" ? err.message : "";

  if (name === "PasswordException") {
    return "Bu PDF parola korumalı. Parolayı girmeden metin çıkarılamaz.";
  }
  if (
    name === "InvalidPDFException" ||
    name === "FormatError" ||
    /invalid pdf|no pdf header|bad xref|xref|unexpected end/i.test(message)
  ) {
    return "Bu dosya bozuk görünüyor veya geçerli bir PDF değil.";
  }
  if (name === "MissingPDFException") return "PDF dosyası bulunamadı.";
  if (name === "AbortException" || name === "AbortError") return "İşlem iptal edildi.";
  if (name === "QuotaExceededError" || err.code === 22 || err.code === 1014) {
    return "Cihazda yeterli depolama alanı yok. Yer açıp tekrar dene.";
  }
  if (name === "NotReadableError" || name === "NotFoundError") {
    return "Dosya okunamadı. Dosyayı yeniden seçmeyi dene.";
  }
  return fallback;
}
