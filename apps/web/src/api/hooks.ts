import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { del, get, patch, post, put } from "./client.js";
import { clearSessionToken, isNativeApp, storeSessionToken } from "../lib/platform.js";
import type {
  Branch,
  Credential,
  Dashboard,
  Gstin,
  InvoiceDetail,
  InvoiceSummary,
  Notification,
  CustomerLedger,
  Gstr1Summary,
  Paginated,
  Party,
  PartyDetail,
  PaymentTerm,
  Product,
  ProductHistory,
  DocumentRef,
  Receivables,
  SessionResponse,
  SessionUser,
  StateRef,
  TaxTotals,
  TimelineEntry,
  Transporter,
  UnitRef,
  Vehicle,
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

export function useSession(options?: Partial<UseQueryOptions<SessionResponse>>) {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => get<SessionResponse>("/v1/auth/me"),
    retry: false,
    staleTime: 5 * 60_000,
    ...options,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      post<{ user: SessionUser; token?: string }>("/v1/auth/login", input),
    /*
     * The browser already has the session as an httpOnly cookie and ignores
     * the token. The native shell keeps it, because a cookie cannot cross the
     * capacitor:// origin — see lib/platform.ts.
     */
    onSuccess: async (result) => {
      if (isNativeApp() && result.token) await storeSessionToken(result.token);
      void qc.invalidateQueries();
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; email: string; password: string; businessName: string }) =>
      post<{ user: SessionUser; token?: string }>("/v1/auth/register", input),
    onSuccess: async (result) => {
      if (isNativeApp() && result.token) await storeSessionToken(result.token);
      void qc.invalidateQueries();
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<{ ok: true }>("/v1/auth/logout"),
    // The server revokes the session; the app must also drop its stored copy,
    // or the next launch would present a token the server no longer honours.
    onSuccess: async () => {
      await clearSessionToken();
      qc.clear();
    },
  });
}

/** Switch the registration the session works in. */
export function useSetActiveGstin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (gstinId: string | null) => post("/v1/auth/active-gstin", { gstinId }),
    // Everything is scoped by registration, so the whole cache is stale.
    onSuccess: () => void qc.invalidateQueries(),
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
      const data = query.state.data;
      if (!data) return false;
      const pending = ["queued", "processing", "pending"];
      return pending.includes(data.invoice.einvoiceStatus) ||
        pending.includes(data.invoice.ewbStatus)
        ? 3000
        : false;
    },
  });
}

export function useInvoiceTimeline(id: string | undefined) {
  return useQuery({
    queryKey: keys.timeline(id ?? ""),
    queryFn: () =>
      get<{ entries: TimelineEntry[]; ewbHistory: unknown[] }>(`/v1/invoices/${id}/timeline`),
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
    queryFn: () =>
      get<{ invoiceNumber: string; financialYear: string }>("/v1/invoices/next-number", {
        gstinId: gstinId as string,
        docType,
      }),
    enabled: Boolean(gstinId),
  });
}

export function useSaveInvoice(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      id
        ? put<InvoiceDetail>(`/v1/invoices/${id}`, input)
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

export function useParties(
  params: { q?: string; page?: number; limit?: number; partyType?: string } = {},
) {
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
    queryFn: () =>
      get<{ items: Array<{ code: string; description: string; defaultGstRate: string | null }> }>(
        "/v1/reference/hsn",
        { q },
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
    queryFn: () =>
      get<{
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
    mutationFn: (id: string) =>
      post<{
        ok: boolean;
        verifiedAt?: string;
        error?: { code: string; message: string };
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

/* --------------------------- Ledgers & history -------------------------- */

export function useCustomerLedger(partyId: string | undefined) {
  return useQuery({
    queryKey: ["ledger", partyId],
    queryFn: () => get<CustomerLedger>(`/v1/parties/${partyId}/ledger`),
    enabled: Boolean(partyId),
  });
}

export function useProductHistory(productId: string | undefined) {
  return useQuery({
    queryKey: ["product-history", productId],
    queryFn: () => get<ProductHistory>(`/v1/products/${productId}/history`),
    enabled: Boolean(productId),
  });
}

export function useTransporterHistory(id: string | undefined) {
  return useQuery({
    queryKey: ["transporter-history", id],
    queryFn: () => get<Record<string, unknown>>(`/v1/transporters/${id}/history`),
    enabled: Boolean(id),
  });
}

export function useVehicleHistory(id: string | undefined) {
  return useQuery({
    queryKey: ["vehicle-history", id],
    queryFn: () => get<Record<string, unknown>>(`/v1/vehicles/${id}/history`),
    enabled: Boolean(id),
  });
}

export function useReceivables(gstinId?: string) {
  return useQuery({
    queryKey: ["receivables", gstinId ?? "all"],
    queryFn: () => get<Receivables>("/v1/receivables", gstinId ? { gstinId } : undefined),
  });
}

/* ----------------------------- Payment terms ---------------------------- */

export function usePaymentTerms() {
  return useQuery({
    queryKey: ["payment-terms"],
    queryFn: () => get<{ items: PaymentTerm[] }>("/v1/payment-terms"),
    staleTime: 5 * 60_000,
  });
}

export function useSavePaymentTerm(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      id ? patch(`/v1/payment-terms/${id}`, input) : post("/v1/payment-terms", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["payment-terms"] }),
  });
}

/* -------------------------------- GSTR-1 --------------------------------
 *
 * FROZEN AND OUT OF SCOPE. GSTR-1 preparation predates the product scope
 * lock, which places return preparation and filing permanently out of scope.
 * The backend service, routes and `gst_returns` data are retained
 * deliberately, but nothing here is wired to a screen and no navigation
 * exposes it — Ewayvo does not present GSTR-1 as a capability.
 *
 * Do not extend this, and do not surface it, without an explicit scope
 * unlock. See the scope-lock decision of 2026-08-18.
 */

export function useGstr1Preview(gstinId: string | undefined, period: string) {
  return useMutation({
    mutationFn: () => post<Gstr1Summary>("/v1/gstr1/preview", { gstinId, period }),
  });
}

/* -------------------------------- Import -------------------------------- */

export function useImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: string; rows: Array<Record<string, string>>; dryRun: boolean }) =>
      post<{
        total: number;
        created: number;
        updated: number;
        skipped: number;
        failed: number;
        results: Array<{ row: number; status: string; name?: string; message?: string }>;
      }>("/v1/import", input),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

