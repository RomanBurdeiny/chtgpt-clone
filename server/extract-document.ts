export async function extractDocumentText(buf: Buffer, mime: string): Promise<string> {
  if (mime === "text/plain" || mime === "text/markdown") {
    return buf.toString("utf8").trim();
  }
  if (mime === "application/pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buf });
    try {
      const result = await parser.getText();
      return (result.text ?? "").trim();
    } finally {
      await parser.destroy();
    }
  }
  return "";
}
