// pdfjs-dist "legacy" derlemesi eski Android WebView'larda da çalışır
// (ana derleme Promise.withResolvers gibi yeni API'lere ihtiyaç duyar).
// Paketin tiplerini bu yola yeniden yönlendiriyoruz.
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
}
