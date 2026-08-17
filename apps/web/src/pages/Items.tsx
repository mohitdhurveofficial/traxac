import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { UQC_UNITS } from "@traxac/shared";
import { useArchiveProduct, useProducts, useSaveProduct } from "../api/hooks.js";
import type { Product } from "../api/types.js";
import { Page, PageHeader } from "../components/shell.js";
import { Drawer, EmptyState, ErrorNote, Field, SearchInput, Spinner, useToast } from "../components/ui.js";
import { money } from "../lib/format.js";

/**
 * Items — products and services with their HSN and GST rate remembered, so a
 * repeat line is one keystroke rather than four fields.
 */
export function ItemsPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const { toast, show } = useToast();

  const products = useProducts({ q, limit: 50 });
  const archive = useArchiveProduct();

  return (
    <>
      <PageHeader
        title="Items"
        subtitle={products.data ? `${products.data.total} saved` : undefined}
        actions={
          <button type="button" className="btn-primary" onClick={() => setEditing("new")}>
            Add item
          </button>
        }
      >
        <div className="sm:max-w-sm">
          <SearchInput value={q} placeholder="Name, SKU or HSN…"
            onChange={(next) => setParams(next ? { q: next } : {}, { replace: true })} />
        </div>
      </PageHeader>

      <Page>
        <ErrorNote error={products.error} />
        {products.isLoading ? (
          <div className="grid place-items-center py-24 text-muted"><Spinner className="size-6" /></div>
        ) : (products.data?.items.length ?? 0) === 0 ? (
          <div className="card">
            <EmptyState
              title={q ? "No items match this" : "No items yet"}
              description="Save what you sell once — HSN and GST rate come along automatically next time."
              action={<button type="button" className="btn-primary" onClick={() => setEditing("new")}>
                Add item
              </button>}
            />
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-slate-50 text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium">HSN/SAC</th>
                  <th className="px-4 py-2.5 font-medium">Unit</th>
                  <th className="px-4 py-2.5 text-right font-medium">GST</th>
                  <th className="px-4 py-2.5 text-right font-medium">Price</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {products.data?.items.map((product) => (
                  <tr key={product.id} className="hover:bg-slate-50">
                    <td className="cursor-pointer px-4 py-3" onClick={() => setEditing(product)}>
                      <p className="font-medium">{product.name}</p>
                      {product.sku && <p className="text-xs text-muted">SKU {product.sku}</p>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{product.hsnSac}</td>
                    <td className="px-4 py-3 text-muted">{product.unit}</td>
                    <td className="px-4 py-3 text-right">{Number(product.gstRate)}%</td>
                    <td className="px-4 py-3 text-right font-medium">{money(product.unitPrice)}</td>
                    <td className="px-2 py-3">
                      <button type="button" aria-label={`Remove ${product.name}`}
                        className="btn-ghost px-1.5 text-muted hover:text-red-600"
                        onClick={() => archive.mutate(product.id, {
                          onSuccess: () => show(`${product.name} removed`),
                        })}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Page>

      <ProductForm
        product={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); show("Item saved"); }}
      />
      {toast}
    </>
  );
}

function ProductForm({
  product, open, onClose, onSaved,
}: { product: Product | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const save = useSaveProduct(product?.id);
  return (
    <Drawer open={open} onClose={onClose} title={product ? "Edit item" : "Add item"}>
      <form className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          save.mutate({
            name: String(data.get("name")),
            description: String(data.get("description") || ""),
            sku: String(data.get("sku") || ""),
            hsnSac: String(data.get("hsnSac")),
            unit: String(data.get("unit")),
            unitPrice: Number(data.get("unitPrice") || 0),
            gstRate: Number(data.get("gstRate") || 0),
            cessRate: Number(data.get("cessRate") || 0),
            isService: data.get("isService") === "on",
          }, { onSuccess: onSaved });
        }}>
        <Field label="Item name" required>
          <input name="name" className="field" required defaultValue={product?.name} />
        </Field>
        <Field label="Description">
          <input name="description" className="field" defaultValue={product?.description ?? ""} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="HSN / SAC" required hint="4, 6 or 8 digits">
            <input name="hsnSac" className="field font-mono" required maxLength={8}
              defaultValue={product?.hsnSac} />
          </Field>
          <Field label="SKU"><input name="sku" className="field" defaultValue={product?.sku ?? ""} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="GST rate" required>
            <select name="gstRate" className="field" defaultValue={product?.gstRate ?? "18"}>
              {["0", "0.25", "3", "5", "12", "18", "28"].map((rate) => (
                <option key={rate} value={rate}>{rate}%</option>
              ))}
            </select>
          </Field>
          <Field label="Cess rate" hint="Leave 0 unless it applies">
            <input name="cessRate" type="number" step="0.01" className="field"
              defaultValue={product?.cessRate ?? "0"} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit">
            <select name="unit" className="field" defaultValue={product?.unit ?? "NOS"}>
              {UQC_UNITS.map((unit) => (
                <option key={unit.code} value={unit.code}>{unit.code} — {unit.description}</option>
              ))}
            </select>
          </Field>
          <Field label="Selling price ₹">
            <input name="unitPrice" type="number" step="0.01" className="field"
              defaultValue={product ? String(product.unitPrice / 100) : ""} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input name="isService" type="checkbox" className="size-4 rounded border-line"
            defaultChecked={product?.isService} />
          This is a service, not goods
        </label>
        <ErrorNote error={save.error} />
        <button type="submit" className="btn-primary w-full" disabled={save.isPending}>
          {save.isPending && <Spinner />} Save item
        </button>
      </form>
    </Drawer>
  );
}
