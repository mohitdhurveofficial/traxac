import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { Job, AddressSnapshot } from "@traxac/database";
import { systemContext, type Container, type InvoiceDetail } from "@traxac/core";
import { amountInWords, formatINR, GST_STATE_CODES, toIsoDate, toRupees } from "@traxac/shared";

/**
 * Invoice PDF.
 *
 * The layout follows what a GST invoice must show — both parties with GSTINs,
 * place of supply, HSN-wise tax breakup, amount in words — plus the IRN, the
 * acknowledgement and the signed QR code when the IRP has issued them.
 *
 * The QR image is rendered from the **signed payload the portal returned**. It
 * is never constructed locally, because a locally-built QR would not verify.
 */

const PAGE_MARGIN = 36;
const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const ACCENT = "#1d4ed8";

export async function handleRenderInvoicePdf(job: Job, container: Container): Promise<unknown> {
  const payload = job.payload as { invoiceId: string; tenantId: string };
  const ctx = systemContext(payload.tenantId);
  const detail = await container.invoices.get(ctx, payload.invoiceId);
  const einvoice = detail.einvoice;

  const qrDataUrl = einvoice?.signedQrCode
    ? await QRCode.toDataURL(einvoice.signedQrCode, {
        errorCorrectionLevel: "M",
        margin: 0,
        width: 320,
      })
    : null;

  const pdf = await renderInvoicePdf(detail, qrDataUrl);

  const stored = await container.documents.store(ctx, {
    kind: "invoice_pdf",
    entityType: "invoice",
    entityId: detail.invoice.id,
    filename: `${detail.invoice.invoiceNumber.replace(/[^\w.-]+/g, "-")}.pdf`,
    contentType: "application/pdf",
    body: pdf,
    replace: true,
  });

  // Keep the signed JSON alongside the PDF: it is the legally meaningful
  // artefact, and the PDF is only a rendering of it.
  if (einvoice?.signedInvoice) {
    await container.documents.store(ctx, {
      kind: "einvoice_json",
      entityType: "invoice",
      entityId: detail.invoice.id,
      filename: `${detail.invoice.invoiceNumber.replace(/[^\w.-]+/g, "-")}-signed.json`,
      contentType: "application/json",
      body: JSON.stringify(
        {
          irn: einvoice.irn,
          ackNumber: einvoice.ackNumber,
          ackDate: einvoice.ackDate,
          signedInvoice: einvoice.signedInvoice,
          signedQrCode: einvoice.signedQrCode,
        },
        null,
        2,
      ),
      replace: true,
    });
  }

  return { documentId: stored.id, sizeBytes: stored.sizeBytes };
}

