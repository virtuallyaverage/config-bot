import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import settings from "../settings.json";

var versions_url = `${settings.schema.provider}/schema/versions.json`;
const SCHEMA_DIR = join(process.cwd(), "schema");

const ALLOWED_DOMAINS = ["vrc-haptics.github.io/mapping-schema/"];

interface VersionsFile {
  "schema-versions": string[];
}

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const domainPath = parsed.host + parsed.pathname;
    return ALLOWED_DOMAINS.some((d) => domainPath.startsWith(d));
  } catch {
    return false;
  }
}

function extractRefs(schema: Record<string, unknown>): string[] {
  const refs: string[] = [];
  const walk = (obj: unknown) => {
    if (obj === null || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    const record = obj as Record<string, unknown>;
    if (typeof record["$ref"] === "string" && !record["$ref"].startsWith("#"))
      refs.push(record["$ref"]);
    Object.values(record).forEach(walk);
  };
  walk(schema);
  return refs;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

function getCachedVersions(): string[] {
  const path = join(SCHEMA_DIR, "versions.json");
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as VersionsFile;
    return data["schema-versions"] ?? [];
  } catch {
    return [];
  }
}

function ensureDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

async function fetchSchemaWithRefs(
  version: string,
  seen = new Set<string>()
): Promise<void> {
  const versionDir = join(SCHEMA_DIR, version);
  ensureDir(versionDir);

  const entryUrl = `${settings.schema.provider}/schema/${version}/map.schema.json`;
  const queue = [entryUrl];

  while (queue.length > 0) {
    const url = queue.pop()!;
    if (seen.has(url)) continue;
    seen.add(url);

    if (!isAllowedUrl(url)) {
      console.warn(`Skipping disallowed URL: ${url}`);
      continue;
    }

    const schema = await fetchJson<Record<string, unknown>>(url);
    const parsed = new URL(url);
    // Map URL path back to local path under SCHEMA_DIR
    // e.g. /mapping-schema/schema/v0.0.1/map.schema.json -> schema/v0.0.1/map.schema.json
    const relativePath = parsed.pathname.replace(/^\/mapping-schema\/schema\//, "");
    const localPath = join(SCHEMA_DIR, relativePath);
    ensureDir(dirname(localPath));
    writeFileSync(localPath, JSON.stringify(schema, null, 2));
    console.log(`Cached: ${relativePath}`);

    // Resolve $ref URLs relative to the current file's URL
    const baseUrl = url.substring(0, url.lastIndexOf("/") + 1);
    for (const ref of extractRefs(schema)) {
      const resolved = ref.startsWith("http") ? ref : new URL(ref, baseUrl).href;
      queue.push(resolved);
    }
  }
}

async function poll(): Promise<void> {
  try {
    const remote = await fetchJson<VersionsFile>(versions_url);
    const remoteVersions = remote["schema-versions"] ?? [];
    const cachedVersions = getCachedVersions();

    const newVersions = remoteVersions.filter((v) => !cachedVersions.includes(v));

    if (newVersions.length === 0) {
      console.log("Schemas up to date.");
      return;
    }

    console.log(`New schema versions found: ${newVersions.join(", ")}`);

    for (const version of newVersions) {
      await fetchSchemaWithRefs(version);
    }

    // Write updated versions.json only after all fetches succeed
    ensureDir(SCHEMA_DIR);
    writeFileSync(
      join(SCHEMA_DIR, "versions.json"),
      JSON.stringify(remote, null, 2)
    );
    console.log("versions.json updated.");
  } catch (err) {
    console.error("Schema poll failed:", err);
  }
}

export async function LoadSchemas(): Promise<void> {
  await poll();
  setInterval(poll, settings.schema["version-polling-hrs"] * 60 * 60 * 1000);
}