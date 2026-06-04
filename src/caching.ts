import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import settings from "../settings.json";
import { markMerged, unpushedMaps } from "./config/local.js";
import { MakePr } from "./github/fetch.js";

var versions_url = `${settings.schema.provider}/schema/versions.json`;
const SCHEMA_DIR = join(process.cwd(), "schema");

const ALLOWED_DOMAINS = ["vrc-haptics.github.io/mapping-schema/"];

interface VersionsFile {
  schemaVersions: string[];
  deprecatedVersions?: string[];
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

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
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

// Fetch a per-version script (up.js / down.js) only if not already on disk.
async function ensureScript(version: string, name: string): Promise<boolean> {
  const localPath = join(SCHEMA_DIR, version, name);
  if (existsSync(localPath)) return false;
  const url = `${settings.schema.provider}/schema/${version}/${name}`;
  if (!isAllowedUrl(url)) {
    console.warn(`Skipping disallowed URL: ${url}`);
    return false;
  }
  const text = await fetchText(url);
  ensureDir(dirname(localPath));
  writeFileSync(localPath, text);
  console.log(`Cached: ${version}/${name}`);
  return true;
}

// Fetch a deprecated migration script only if not already on disk.
async function ensureDeprecatedScript(version: string): Promise<boolean> {
  const file = `${version}.js`;
  const localPath = join(SCHEMA_DIR, "deprecated", file);
  if (existsSync(localPath)) return false;
  const url = `${settings.schema.provider}/schema/deprecated/${file}`;
  if (!isAllowedUrl(url)) {
    console.warn(`Skipping disallowed URL: ${url}`);
    return false;
  }
  const text = await fetchText(url);
  ensureDir(dirname(localPath));
  writeFileSync(localPath, text);
  console.log(`Cached: deprecated/${file}`);
  return true;
}

async function poll(): Promise<void> {
  try {
    const maps = await unpushedMaps();

    if (maps.maps.length > 0) {
      console.log("Pushing maps to pr");
      const prNum = await MakePr(maps);
      maps.refs.forEach(async ref => {
        await markMerged(ref);
      });
    }

    const remote = await fetchJson<VersionsFile>(versions_url);
    const remoteVersions = remote.schemaVersions ?? [];
    const remoteDeprecated = remote.deprecatedVersions ?? [];

    let fetched = false;

    for (let i = 0; i < remoteVersions.length; i++) {
      const version = remoteVersions[i];
      if (!version) continue;

      // Schema (+ refs): fetch if the entry schema is missing locally.
      if (!existsSync(join(SCHEMA_DIR, version, "map.schema.json"))) {
        await fetchSchemaWithRefs(version);
        fetched = true;
      }

      // up.js for every version except the first; down.js except the last.
      if (i > 0) fetched = (await ensureScript(version, "up.js")) || fetched;
      if (i < remoteVersions.length - 1)
        fetched = (await ensureScript(version, "down.js")) || fetched;
    }

    for (const version of remoteDeprecated) {
      fetched = (await ensureDeprecatedScript(version)) || fetched;
    }

    if (!fetched) {
      console.log("Schemas up to date.");
      return;
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