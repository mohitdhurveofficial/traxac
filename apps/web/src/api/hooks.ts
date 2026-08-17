import {
  useMutation, useQuery, useQueryClient, type UseQueryOptions,
} from "@tanstack/react-query";
import { del, get, patch, post, put } from "./client.js";
import type {
  Branch, Credential, Dashboard, Gstin, InvoiceDetail, InvoiceSummary, Notification,
  Paginated, Party, PartyDetail, Product, SessionUser, StateRef, TaxTotals,
  TimelineEntry, Transporter, UnitRef, Vehicle,
} from "./types.js";

/**
 * Query keys are shaped `[resource, ...scope]` so a mutation can invalidate a
 * whole resource with one call instead of listing every variant.
 */
export const keys = {
  me: ["me"] as const,
  dashboard: (fy?: string) => ["dashboard", fy ?? "current"] as const,
  invoices: (params?: unknown) => ["invoices", params] as const,
  invoice: (id: string) => ["invoice", id] as const,
  timeline: (id: string) => ["invoice", id, "timeline"] as const,
  parties: (params?: unknown) => ["parties", params] as const,
  party: (id: string) => ["party", id] as const,
  products: (params?: unknown) => ["products", params] as const,
  gstins: ["gstins"] as const,
  branches: (gstinId?: string) => ["branches", gstinId ?? "all"] as const,
  transporters: (q?: string) => ["transporters", q ?? ""] as const,
  vehicles: (q?: string) => ["vehicles", q ?? ""] as const,
  notifications: ["notifications"] as const,
  credentials: ["credentials"] as const,
  states: ["ref", "states"] as const,
  units: ["ref", "units"] as const,
  settings: ["settings"] as const,
};

/* --------------------------------- Auth --------------------------------- */

export function useSession(options?: Partial<UseQueryOptions<{ user: SessionUser }>>) {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => get<{ user: SessionUser }>("/v1/auth/me"),
    retry: false,
    staleTime: 5 * 60_000,
    ...options,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      post<{ user: SessionUser }>("/v1/auth/login", input),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string; email: string; password: string; businessName: string;
    }) => post<{ user: SessionUser }>("/v1/auth/register", input),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<{ ok: true }>("/v1/auth/logout"),
    onSuccess: () => qc.clear(),
  });
}

/* ------------------------------- Dashboard ------------------------------ */

export function useDashboard(fy?: string) {
  return useQuery({
    queryKey: keys.dashboard(fy),
    queryFn: () => get<Dashboard>("/v1/reports/dashboard", fy ? { fy } : undefined),
  });
}

/* -------------------------------- Invoices ------------------------------ */

export interface InvoiceFilters {
  q?: string;
  status?: string;
  einvoiceStatus?: string;
  ewbStatus?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export function useInvoices(filters: InvoiceFilters) {
  return useQuery({
    queryKey: keys.invoices(filters),
    queryFn: () => get<Paginated<InvoiceSummary>>("/v1/invoices", filters as never),
    placeholderData: (previous) => previous,
  });
}

export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: keys.invoice(id ?? ""),
    queryFn: () => get<InvoiceDetail>(`/v1/invoices/${id}`),
    enabled: Boolean(id),
    // Compliance work happens in the background; poll while it is in flight.
    refetchInterval: (query) => {
      const data = query.state.data as InvoiceDetail | undefined;
      if (!data) return false;
      const pending = ["queued", "processing", "pending"];
      return pending.includes(data.invoice.einvoiceStatus)
        || pending.includes(data.invoice.ewbStatus)
        ? 3000
        : false;
    },
  });
}

export function useInvoiceTimeline(id: string | undefined) {
  return useQuery({
    queryKey: keys.timeline(id ?? ""),
    queryFn: () => get<{ entries: TimelineEntry[]; ewbHistory: unknown[] }>(
      `/v1/invoices/${id}/timeline`,
    ),
    enabled: Boolean(id),
  });
}

