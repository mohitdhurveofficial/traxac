import { Share } from "@capacitor/share";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { isNativeApp } from "./platform.js";

/**
 * Sharing and capture, where the phone genuinely does it better.
 *
 * Two real workflows, not a plugin showcase:
 *
 *  - Sending an invoice to a customer. On a handset that means WhatsApp, and
 *    a download link is a poor substitute for the system share sheet.
 *  - Attaching a lorry receipt. The document is usually a paper slip in the
 *    driver's hand, so the camera is the natural input.
 *
 * Every function degrades on the web rather than being hidden, so the same
 * button works in all three clients.
 */

/**
 * Share an invoice PDF through the system share sheet.
 *
 * The PDF is fetched through the authenticated API — the same endpoint the web
 * uses — then written to a cache file, because the share sheet needs a file
 * URI and cannot carry an authenticated request of its own. Cache rather than
 * documents, so the OS reclaims it and a customer's invoice is not left
 * sitting in device storage indefinitely.
 */
export async function shareInvoicePdf(
  invoiceId: string,
  invoiceNumber: string,
  fetchPdf: () => Promise<Blob>,
): Promise<"shared" | "downloaded" | "unavailable"> {
  const filename = `${invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "-")}.pdf`;

  if (!isNativeApp()) {
    // The browser's own download is the right behaviour on the web.
    const blob = await fetchPdf();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    return "downloaded";
  }

  const blob = await fetchPdf();
  const base64 = await blobToBase64(blob);
  const written = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
  });

  await Share.share({
    title: `Invoice ${invoiceNumber}`,
    text: `Invoice ${invoiceNumber}`,
    url: written.uri,
    dialogTitle: "Send invoice",
  });
  return "shared";
}

/**
 * Attach a document, from the camera or the gallery.
 *
 * Returns a `File` so it goes through exactly the same upload path as the
 * web's file input — one endpoint, one validation, one MIME allowlist.
 */
export async function captureAttachment(source: "camera" | "photos"): Promise<File | null> {
  if (!isNativeApp()) return null;

  const photo = await Camera.getPhoto({
    quality: 80,
    // A lorry receipt is a document, so let the user straighten it.
    allowEditing: false,
    resultType: CameraResultType.Base64,
    source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
    // Paper documents are legible at this size and upload on a weak signal.
    width: 1600,
    correctOrientation: true,
  });

  if (!photo.base64String) return null;
  const bytes = base64ToBytes(photo.base64String);
  const type = photo.format === "png" ? "image/png" : "image/jpeg";
  const extension = photo.format === "png" ? "png" : "jpg";
  return new File([bytes], `photo-${Date.now()}.${extension}`, { type });
}

/** True when the camera is a real option, so the UI can offer it or not. */
export function canCapture(): boolean {
  return isNativeApp();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.onload = () => {
      const result = String(reader.result);
      // Filesystem wants the payload only, not the data: prefix.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return buffer;
}
