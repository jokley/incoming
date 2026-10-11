import { isRouteErrorResponse, useRouteError } from "react-router";
import { Link } from "react-router";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "./ui/button";

export function RouteErrorBoundary() {
  const error = useRouteError();

  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : "Unexpected error";

  const message = (() => {
    if (isRouteErrorResponse(error)) {
      return typeof error.data === "string" ? error.data : "A route error occurred.";
    }
    if (error instanceof Error) return error.message;
    return "Something went wrong.";
  })();

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-900">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-red-700" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="mt-1 text-sm text-red-800">{message}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => window.location.reload()}
              >
                <RotateCcw className="h-4 w-4" />
                Reload
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to="/">Go to dashboard</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