export function useInvoicePreview() {
  return useMutation({
    mutationFn: (input: unknown) => post<TaxTotals>("/v1/invoices/preview", input),
  });
}

export function useNextInvoiceNumber(gstinId: string | undefined, docType = "invoice") {
  return useQuery({
    queryKey: ["next-number", gstinId, docType],
    queryFn: () => get<{ invoiceNumber: string; financialYear: string }>(
      "/v1/invoices/next-number", { gstinId: gstinId as string, docType },
    ),
    enabled: Boolean(gstinId),
  });
}

export function useSaveInvoice(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      id ? put<InvoiceDetail>(`/v1/invoices/${id}`, input)
         : post<InvoiceDetail>("/v1/invoices", input),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.setQueryData(keys.invoice(data.invoice.id), data);
    },
  });
}

export function useInvoiceAction(id: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: keys.invoice(id) });
    void qc.invalidateQueries({ queryKey: keys.timeline(id) });
    void qc.invalidateQueries({ queryKey: ["invoices"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  return {
    finalize: useMutation({
      mutationFn: (body: { generateEinvoice?: boolean; generateEwb?: boolean }) =>
        post<{ invoice: unknown; queued: string[] }>(`/v1/invoices/${id}/finalize`, body),
      onSuccess: invalidate,
    }),
    cancel: useMutation({
      mutationFn: (body: { reasonCode: string; remark: string }) =>
        post(`/v1/invoices/${id}/cancel`, body),
      onSuccess: invalidate,
    }),
    duplicate: useMutation({
      mutationFn: () => post<InvoiceDetail>(`/v1/invoices/${id}/duplicate`),
      onSuccess: invalidate,
    }),
    recordPayment: useMutation({
      mutationFn: (body: { amount: number; method: string; reference?: string }) =>
        post(`/v1/invoices/${id}/payments`, body),
      onSuccess: invalidate,
    }),
    generateEinvoice: useMutation({
      mutationFn: (body: { withEwayBill: boolean }) =>
        post<{ jobId: string }>(`/v1/invoices/${id}/einvoice`, body),
      onSuccess: invalidate,
    }),
    cancelEinvoice: useMutation({
      mutationFn: (body: { reasonCode: string; remark: string }) =>
        post(`/v1/invoices/${id}/einvoice/cancel`, body),
      onSuccess: invalidate,
    }),
    generateEwb: useMutation({
      mutationFn: (body: unknown) => post<{ jobId: string }>(`/v1/invoices/${id}/ewb`, body),
      onSuccess: invalidate,
    }),
    updatePartB: useMutation({
      mutationFn: (body: unknown) => post(`/v1/invoices/${id}/ewb/part-b`, body),
      onSuccess: invalidate,
    }),
    extendEwb: useMutation({
      mutationFn: (body: unknown) => post(`/v1/invoices/${id}/ewb/extend`, body),
      onSuccess: invalidate,
    }),
    cancelEwb: useMutation({
      mutationFn: (body: { reasonCode: string; remark: string }) =>
        post(`/v1/invoices/${id}/ewb/cancel`, body),
      onSuccess: invalidate,
    }),
    renderPdf: useMutation({
      mutationFn: () => post<{ jobId: string }>(`/v1/invoices/${id}/pdf`),
      onSuccess: invalidate,
    }),
  };
}

/* --------------------------------- Masters ------------------------------ */

export function useParties(params: { q?: string; page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: keys.parties(params),
    queryFn: () => get<Paginated<Party>>("/v1/parties", params),
    placeholderData: (previous) => previous,
  });
}

export function useParty(id: string | undefined) {
  return useQuery({
    queryKey: keys.party(id ?? ""),
    queryFn: () => get<PartyDetail>(`/v1/parties/${id}`),
    enabled: Boolean(id),
  });
}

export function useSaveParty(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      id ? patch<Party>(`/v1/parties/${id}`, input) : post<Party>("/v1/parties", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["parties"] }),
  });
}

