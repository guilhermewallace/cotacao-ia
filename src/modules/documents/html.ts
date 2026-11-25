const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&ordm;": "º",
  "&ordf;": "ª",
  "&sup2;": "²",
};

/** Converte o corpo HTML de um e-mail em texto simples (suficiente para extração de itens). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z0-9#]+;/gi, (entity) => {
      const known = ENTITIES[entity.toLowerCase()];
      if (known) return known;
      const numeric = /^&#(x?)([0-9a-f]+);$/i.exec(entity);
      if (!numeric?.[2]) return " ";
      const code = Number.parseInt(numeric[2], numeric[1] ? 16 : 10);
      return Number.isFinite(code) && code > 31 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
