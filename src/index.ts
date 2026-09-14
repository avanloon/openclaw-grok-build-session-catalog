import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { SessionCatalogProvider } from "openclaw/plugin-sdk/session-catalog";
import {
  grokSessionStoreAvailable,
  grokUsesProcessHomeFallback,
  isExactGrokSessionCursor,
  listLocalGrokSessionPage,
  readLocalGrokTranscriptPage,
} from "./grok-session-catalog.js";

const LOCAL_HOST_ID = "gateway";

function enabled(config: unknown): boolean {
  return Boolean(
    config && typeof config === "object" && (config as { enabled?: unknown }).enabled === true,
  );
}

export default definePluginEntry({
  id: "grok-build-session-catalog",
  name: "Grok Build Session Catalog",
  description: "Opt-in, read-only discovery of local Grok Build sessions.",
  register(api) {
    if (!enabled(api.pluginConfig)) return;

    const provider: SessionCatalogProvider = {
      id: "grok-build",
      label: "Grok Build",
      supportsProcessHomeIsolation: true,
      list: async (params) => {
        const requested = params.hostIds ? new Set(params.hostIds) : undefined;
        if (requested && !requested.has(LOCAL_HOST_ID)) return [];
        if (
          (params.allowProcessHomeFallback === false && grokUsesProcessHomeFallback(process.env)) ||
          !grokSessionStoreAvailable(process.env)
        ) {
          return [];
        }
        try {
          const page = await listLocalGrokSessionPage({
            limit: params.limitPerHost,
            ...(params.search ? { searchTerm: params.search } : {}),
            cursor: params.cursors?.[LOCAL_HOST_ID],
          });
          const host = {
            hostId: LOCAL_HOST_ID,
            label: "Local Grok Build",
            kind: "gateway" as const,
            connected: true,
            ...page,
          };
          params.onHost?.(host);
          return [host];
        } catch {
          const host = {
            hostId: LOCAL_HOST_ID,
            label: "Local Grok Build",
            kind: "gateway" as const,
            connected: true,
            sessions: [],
            error: {
              code: "LOCAL_READ_FAILED" as const,
              message: "Local Grok Build sessions are unavailable",
            },
          };
          params.onHost?.(host);
          return [host];
        }
      },
      read: async (params) => {
        if (params.hostId !== LOCAL_HOST_ID) {
          throw new Error("Grok Build session catalog hostId is invalid");
        }
        if (!grokSessionStoreAvailable(process.env)) {
          throw new Error("Local Grok Build sessions are unavailable");
        }
        if (params.cursor !== undefined && !isExactGrokSessionCursor(params.cursor)) {
          throw new Error("cursor is invalid");
        }
        return await readLocalGrokTranscriptPage({
          threadId: params.threadId,
          ...(params.limit ? { limit: params.limit } : {}),
          ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
        });
      },
    };
    api.registerSessionCatalog(provider);
  },
});
