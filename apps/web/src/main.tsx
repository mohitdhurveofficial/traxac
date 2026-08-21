import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import { ApiError, setSessionExpiredHandler } from "./api/client.js";
import { ErrorBoundary } from "./components/boundary.js";
import { Toaster } from "./components/toaster.js";
import { ConnectionBanner } from "./components/connection.js";
import { loadSessionToken } from "./lib/platform.js";
import { notifyError } from "./lib/toast.js";
import "./index.css";

const queryClient = new QueryClient({
  // Any failed action reports itself, so a button can never look like it
  // worked when it did not. Validation failures are the exception: those are
  // shown against the individual fields that need fixing.
  mutationCache: new MutationCache({
    onError: (error) => {
      // 422 lands on the fields; 401 is either the sign-in form's own message
      // or the session-expiry redirect. Neither needs a toast as well.
      if (error instanceof ApiError && (error.status === 422 || error.status === 401)) return;
      notifyError(error);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // An expired session or a permission failure will not fix itself.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

// A 401 outside the auth endpoints means the cookie lapsed mid-session. Mark
// the session as gone so the router shows sign-in once, and drop every cached
// tenant query so the next user never sees the previous one's data. The
// session query itself is kept — clearing it would trigger a refetch, another
// 401, and a loop.
setSessionExpiredHandler(() => {
  if (queryClient.getQueryData<{ user?: unknown }>(["me"])?.user == null) return;
  queryClient.setQueryData(["me"], { user: null });
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
});

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

/*
 * The native shell keeps its session as a token rather than a cookie, so it
 * has to be read out of device storage before the first request goes out.
 * Rendering first would fire the session check unauthenticated and bounce a
 * signed-in user to the login screen on every cold start.
 *
 * On the web this resolves immediately and changes nothing. Kept as an async
 * bootstrap rather than a top-level await, which the browser build target
 * does not allow.
 */
async function bootstrap(): Promise<void> {
  await loadSessionToken();
  renderApp();
}

function renderApp(): void {
  createRoot(container as HTMLElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ErrorBoundary>
            <ConnectionBanner />
            <App />
            <Toaster />
          </ErrorBoundary>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void bootstrap();
