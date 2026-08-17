import { useState } from "react";
import { Link } from "react-router-dom";
import { useJobs, useRetryJob } from "../api/hooks.js";
import { Page, PageHeader } from "../components/shell.js";
import { TabBar } from "../components/forms.js";
import { Pill } from "../components/status.js";
import { EmptyState, ErrorNote, Spinner, useToast } from "../components/ui.js";
import { formatDateTime } from "../lib/format.js";

/**
 * Background work.
 *
 * PDFs, compliance calls and exports run off the request path, so when
 * something is "taking a while" this is the page that says why. Error text is
 * the safe message already stored on the job; portal payloads and credentials
 * never reach here.
 */
const KIND_LABEL: Record<string, string> = {
  "einvoice.generate": "Generate e-Invoice",
  "einvoice.cancel": "Cancel e-Invoice",
  "ewb.generate": "Generate e-Way Bill",
  "ewb.cancel": "Cancel e-Way Bill",
  "invoice.render_pdf": "Render invoice PDF",
  "notification.send": "Send notification",
  "maintenance.expire_ewbs": "Check e-Way Bill expiry",
};

const STATUS_TONE: Record<string, "neutral" | "progress" | "good" | "warn" | "bad"> = {
  pending: "neutral",
  retrying: "warn",
  running: "progress",
  done: "good",
  failed: "bad",
  cancelled: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  retrying: "Retrying",
  running: "Working",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

const FILTERS = [
  { key: "", label: "All" },
  { key: "pending", label: "Queued" },
  { key: "running", label: "Working" },
  { key: "failed", label: "Failed" },
  { key: "done", label: "Done" },
] as const;

export function ActivityPage() {
  const [status, setStatus] = useState("");
  const jobs = useJobs(status || undefined);
  const retry = useRetryJob();
  const { toast, show } = useToast();

  const counts = jobs.data?.counts ?? {};
  const failed = counts["failed"] ?? 0;

  return (
    <>
      <PageHeader
        title="Background work"
        subtitle={
          failed > 0
            ? `${failed} failed — these need attention`
            : "Everything the system is doing behind the scenes"
        }
      >
        <TabBar tabs={FILTERS} active={status} onChange={setStatus} />
      </PageHeader>

      <Page>
        <ErrorNote error={jobs.error} />

        {jobs.isLoading ? (
          <div className="grid place-items-center py-24 text-muted">
            <Spinner className="size-6" />
          </div>
        ) : (jobs.data?.items.length ?? 0) === 0 ? (
          <div className="card">
            <EmptyState
              title={status ? "Nothing in this state" : "Nothing running"}
              description="Jobs appear here when an invoice is issued or a document is generated."
            />
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-line bg-slate-50 text-left text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Task</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Queued</th>
                    <th className="px-4 py-2.5 font-medium">Finished</th>
                    <th className="px-4 py-2.5 text-right font-medium">Attempts</th>
                    <th className="w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {jobs.data?.items.map((job) => (
                    <tr key={job.id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium">{KIND_LABEL[job.kind] ?? job.kind}</p>
                        {job.error && (
                          <p className="mt-0.5 max-w-md text-xs text-red-600">{job.error}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone={STATUS_TONE[job.status] ?? "neutral"}>
                          {STATUS_LABEL[job.status] ?? job.status}
                        </Pill>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">
                        {formatDateTime(job.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">
                        {job.finishedAt ? formatDateTime(job.finishedAt) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted">
                        {job.attempts}/{job.maxAttempts}
                      </td>
                      <td className="px-2 py-3">
                        {job.status === "failed" && (
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            disabled={retry.isPending}
                            onClick={() =>
                              retry.mutate(job.id, { onSuccess: () => show("Queued again") })
                            }
                          >
                            Retry
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="mt-4 text-xs text-muted">
          Failed compliance work usually means the GST connection is not set up.{" "}
          <Link to="/settings?tab=gst" className="text-brand-700 hover:underline">
            Check the connection
          </Link>
          .
        </p>
      </Page>
      {toast}
    </>
  );
}
