export function getFilenameBase(inputName: string): string {
  const lastSegment = inputName.split(/[/\\]/).pop() ?? inputName;
  const trimmed = lastSegment.trim() || "output";
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0) return trimmed;
  return trimmed.slice(0, lastDot) || "output";
}

export function sanitizeAttachmentFilename(name: string): string {
  const lastSegment = name.split(/[/\\]/).pop() ?? name;
  const noControls = lastSegment.replace(/[\r\n\t\0]/g, " ");
  const noQuotes = noControls.replace(/["<>]/g, "");
  const noSeparators = noQuotes.replace(/[\\/]/g, "_").trim();
  return noSeparators.slice(0, 180) || "download";
}

function encodeRFC5987ValueChars(value: string): string {
  return encodeURIComponent(value).replace(/[()*']/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function buildContentDispositionAttachment(filename: string): string {
  const sanitized = sanitizeAttachmentFilename(filename);
  const asciiFallback =
    sanitized
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\]/g, "_")
      .trim() || "download";
  const encoded = encodeRFC5987ValueChars(sanitized);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