export function useAddPartyAddress(partyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => post(`/v1/parties/${partyId}/addresses`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.party(partyId) }),
  });
}

export function useProducts(params: { q?: string; page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: keys.products(params),
    queryFn: () => get<Paginated<Product>>("/v1/products", params),
    placeholderData: (previous) => previous,
  });
}

export function useSaveProduct(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      id ? patch<Product>(`/v1/products/${id}`, input) : post<Product>("/v1/products", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["products"] }),
  });
}

export function useArchiveProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/v1/products/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["products"] }),
  });
}

export function useGstins() {
  return useQuery({
    queryKey: keys.gstins,
    queryFn: () => get<{ items: Gstin[] }>("/v1/gstins"),
    staleTime: 5 * 60_000,
  });
}

export function useSaveGstin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => post<Gstin>("/v1/gstins", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.gstins }),
  });
}

export function useBranches(gstinId?: string) {
  return useQuery({
    queryKey: keys.branches(gstinId),
    queryFn: () => get<{ items: Branch[] }>("/v1/branches", gstinId ? { gstinId } : undefined),
    staleTime: 5 * 60_000,
  });
}

export function useSaveBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => post<Branch>("/v1/branches", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["branches"] }),
  });
}

export function useTransporters(q?: string) {
  return useQuery({
    queryKey: keys.transporters(q),
    queryFn: () => get<Paginated<Transporter>>("/v1/transporters", { q, limit: 50 }),
    staleTime: 60_000,
  });
}

export function useSaveTransporter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => post<Transporter>("/v1/transporters", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["transporters"] }),
  });
}

export function useVehicles(q?: string) {
  return useQuery({
    queryKey: keys.vehicles(q),
    queryFn: () => get<Paginated<Vehicle>>("/v1/vehicles", { q, limit: 50 }),
    staleTime: 60_000,
  });
}

export function useSaveVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => post<Vehicle>("/v1/vehicles", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["vehicles"] }),
  });
}

/* ------------------------------- Reference ------------------------------ */

export function useStates() {
  return useQuery({
    queryKey: keys.states,
    queryFn: () => get<{ items: StateRef[] }>("/v1/reference/states"),
    staleTime: Infinity,
  });
}

export function useUnits() {
  return useQuery({
    queryKey: keys.units,
    queryFn: () => get<{ items: UnitRef[] }>("/v1/reference/units"),
    staleTime: Infinity,
  });
}

export function useHsnSearch(q: string) {
  return useQuery({
    queryKey: ["hsn", q],
    queryFn: () => get<{ items: Array<{ code: string; description: string; defaultGstRate: string | null }> }>(
      "/v1/reference/hsn", { q },
    ),
    enabled: q.trim().length >= 2,
    staleTime: 5 * 60_000,
  });
}

/* ----------------------------- Notifications ---------------------------- */

export function useNotifications() {
  return useQuery({
    queryKey: keys.notifications,
    queryFn: () => get<{ items: Notification[]; unread: number }>("/v1/notifications"),
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post("/v1/notifications/read-all"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.notifications }),
  });
}

/* ------------------------------- Settings ------------------------------- */

export function useSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: () => get<{
      business: { id: string; name: string; slug: string; plan: string };
      settings: Record<string, unknown> | null;
    }>("/v1/settings"),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => patch("/v1/settings", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.settings }),
  });
}

export function useCredentials() {
  return useQuery({
    queryKey: keys.credentials,
    queryFn: () => get<{ items: Credential[] }>("/v1/credentials"),
  });
}

export function useSaveCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => post("/v1/credentials", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.credentials }),
  });
}

export function useTestCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => post<{
      ok: boolean; verifiedAt?: string; error?: { code: string; message: string };
    }>(`/v1/credentials/${id}/test`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.credentials }),
  });
}

export function useDeleteCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/v1/credentials/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.credentials }),
  });
}
