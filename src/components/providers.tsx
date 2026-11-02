"use client";

import { useEffect } from "react";
import { ThemeProvider } from "next-themes";

const CHUNK_ERROR_PATTERN = /ChunkLoadError|Loading chunk [\w-]+ failed/i;

function isChunkLoadError(value: unknown) {
  if (!value) return false;
  const message = value instanceof Error ? `${value.name} ${value.message}` : String(value);
  return CHUNK_ERROR_PATTERN.test(message);
}

function useChunkLoadErrorRecovery() {
  useEffect(() => {
    function handleError(event: ErrorEvent) {
      if (isChunkLoadError(event.error) || isChunkLoadError(event.message)) window.location.reload();
    }
    function handleRejection(event: PromiseRejectionEvent) {
      if (isChunkLoadError(event.reason)) window.location.reload();
    }
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);
}

export function Providers({ children }: { children: React.ReactNode }) {
  useChunkLoadErrorRecovery();
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      {children}
    </ThemeProvider>
  );
}

