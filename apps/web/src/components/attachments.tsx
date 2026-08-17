import { useRef, useState } from "react";
import { useDeleteDocument, useInvoiceDocuments, useUploadDocument } from "../api/hooks.js";
import { useConfirm } from "./forms.js";
import { ErrorNote, Spinner } from "./ui.js";
import { formatDateTime } from "../lib/format.js";

/**
 * Attachments on an invoice.
 *
 * A trader keeps the purchase order, the lorry receipt and the insurance
 * certificate with the invoice they belong to, so this sits on the invoice
 * rather than in a separate filing screen.
 *
 * Every file is fetched through the authenticated API — there is no public
 * URL, and a link is useless to anyone not signed in to this business.
 */
const LABELS = [
  "Purchase order",
  "Lorry receipt",
  "Delivery note",
  "Insurance",
  "Weighment slip",
  "Other",
];

/** Files the system generated, which are not user attachments. */
const GENERATED = new Set(["invoice_pdf", "einvoice_json", "einvoice_qr", "ewb_pdf"]);

export function Attachments({
  invoiceId,
  canEdit,
  onToast,
}: {
  invoiceId: string;
  canEdit: boolean;
  onToast: (message: string) => void;
}) {
  const documents = useInvoiceDocuments(invoiceId);
  const upload = useUploadDocument(invoiceId);
  const remove = useDeleteDocument(invoiceId);
  const { confirm, dialog } = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState(LABELS[0] as string);

  const all = documents.data?.items ?? [];
  const generated = all.filter((d) => GENERATED.has(d.kind));
  const attached = all.filter((d) => !GENERATED.has(d.kind));

  const choose = (file: File | undefined): void => {
    if (!file) return;
    // 20 MB matches the server limit; failing here avoids a wasted upload.
    if (file.size > 20 * 1024 * 1024) {
      onToast("That file is larger than 20 MB");
      return;
    }
    upload.mutate(
      { file, label },
      {
        onSuccess: () => onToast(`${file.name} attached`),
        onSettled: () => {
          if (fileInput.current) fileInput.current.value = "";
        },
      },
    );
  };

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Files</h2>
        {canEdit && (
          <div className="flex items-center gap-2">
            <select
              className="field w-auto py-1 text-xs"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              aria-label="What is this file"
            >
              {LABELS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              {upload.isPending ? <Spinner className="size-3" /> : null}
              Attach
            </button>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx"
              onChange={(event) => choose(event.target.files?.[0])}
            />
          </div>
        )}
      </div>

      <ErrorNote error={upload.error} />

      {documents.isLoading ? (
        <div className="grid place-items-center py-6">
          <Spinner />
        </div>
      ) : all.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          {canEdit
            ? "Attach the purchase order, lorry receipt or anything else that belongs with this invoice."
            : "No files yet."}
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {generated.length > 0 && (
            <FileGroup title="Generated" files={generated} onDelete={undefined} onToast={onToast} />
          )}
          {attached.length > 0 && (
            <FileGroup
              title="Attached"
              files={attached}
              onDelete={
                canEdit
                  ? (id, name) =>
                      confirm(`Remove ${name}? This cannot be undone.`, () =>
                        remove.mutate(id, { onSuccess: () => onToast("File removed") }),
                      )
                  : undefined
              }
              onToast={onToast}
            />
          )}
        </div>
      )}
      {dialog}
    </section>
  );
}

function FileGroup({
  title,
  files,
  onDelete,
}: {
  title: string;
  files: Array<{
    id: string;
    filename: string;
    label?: string | null;
    contentType: string;
    sizeBytes: number;
    createdAt: string;
  }>;
  onDelete?: ((id: string, name: string) => void) | undefined;
  onToast: (message: string) => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {files.map((file) => (
          <li key={file.id} className="flex items-center gap-2 text-sm">
            <FileIcon contentType={file.contentType} />
            <a
              // Authenticated route: the session cookie travels with it.
              href={`/api/v1/documents/${file.id}`}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-brand-700 hover:underline"
            >
              {file.label ? `${file.label} — ` : ""}
              {file.filename}
            </a>
            <span className="shrink-0 text-xs text-slate-400">
              {(file.sizeBytes / 1024).toFixed(0)} KB · {formatDateTime(file.createdAt)}
            </span>
            {onDelete && (
              <button
                type="button"
                className="btn-ghost shrink-0 px-1.5 text-muted hover:text-red-600"
                aria-label={`Remove ${file.filename}`}
                onClick={() => onDelete(file.id, file.filename)}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FileIcon({ contentType }: { contentType: string }) {
  const isImage = contentType.startsWith("image/");
  return (
    <svg
      className="size-4 shrink-0 text-slate-400"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      {isImage ? (
        <path
          fillRule="evenodd"
          d="M3 4a2 2 0 012-2h10a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V4zm3 8l2.5-3 2 2.5L13 8l3 4H6z"
          clipRule="evenodd"
        />
      ) : (
        <path
          fillRule="evenodd"
          d="M4 2a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V7l-5-5H4zm7 1.5V7h3.5L11 3.5zM6 10h8v1.5H6V10zm0 3h5v1.5H6V13z"
          clipRule="evenodd"
        />
      )}
    </svg>
  );
}
