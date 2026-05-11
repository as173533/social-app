import { RefreshCcw } from "lucide-react";
import { useRouteError } from "react-router-dom";

export function RouteError() {
  const error = useRouteError() as Error | undefined;

  return (
    <main className="grid min-h-screen place-items-center bg-white px-4">
      <section className="w-full max-w-md rounded-lg border border-slate-200 p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600">
          The app hit an unexpected UI error. Refreshing usually restores the current session.
        </p>
        {error?.message && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}
        <button
          onClick={() => window.location.reload()}
          className="mt-5 flex items-center gap-2 rounded-lg bg-brand px-4 py-2 font-medium text-white"
        >
          <RefreshCcw size={16} />
          Refresh
        </button>
      </section>
    </main>
  );
}