export function renderInvoicePdf(detail: InvoiceDetail, qrDataUrl: string | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      draw(doc, detail, qrDataUrl);
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

type Doc = InstanceType<typeof PDFDocument>;

function draw(doc: Doc, detail: InvoiceDetail, qrDataUrl: string | null): void {
  const { invoice, lines, charges, hsnSummary, einvoice, ewayBill } = detail;
  const pageWidth = doc.page.width - PAGE_MARGIN * 2;
  const isIgst = invoice.igst > 0;

  /* ------------------------------- Header ------------------------------ */

  doc
    .fillColor(INK)
    .fontSize(16)
    .font("Helvetica-Bold")
    .text(invoice.billFrom.name, PAGE_MARGIN, PAGE_MARGIN, { width: pageWidth * 0.62 });
  doc
    .fontSize(8.5)
    .font("Helvetica")
    .fillColor(MUTED)
    .text(addressLines(invoice.billFrom).join("\n"), { width: pageWidth * 0.62 })
    .text(`GSTIN: ${invoice.billFrom.gstin ?? "—"}`, { width: pageWidth * 0.62 });

  const titleFor: Record<string, string> = {
    invoice: "TAX INVOICE",
    credit_note: "CREDIT NOTE",
    debit_note: "DEBIT NOTE",
    delivery_challan: "DELIVERY CHALLAN",
    bill_of_supply: "BILL OF SUPPLY",
  };
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor(ACCENT)
    .text(titleFor[invoice.docType] ?? "TAX INVOICE", PAGE_MARGIN + pageWidth * 0.62, PAGE_MARGIN, {
      width: pageWidth * 0.38,
      align: "right",
    });
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(INK)
    .text(invoice.invoiceNumber, { width: pageWidth * 0.38, align: "right" })
    .fillColor(MUTED)
    .text(toIsoDate(invoice.invoiceDate), { width: pageWidth * 0.38, align: "right" });
  if (invoice.status === "cancelled") {
    doc
      .fillColor("#b91c1c")
      .font("Helvetica-Bold")
      .text("CANCELLED", { width: pageWidth * 0.38, align: "right" });
  }

  let y = Math.max(doc.y, PAGE_MARGIN + 72) + 8;
  rule(doc, y);
  y += 10;

  /* ------------------------- Compliance strip -------------------------- */

  if (einvoice?.irn || ewayBill?.ewbNumber) {
    const boxHeight = qrDataUrl ? 92 : 46;
    doc.roundedRect(PAGE_MARGIN, y, pageWidth, boxHeight, 4).fillAndStroke("#f8fafc", LINE);

    const textWidth = qrDataUrl ? pageWidth - 104 : pageWidth - 16;
    let ty = y + 9;
    if (einvoice?.irn) {
      label(doc, "IRN", PAGE_MARGIN + 10, ty);
      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor(INK)
        .text(einvoice.irn, PAGE_MARGIN + 10, ty + 9, { width: textWidth });
      ty = doc.y + 4;
      doc
        .fontSize(8)
        .fillColor(MUTED)
        .text(
          `Ack No ${einvoice.ackNumber ?? "—"}   •   Ack Date ${einvoice.ackDate ? toIsoDate(einvoice.ackDate) : "—"}`,
          PAGE_MARGIN + 10,
          ty,
          { width: textWidth },
        );
      ty = doc.y + 4;
    }
    if (ewayBill?.ewbNumber) {
      doc
        .fontSize(8)
        .fillColor(MUTED)
        .text(
          `e-Way Bill ${ewayBill.ewbNumber}` +
            (ewayBill.validUntil ? `   •   valid to ${toIsoDate(ewayBill.validUntil)}` : "") +
            (ewayBill.vehicleNo ? `   •   ${ewayBill.vehicleNo}` : ""),
          PAGE_MARGIN + 10,
          ty,
          { width: textWidth },
        );
    }
    if (qrDataUrl) {
      const image = Buffer.from(qrDataUrl.split(",")[1] ?? "", "base64");
      doc.image(image, PAGE_MARGIN + pageWidth - 86, y + 8, { width: 76, height: 76 });
    }
    y += boxHeight + 12;
  }

  /* ------------------------------ Parties ------------------------------ */

  const columns = partyColumns(invoice);
  const columnWidth = pageWidth / columns.length - 8;
  const partyTop = y;
  let partyBottom = y;
  columns.forEach((column, index) => {
    const x = PAGE_MARGIN + index * (columnWidth + 8);
    label(doc, column.title, x, partyTop);
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(INK)
      .text(column.address.name, x, partyTop + 11, { width: columnWidth });
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(MUTED)
      .text(addressLines(column.address).join("\n"), { width: columnWidth });
    if (column.address.gstin) {
      doc.fillColor(INK).text(`GSTIN ${column.address.gstin}`, { width: columnWidth });
    }
    partyBottom = Math.max(partyBottom, doc.y);
  });

  y = partyBottom + 8;
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      [
        `Place of supply: ${invoice.placeOfSupply} — ${GST_STATE_CODES[invoice.placeOfSupply] ?? ""}`,
        invoice.reverseCharge ? "Reverse charge: Yes" : null,
        invoice.poNumber ? `PO ${invoice.poNumber}` : null,
        invoice.dueDate ? `Due ${toIsoDate(invoice.dueDate)}` : null,
      ]
        .filter(Boolean)
        .join("   •   "),
      PAGE_MARGIN,
      y,
      { width: pageWidth },
    );
  y = doc.y + 10;

  /* ------------------------------- Items ------------------------------- */

  const itemColumns = isIgst
    ? [
        { key: "sl", label: "#", width: 18, align: "left" as const },
        { key: "desc", label: "Description", width: 168, align: "left" as const },
        { key: "hsn", label: "HSN", width: 46, align: "left" as const },
        { key: "qty", label: "Qty", width: 52, align: "right" as const },
        { key: "rate", label: "Rate", width: 58, align: "right" as const },
        { key: "taxable", label: "Taxable", width: 66, align: "right" as const },
        { key: "igst", label: "IGST", width: 66, align: "right" as const },
        { key: "total", label: "Amount", width: 69, align: "right" as const },
      ]
    : [
        { key: "sl", label: "#", width: 18, align: "left" as const },
        { key: "desc", label: "Description", width: 150, align: "left" as const },
        { key: "hsn", label: "HSN", width: 44, align: "left" as const },
        { key: "qty", label: "Qty", width: 48, align: "right" as const },
        { key: "rate", label: "Rate", width: 54, align: "right" as const },
        { key: "taxable", label: "Taxable", width: 62, align: "right" as const },
        { key: "cgst", label: "CGST", width: 56, align: "right" as const },
        { key: "sgst", label: "SGST", width: 56, align: "right" as const },
        { key: "total", label: "Amount", width: 55, align: "right" as const },
      ];

  y = tableHeader(doc, itemColumns, y);
  lines.forEach((line, index) => {
    y = ensureSpace(doc, y, 30, () => tableHeader(doc, itemColumns, PAGE_MARGIN));
    const cells: Record<string, string> = {
      sl: String(index + 1),
      desc: line.name,
      hsn: line.hsnSac,
      qty: `${trimNumber(line.quantity)} ${line.unit}`,
      rate: money(line.unitPrice),
      taxable: money(line.taxableValue),
      igst: `${money(line.igst)}\n${Number(line.gstRate)}%`,
      cgst: `${money(line.cgst)}\n${Number(line.gstRate) / 2}%`,
      sgst: `${money(line.sgst)}\n${Number(line.gstRate) / 2}%`,
      total: money(line.lineTotal),
    };
    y = tableRow(doc, itemColumns, cells, y, line.description);
  });

  charges.forEach((charge) => {
    y = ensureSpace(doc, y, 24, () => tableHeader(doc, itemColumns, PAGE_MARGIN));
    const cells: Record<string, string> = {
      sl: "",
      desc: charge.label,
      hsn: charge.hsnSac ?? "",
      qty: "",
      rate: "",
      taxable: money(charge.amount),
      igst: money(charge.igst),
      cgst: money(charge.cgst),
      sgst: money(charge.sgst),
      total: money(charge.amount + charge.taxAmount),
    };
    y = tableRow(doc, itemColumns, cells, y);
  });

  rule(doc, y);
  y += 10;

  /* ------------------------------ Totals ------------------------------- */

  const totalsWidth = 210;
  const totalsX = PAGE_MARGIN + pageWidth - totalsWidth;
  // The column must add up on the page. `taxableValue` is already net of
  // discount, so the gross line is shown above it rather than the discount
  // being subtracted again below.
  const totalRows: Array<[string, number, boolean?]> = [
    ...(invoice.totalDiscount
      ? [
          ["Gross value", invoice.grossValue] as [string, number],
          ["Less discount", -invoice.totalDiscount] as [string, number],
        ]
      : []),
    ["Taxable value", invoice.taxableValue],
    ...(invoice.otherCharges ? [["Other charges", invoice.otherCharges] as [string, number]] : []),
    ...(isIgst
      ? [["IGST", invoice.igst] as [string, number]]
      : [["CGST", invoice.cgst] as [string, number], ["SGST", invoice.sgst] as [string, number]]),
    ...(invoice.cess + invoice.cessNonAdvol
      ? [["Cess", invoice.cess + invoice.cessNonAdvol] as [string, number]]
      : []),
    ...(invoice.roundOff ? [["Round off", invoice.roundOff] as [string, number]] : []),
    ["Total", invoice.grandTotal, true],
  ];

  const totalsTop = y;
  for (const [caption, amount, emphasis] of totalRows) {
    doc
      .font(emphasis ? "Helvetica-Bold" : "Helvetica")
      .fontSize(emphasis ? 10 : 8.5)
      .fillColor(emphasis ? INK : MUTED)
      .text(caption, totalsX, y, { width: totalsWidth * 0.5 });
    doc.fillColor(INK).text(formatINR(amount), totalsX + totalsWidth * 0.5, y, {
      width: totalsWidth * 0.5,
      align: "right",
    });
    y += emphasis ? 16 : 13;
  }

  // Amount in words sits beside the totals block.
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(MUTED)
    .text("Amount in words", PAGE_MARGIN, totalsTop, { width: pageWidth - totalsWidth - 16 });
  doc
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .fillColor(INK)
    .text(amountInWords(invoice.grandTotal), PAGE_MARGIN, totalsTop + 11, {
      width: pageWidth - totalsWidth - 16,
    });
  y = Math.max(y, doc.y) + 10;

  /* --------------------------- HSN tax summary -------------------------- */

  if (hsnSummary.length > 1) {
    y = ensureSpace(doc, y, 90);
    label(doc, "HSN / SAC summary", PAGE_MARGIN, y);
    y += 12;
    const hsnColumns = [
      { key: "hsn", label: "HSN", width: 70, align: "left" as const },
      { key: "taxable", label: "Taxable", width: 90, align: "right" as const },
      { key: "rate", label: "Rate", width: 50, align: "right" as const },
      ...(isIgst
        ? [{ key: "igst", label: "IGST", width: 90, align: "right" as const }]
        : [
            { key: "cgst", label: "CGST", width: 80, align: "right" as const },
            { key: "sgst", label: "SGST", width: 80, align: "right" as const },
          ]),
      { key: "total", label: "Total", width: 90, align: "right" as const },
    ];
    y = tableHeader(doc, hsnColumns, y);
    for (const row of hsnSummary) {
      y = tableRow(
        doc,
        hsnColumns,
        {
          hsn: row.hsnSac,
          taxable: money(row.taxableValue),
          rate: `${row.gstRate}%`,
          igst: money(row.igst),
          cgst: money(row.cgst),
          sgst: money(row.sgst),
          total: money(row.total),
        },
        y,
      );
    }
    y += 8;
  }

  /* ------------------------------- Footer ------------------------------- */

  y = ensureSpace(doc, y, 90);
  if (invoice.notes || invoice.terms) {
    rule(doc, y);
    y += 8;
    if (invoice.notes) {
      label(doc, "Notes", PAGE_MARGIN, y);
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(MUTED)
        .text(invoice.notes, PAGE_MARGIN, y + 11, { width: pageWidth * 0.6 });
      y = doc.y + 6;
    }
    if (invoice.terms) {
      label(doc, "Terms", PAGE_MARGIN, y);
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(MUTED)
        .text(invoice.terms, PAGE_MARGIN, y + 11, { width: pageWidth * 0.6 });
      y = doc.y + 6;
    }
  }

  const signatureTop = Math.min(Math.max(y + 12, doc.page.height - 118), doc.page.height - 118);
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(MUTED)
    .text(`For ${invoice.billFrom.name}`, PAGE_MARGIN + pageWidth - 180, signatureTop, {
      width: 180,
      align: "right",
      lineBreak: false,
    })
    .text("Authorised signatory", PAGE_MARGIN + pageWidth - 180, doc.page.height - 74, {
      width: 180,
      align: "right",
      lineBreak: false,
    });

  // Page numbers, added once the page count is known. The bottom margin is
  // dropped first: writing inside it would make pdfkit start another page,
  // which is how a stray blank trailing page appears.
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index++) {
    doc.switchToPage(range.start + index);
    doc.page.margins.bottom = 0;
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(MUTED)
      .text(
        `${invoice.invoiceNumber}   •   Page ${index + 1} of ${range.count}` +
          (einvoice?.irn ? "   •   e-Invoice generated on the Government IRP" : ""),
        PAGE_MARGIN,
        doc.page.height - 42,
        { width: pageWidth, align: "center", lineBreak: false },
      );
  }
}