/* ----------------------------- Tax settings ----------------------------- */

export function useTaxSettings(gstinId: string | undefined) {
  return useQuery({
    queryKey: ["tax-settings", gstinId],
    queryFn: () => get<Record<string, unknown>>(`/v1/gstins/${gstinId}/tax-settings`),
    enabled: Boolean(gstinId),
  });
}

export function useSaveTaxSettings(gstinId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => put(`/v1/gstins/${gstinId}/tax-settings`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tax-settings"] }),
  });
}

/* ------------------------------ HSN master ------------------------------ */

export function useSaveHsn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => post("/v1/reference/hsn", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["hsn"] }),
  });
}

/* --------------------------- Number series ------------------------------ */

export function useNumberSeries() {
  return useQuery({
    queryKey: ["number-series"],
    queryFn: () =>
      get<{
        items: Array<{
          id: string;
          docType: string;
          series: string;
          financialYear: string;
          prefix: string;
          suffix: string;
          padding: number;
          nextNumber: number;
        }>;
      }>("/v1/number-series"),
  });
}

export function useUpdateNumberSeries(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => patch(`/v1/number-series/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["number-series"] }),
  });
}

/* -------------------------------- Team ---------------------------------- */

export interface TeamMember {
  userId: string;
  email: string;
  name: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  joinedAt: string;
}

export function useTeam() {
  return useQuery({
    queryKey: ["team"],
    queryFn: () => get<{ items: TeamMember[] }>("/v1/auth/team"),
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; email: string; role: string }) =>
      post<{ userId: string; temporaryPassword?: string }>("/v1/auth/team", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["team"] }),
  });
}

export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      patch(`/v1/auth/team/${userId}`, { role }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["team"] }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => del(`/v1/auth/team/${userId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["team"] }),
  });
}

/* ------------------------------ API keys -------------------------------- */

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  role: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function useApiKeys() {
  return useQuery({
    queryKey: ["api-keys"],
    queryFn: () => get<{ items: ApiKeySummary[] }>("/v1/auth/api-keys"),
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; role: string }) =>
      post<{ id: string; key: string; prefix: string }>("/v1/auth/api-keys", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/v1/auth/api-keys/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

/* ------------------------------ Documents ------------------------------- */

export function useInvoiceDocuments(invoiceId: string | undefined) {
  return useQuery({
    queryKey: ["documents", invoiceId],
    queryFn: () => get<{ items: DocumentRef[] }>(`/v1/invoices/${invoiceId}/documents`),
    enabled: Boolean(invoiceId),
  });
}

export function useUploadDocument(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { file: File; label: string }) => {
      const body = new FormData();
      body.append("file", input.file);
      body.append("entityType", "invoice");
      body.append("entityId", invoiceId);
      body.append("label", input.label);
      // FormData must not carry a JSON content-type; the browser sets the
      // multipart boundary itself.
      const response = await fetch(`/api/v1/documents`, {
        method: "POST",
        credentials: "include",
        body,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(payload?.error?.message ?? "The file could not be uploaded");
      }
      return response.json() as Promise<DocumentRef>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documents", invoiceId] });
      void qc.invalidateQueries({ queryKey: keys.invoice(invoiceId) });
    },
  });
}

export function useDeleteDocument(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => del(`/v1/documents/${documentId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documents", invoiceId] });
      void qc.invalidateQueries({ queryKey: keys.invoice(invoiceId) });
    },
  });
}

/* --------------------------------- Jobs --------------------------------- */

export function useJobs(status?: string) {
  return useQuery({
    queryKey: ["jobs", status ?? "all"],
    queryFn: () =>
      get<{
        items: Array<{
          id: string;
          kind: string;
          status: string;
          attempts: number;
          maxAttempts: number;
          error: string | null;
          runAt: string;
          startedAt: string | null;
          finishedAt: string | null;
          createdAt: string;
        }>;
        counts: Record<string, number>;
      }>("/v1/jobs", status ? { status } : undefined),
    refetchInterval: 10_000,
  });
}

export function useRetryJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => post(`/v1/jobs/${id}/retry`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

/* ------------------------------- Reports -------------------------------- */

export function useReport<T>(name: string, params: Record<string, string | undefined> = {}) {
  return useQuery({
    queryKey: ["report", name, params],
    queryFn: () => get<T>(`/v1/reports/${name}`, params),
  });
}
