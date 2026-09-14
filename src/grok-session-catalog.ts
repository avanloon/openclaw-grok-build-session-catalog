import { existsSync, lstatSync, statSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import type {
  SessionCatalogSession,
  SessionCatalogTranscriptItem,
  SessionsCatalogReadResult,
} from "openclaw/plugin-sdk/session-catalog";
import { sessionCatalogPaging } from "openclaw/plugin-sdk/session-catalog";
import {
  isRecord,
  normalizeBoundedOptionalString,
} from "openclaw/plugin-sdk/string-coerce-runtime";

const LOCAL_HOST_ID = "gateway";
const MAX_SESSION_GROUPS = 2_000;
const MAX_SESSIONS = 10_000;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;

type GrokSessionFile = { directory: string; threadId: string };
type GrokSessionPage = { sessions: SessionCatalogSession[]; nextCursor?: string };

export const isExactGrokSessionCursor = sessionCatalogPaging.isExactCursor;

const messages = {
  listNotObject: "Grok Build session list parameters must be an object",
  unknownListParameter: (key: string) => `unknown Grok Build session list parameter: ${key}`,
  invalidSearchTerm: "searchTerm is invalid",
  readNotObject: "Grok Build session read parameters must be an object",
  unknownReadParameter: (key: string) => `unknown Grok Build session read parameter: ${key}`,
  invalidThreadId: "threadId is invalid",
};

function grokHome(env: NodeJS.ProcessEnv): { root: string; fallback: boolean } {
  const configured = env.GROK_HOME?.trim();
  if (configured) return { root: path.resolve(configured), fallback: false };
  const home = (process.platform === "win32" ? env.USERPROFILE : env.HOME)?.trim() || os.homedir();
  return { root: path.join(home, ".grok"), fallback: true };
}

function root(env = process.env): string {
  return path.join(grokHome(env).root, "sessions");
}

async function directory(candidate: string): Promise<boolean> {
  try {
    const stats = await lstat(candidate);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

async function json(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function time(value: unknown): number | undefined {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? Date.parse(value)
    : undefined;
}

function summary(file: GrokSessionFile, value: unknown): SessionCatalogSession | undefined {
  if (!isRecord(value) || !isRecord(value.info)) return undefined;
  const threadId = normalizeBoundedOptionalString(value.info.id, 128);
  if (!threadId || threadId !== file.threadId || !SESSION_ID_PATTERN.test(threadId)) return undefined;
  const name =
    normalizeBoundedOptionalString(value.generated_title, 1_000) ??
    normalizeBoundedOptionalString(value.session_summary, 1_000);
  const cwd = normalizeBoundedOptionalString(value.info.cwd, 4_096);
  const createdAt = time(value.created_at);
  const updatedAt = time(value.last_active_at) ?? time(value.updated_at);
  const gitBranch = normalizeBoundedOptionalString(value.head_branch, 256);
  return {
    threadId,
    ...(name ? { name } : {}),
    ...(cwd ? { cwd } : {}),
    status: "stored",
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt, recencyAt: updatedAt }),
    source: "grok-build-local",
    modelProvider: "xai",
    ...(gitBranch ? { gitBranch } : {}),
    archived: false,
    canContinue: false,
    canArchive: false,
    canOpenTerminal: false,
  };
}

async function files(): Promise<GrokSessionFile[]> {
  const sessionRoot = root();
  if (!(await directory(sessionRoot))) return [];
  const groups = (await readdir(sessionRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .slice(0, MAX_SESSION_GROUPS);
  const results: GrokSessionFile[] = [];
  for (const group of groups) {
    const entries = await readdir(path.join(sessionRoot, group.name), {
      withFileTypes: true,
    }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !SESSION_ID_PATTERN.test(entry.name)) {
        continue;
      }
      results.push({ directory: path.join(sessionRoot, group.name, entry.name), threadId: entry.name });
      if (results.length >= MAX_SESSIONS) return results;
    }
  }
  return results;
}

export async function listLocalGrokSessionPage(value?: unknown): Promise<GrokSessionPage> {
  const params = sessionCatalogPaging.parseListParams(value, { searchMaxLength: 500, messages });
  const offset = sessionCatalogPaging.decodeCursor(params.cursor);
  const needle = params.searchTerm?.toLocaleLowerCase();
  const sessions = (
    await Promise.all(
      (await files()).map(async (file) => summary(file, await json(path.join(file.directory, "summary.json")))),
    )
  )
    .flatMap((session) => (session ? [session] : []))
    .filter(
      (session) =>
        !needle ||
        [session.threadId, session.name, session.cwd, session.gitBranch].some((field) =>
          field?.toLocaleLowerCase().includes(needle),
        ),
    )
    .sort((left, right) => (right.recencyAt ?? 0) - (left.recencyAt ?? 0));
  const page = sessions.slice(offset, offset + params.limit);
  return {
    sessions: page,
    ...(offset + page.length < sessions.length
      ? { nextCursor: sessionCatalogPaging.encodeCursor(offset + page.length) }
      : {}),
  };
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const joined = value
    .flatMap((part) => (isRecord(part) && typeof part.text === "string" ? [part.text] : []))
    .join("\n");
  return joined || undefined;
}

function transcript(value: unknown): SessionCatalogTranscriptItem[] {
  if (!isRecord(value)) return [];
  const type = normalizeBoundedOptionalString(value.type, 128);
  if (type === "system") return [];
  const content = text(value.content) ?? normalizeBoundedOptionalString(value.summary, 20_000);
  if (!type || !content) return [];
  if (type === "user") return [{ type: "userMessage", text: content }];
  if (type === "assistant") return [{ type: "agentMessage", text: content }];
  if (type === "reasoning") return [{ type: "reasoning", text: content }];
  return [{ type: "other", text: content }];
}

export async function readLocalGrokTranscriptPage(value: unknown): Promise<SessionsCatalogReadResult> {
  const params = sessionCatalogPaging.parseReadParams(value, {
    threadIdMaxLength: 128,
    threadIdPattern: SESSION_ID_PATTERN,
    messages,
  });
  const session = (await files()).find((candidate) => candidate.threadId === params.threadId);
  if (!session) throw new Error("Grok Build session is unavailable");
  const content = await readFile(path.join(session.directory, "chat_history.jsonl"), "utf8").catch(() => "");
  const items = content.split("\n").filter(Boolean).flatMap((line) => {
    try {
      return transcript(JSON.parse(line) as unknown);
    } catch {
      return [];
    }
  });
  const page = sessionCatalogPaging.boundTranscriptPage(
    items,
    params.limit,
    sessionCatalogPaging.decodeCursor(params.cursor),
  );
  return { hostId: LOCAL_HOST_ID, label: "Local Grok Build", threadId: params.threadId, ...page };
}

export function grokSessionStoreAvailable(env: NodeJS.ProcessEnv): boolean {
  const sessionRoot = root(env);
  try {
    return existsSync(sessionRoot) && statSync(sessionRoot).isDirectory() && !lstatSync(sessionRoot).isSymbolicLink();
  } catch {
    return false;
  }
}

export function grokUsesProcessHomeFallback(env: NodeJS.ProcessEnv): boolean {
  return grokHome(env).fallback;
}
