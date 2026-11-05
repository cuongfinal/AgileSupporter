import "@/styles/globals.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppProps } from "next/app";
import Head from "next/head";
import { useState } from "react";
import JobWatcher from "@/components/JobWatcher";
import Layout from "@/components/Layout";
import ToastHost from "@/components/ToastHost";

export default function App({ Component, pageProps }: AppProps) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false, staleTime: 30_000 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <Head>
        <title>INTERNAL DEV DASHBOARD</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Layout>
        <Component {...pageProps} />
      </Layout>
      <JobWatcher />
      <ToastHost />
    </QueryClientProvider>
  );
}
