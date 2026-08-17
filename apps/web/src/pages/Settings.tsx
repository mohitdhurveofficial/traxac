import { useSearchParams } from "react-router-dom";
import { useSession } from "../api/hooks.js";
import { Page, PageHeader } from "../components/shell.js";
import { TabBar } from "../components/forms.js";
import { useToast } from "../components/ui.js";
import { GstinSwitcher } from "../components/gstin-switcher.js";
import { BusinessSettings } from "./settings/Business.js";
import { TaxSettings } from "./settings/Tax.js";
import { TeamSettings } from "./settings/Team.js";
import { NumberingSettings } from "./settings/Numbering.js";
import { SecuritySettings } from "./settings/Security.js";
import { GstConnectionSettings } from "./settings/GstConnection.js";
import { LogisticsSettings } from "./settings/Logistics.js";
import { NotificationSettings } from "./settings/Notifications.js";

/**
 * Settings.
 *
 * Ordered by how often a business owner touches them: company details near
 * the top, the GST API connection near the bottom. The connection tab is
 * where every piece of protocol vocabulary lives, so nobody meets a client
 * secret unless they went looking for one.
 */
const TABS = [
  { key: "business", label: "Business" },
  { key: "tax", label: "Tax & terms" },
  { key: "numbering", label: "Numbering" },
  { key: "logistics", label: "Transport" },
  { key: "team", label: "People" },
  { key: "notifications", label: "Alerts" },
  { key: "security", label: "Security" },
  { key: "gst", label: "GST connection" },
] as const;

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "business";
  const { toast, show } = useToast();
  const session = useSession();

  return (
    <>
      <PageHeader title="Settings" subtitle={session.data?.user.tenantName ?? undefined}>
        <TabBar
          tabs={TABS}
          active={tab}
          onChange={(key) => setParams({ tab: key }, { replace: true })}
        />
      </PageHeader>

      <Page>
        {/* On a small screen the sidebar switcher is out of sight, so the
            active registration is repeated where settings are changed. */}
        {session.data && session.data.gstins.length > 1 && (
          <div className="mb-4 -mx-3 lg:hidden">
            <GstinSwitcher session={session.data} />
          </div>
        )}

        {tab === "business" && <BusinessSettings show={show} />}
        {tab === "tax" && <TaxSettings show={show} />}
        {tab === "numbering" && <NumberingSettings show={show} />}
        {tab === "logistics" && <LogisticsSettings show={show} />}
        {tab === "team" && <TeamSettings show={show} />}
        {tab === "notifications" && <NotificationSettings show={show} />}
        {tab === "security" && <SecuritySettings show={show} />}
        {tab === "gst" && <GstConnectionSettings show={show} />}
      </Page>
      {toast}
    </>
  );
}