/* ------------------------------ primitives ------------------------------ */

interface Column {
  key: string;
  label: string;
  width: number;
  align: "left" | "right";
}

function tableHeader(doc: Doc, columns: Column[], y: number): number {
  doc
    .rect(
      PAGE_MARGIN,
      y,
      columns.reduce((s, c) => s + c.width, 0),
      16,
    )
    .fill("#f3f4f6");
  let x = PAGE_MARGIN;
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED);
  for (const column of columns) {
    doc.text(column.label.toUpperCase(), x + 4, y + 5, {
      width: column.width - 8,
      align: column.align,
    });
    x += column.width;
  }
  return y + 18;
}

function tableRow(
  doc: Doc,
  columns: Column[],
  cells: Record<string, string>,
  y: number,
  subtitle?: string | null,
): number {
  let x = PAGE_MARGIN;
  let height = 12;
  doc.font("Helvetica").fontSize(8).fillColor(INK);
  for (const column of columns) {
    const value = cells[column.key] ?? "";
    doc.text(value, x + 4, y, { width: column.width - 8, align: column.align });
    height = Math.max(height, doc.heightOfString(value, { width: column.width - 8 }));
    x += column.width;
  }
  let next = y + height + 3;
  if (subtitle) {
    const descColumn = columns.find((c) => c.key === "desc");
    if (descColumn) {
      doc
        .fontSize(7)
        .fillColor(MUTED)
        .text(subtitle, PAGE_MARGIN + 22, next - 1, {
          width: descColumn.width - 8,
        });
      next = doc.y + 3;
    }
  }
  doc
    .moveTo(PAGE_MARGIN, next - 1)
    .lineTo(PAGE_MARGIN + columns.reduce((s, c) => s + c.width, 0), next - 1)
    .strokeColor(LINE)
    .lineWidth(0.5)
    .stroke();
  return next + 2;
}

