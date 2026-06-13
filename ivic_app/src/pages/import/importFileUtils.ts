import type { Attachment, DroppedFilePayload, UploadedAttachmentPayload } from "../../types/domain";

export interface SelectedFileItem {
  id: string;
  file: File;
  url: string;
  bytes?: number[];
  sourcePath?: string;
  existingAttachment?: boolean;
}

export function toFileItems(files: File[]) {
  return files.map((file) => ({
    id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
    file,
    url: URL.createObjectURL(file),
  }));
}

export function fileSnapshot(items: SelectedFileItem[]) {
  return items.map((item) => ({
    existing: Boolean(item.existingAttachment),
    name: item.file.name,
    size: item.file.size,
    type: item.file.type,
  }));
}

export function revokeItems(items: SelectedFileItem[]) {
  items.forEach((item) => URL.revokeObjectURL(item.url));
}

export function removeFileItem(items: SelectedFileItem[], id: string) {
  const target = items.find((item) => item.id === id);
  if (target) {
    URL.revokeObjectURL(target.url);
  }
  return items.filter((item) => item.id !== id);
}

export async function filesToPayloads(items: SelectedFileItem[], fileType: string, remark: string): Promise<UploadedAttachmentPayload[]> {
  return Promise.all(
    items
      .filter((item) => !item.existingAttachment)
      .map(async (item) => ({
        fileName: item.file.name,
        fileType,
        remark,
        bytes: Array.from(new Uint8Array(await item.file.arrayBuffer())),
      })),
  );
}

export async function extractReadableText(file: File) {
  if (file.type.startsWith("text/") || /\.(txt|csv|json|xml)$/i.test(file.name)) {
    return (await file.text()).slice(0, 4000);
  }
  return "";
}

export function buildUploadedFileSummary(file: File) {
  return `已上传发票文件：${file.name}\n文件大小：${formatFileSize(file.size)}\nPDF/图片预览显示在右侧；如需精确 OCR，可在此处继续补充或修正发票文本。`;
}

export function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

export function isInvoiceLikeFile(fileName: string) {
  return /\.(pdf|png|jpe?g|bmp|tiff?|ofd)$/i.test(fileName);
}

export function isInvoiceAttachment(attachment: Attachment) {
  return attachment.fileType === "发票" || isInvoiceLikeFile(attachment.fileName);
}

export function payloadsToFileItems(payloads: DroppedFilePayload[]) {
  return payloads.map((payload) => {
    const bytes = new Uint8Array(payload.bytes);
    const file = new File([bytes], payload.fileName, { type: mimeTypeForFile(payload.fileName) });
    return {
      id: `${payload.sourcePath}-${payload.bytes.length}-${crypto.randomUUID()}`,
      file,
      bytes: payload.bytes,
      sourcePath: payload.sourcePath,
      url: URL.createObjectURL(file),
    };
  });
}

export function payloadsToExistingFileItems(payloads: UploadedAttachmentPayload[]) {
  return payloads.map((payload) => {
    const bytes = new Uint8Array(payload.bytes);
    const file = new File([bytes], payload.fileName, { type: mimeTypeForFile(payload.fileName) });
    return {
      id: `existing-${payload.fileName}-${payload.bytes.length}-${crypto.randomUUID()}`,
      file,
      bytes: payload.bytes,
      url: URL.createObjectURL(file),
      existingAttachment: true,
    };
  });
}

function mimeTypeForFile(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
  return "application/octet-stream";
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
