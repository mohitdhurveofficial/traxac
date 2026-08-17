import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "./api/hooks.js";
import { Shell } from "./components/shell.js";
import { Spinner } from "./components/ui.js";
import { LoginPage } from "./pages/Login.js";
import { InvoicesPage } from "./pages/Invoices.js";
import { InvoiceEditorPage } from "./pages/InvoiceEditor.js";
import { InvoiceDetailPage } from "./pages/InvoiceDetail.js";
import { CustomersPage } from "./pages/Customers.js";
import { ItemsPage } from "./pages/Items.js";
import { ReportsPage } from "./pages/Reports.js";
import { SettingsPage } from "./pages/Settings.js";

/**
 * Routing.
 *
 * `/invoices` is home rather than a separate dashboard: the list already
 * answers "what is going on", and one fewer screen is one fewer decision.
 */
export function App() {
  const session = useSession();
  const location = useLocation();

  if (session.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center text-muted">
        <Spinner className="size-6" />
      </div>
    );
  }

  const user = session.data?.user;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location }} />} />
      </Routes>
    );
  }

  return (
    <Shell user={user}>
      <Routes>
        <Route path="/" element={<Navigate to="/invoices" replace />} />
        <Route path="/login" element={<Navigate to="/invoices" replace />} />
        <Route path="/invoices" element={<InvoicesPage />} />
        <Route path="/invoices/new" element={<InvoiceEditorPage />} />
        <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="/invoices/:id/edit" element={<InvoiceEditorPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/invoices" replace />} />
      </Routes>
    </Shell>
  );
}