function rule(doc: Doc, y: number): void {
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(doc.page.width - PAGE_MARGIN, y)
    .strokeColor(LINE)
    .lineWidth(0.7)
    .stroke();
}

function label(doc: Doc, text: string, x: number, y: number): void {
  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .fillColor(MUTED)
    .text(text.toUpperCase(), x, y, { characterSpacing: 0.4 });
}

/** Start a new page when the remaining space is too small for the next block. */
function ensureSpace(doc: Doc, y: number, needed: number, onNewPage?: () => number): number {
  if (y + needed < doc.page.height - 96) return y;
  doc.addPage();
  return onNewPage ? onNewPage() : PAGE_MARGIN;
}

function partyColumns(
  invoice: InvoiceDetail["invoice"],
): Array<{ title: string; address: AddressSnapshot }> {
  const columns: Array<{ title: string; address: AddressSnapshot }> = [
    { title: "Bill to", address: invoice.billTo },
  ];
  if (invoice.shipTo) columns.push({ title: "Ship to", address: invoice.shipTo });
  if (invoice.dispatchFrom) columns.push({ title: "Dispatch from", address: invoice.dispatchFrom });
  return columns;
}

function addressLines(address: AddressSnapshot): string[] {
  return [
    address.addressLine1,
    address.addressLine2 ?? "",
    `${address.city} ${address.pincode}`.trim(),
    GST_STATE_CODES[address.stateCode] ?? "",
    address.phone ?? "",
  ].filter((line) => line.trim().length > 0);
}

function money(paise: number): string {
  return toRupees(paise).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function trimNumber(value: string): string {
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : String(n);
}
