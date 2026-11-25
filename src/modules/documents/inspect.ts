import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import type { AttachmentKind } from "@/generated/prisma/enums";

/**
 * Identificação do tipo real de um arquivo pelos seus bytes ("magic numbers").
 * O nome e o tipo declarados pelo remetente servem apenas de desempate para
 * formatos de texto, que não possuem assinatura binária.
 */

export interface InspectedFile {
  ok: true;
  kind: AttachmentKind;
  /** Tipo de conteúdo canônico, definido por nós. */
  contentType: string;
  /** Extensão canônica, sem ponto. */
  extension: string;
}

export interface RejectedFile {
  ok: false;
  reason: string;
}

export interface InspectOptions {
  maxBytes: number;
  /** Áudio é aceito apenas em canais de mensagem (WhatsApp, e-mail). */
  allowAudio?: boolean;
  /** Texto puro (.txt) é aceito apenas em canais de mensagem. */
  allowPlainText?: boolean;
}

const AUDIO_TYPES: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
};

export const UPLOAD_ACCEPT = ".pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png";
export const UPLOAD_FORMATS_LABEL = "PDF, XLSX, XLS, CSV, JPG, JPEG ou PNG";

function looksLikeText(data: Buffer): boolean {
  const sample = data.subarray(0, 8192);
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / Math.max(sample.length, 1) < 0.02;
}

export async function inspectFile(data: Buffer, fileName: string, options: InspectOptions): Promise<InspectedFile | RejectedFile> {
  if (data.length === 0) return { ok: false, reason: "Arquivo vazio." };
  if (data.length > options.maxBytes) {
    return { ok: false, reason: `Arquivo excede o limite de ${Math.round(options.maxBytes / (1024 * 1024))} MB.` };
  }

  const extension = path.extname(fileName).slice(1).toLowerCase();
  const detected = await fileTypeFromBuffer(data);

  if (detected) {
    switch (detected.mime) {
      case "application/pdf":
        return { ok: true, kind: "PDF", contentType: "application/pdf", extension: "pdf" };
      case "image/png":
        return { ok: true, kind: "IMAGE", contentType: "image/png", extension: "png" };
      case "image/jpeg":
        return { ok: true, kind: "IMAGE", contentType: "image/jpeg", extension: "jpg" };
      case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        return { ok: true, kind: "SPREADSHEET", contentType: detected.mime, extension: "xlsx" };
      case "application/x-cfb":
        // Contêiner OLE genérico (XLS, DOC, MSG...): aceito apenas quando declarado como planilha.
        if (extension === "xls") {
          return { ok: true, kind: "SPREADSHEET", contentType: "application/vnd.ms-excel", extension: "xls" };
        }
        return { ok: false, reason: "Formato não suportado." };
      default: {
        const audioExtension = AUDIO_TYPES[detected.mime];
        if (audioExtension) {
          if (!options.allowAudio) return { ok: false, reason: "Arquivos de áudio não são aceitos neste canal." };
          return { ok: true, kind: "AUDIO", contentType: detected.mime, extension: audioExtension };
        }
        return { ok: false, reason: `Formato não suportado (${detected.ext}).` };
      }
    }
  }

  // Sem assinatura binária: só pode ser texto (CSV ou TXT).
  if (!looksLikeText(data)) return { ok: false, reason: "Formato não reconhecido." };
  if (extension === "csv" || extension === "tsv") {
    return { ok: true, kind: "SPREADSHEET", contentType: "text/csv", extension: "csv" };
  }
  if (extension === "txt" && options.allowPlainText) {
    return { ok: true, kind: "TEXT", contentType: "text/plain", extension: "txt" };
  }
  return { ok: false, reason: "Formato não suportado." };
}

/** Nome de arquivo seguro para exibição e download (sem caminhos nem caracteres de controle). */
export function sanitizeFileName(fileName: string | null | undefined, fallback = "arquivo"): string {
  const base = path.basename((fileName ?? "").replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").trim();
  const cleaned = base.replace(/^\.+/, "");
  return (cleaned || fallback).slice(0, 180);
}
