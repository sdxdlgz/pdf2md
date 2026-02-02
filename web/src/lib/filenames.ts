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

