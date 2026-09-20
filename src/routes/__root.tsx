import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import stylesheet from "../styles/globals.css?url";
import onboardingStyles from "../styles/onboarding-refinements.css?url";
import { Button } from "../components/ui/button";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "classifier.dev — Your agents, sorted" },
    ],
    links: [
      { rel: "stylesheet", href: stylesheet },
      { rel: "stylesheet", href: onboardingStyles },
      { rel: "icon", href: "/favicon.svg" },
    ],
  }),
  component: RootDocument,
  errorComponent: ({ error, reset }) => (
    <main className="error-page">
      <h1>Something interrupted this page.</h1>
      <p>{error instanceof Error ? error.message : "Please try again."}</p>
      <Button onClick={reset}>Try again</Button>
      <a href="/app">Return home</a>
    </main>
  ),
  notFoundComponent: () => (
    <main className="error-page">
      <h1>Page not found</h1>
      <a href="/app">Back to your dashboard</a>
    </main>
  ),
});
function RootDocument() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try { const dark = localStorage.getItem("classifier-theme") !== "light"; document.documentElement.dataset.theme = dark ? "dark" : "light"; document.documentElement.classList.add(dark ? "black" : "pure-light"); } catch {}`,
          }}
        />
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <Outlet />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
