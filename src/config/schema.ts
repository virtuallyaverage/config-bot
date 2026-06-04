import _Ajv2020 from "ajv/dist/2020.js";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { ReasonInvalid, type ValidateResult } from "./validate.js";
import type { MapRef } from "./local.js";

const VERSION_RE = /^v\d+\.\d+\.\d+$/;
const SCHEMA_DIR = join(process.cwd(), "schema");

/**
 * Lowercase scheme + host of a URI-style $id so it matches the way Ajv
 * normalizes $ref targets (RFC 3986). Path case is preserved.
 */
function normalizeId(id: string): string {
  try {
    return new URL(id).href;
  } catch {
    return id; // not a URI-style id; leave untouched
  }
}

export function setAuthorName(file: Record<string, unknown>, authorName: string) {
  const id = file.identification;
  if (typeof id !== "object" || id === null) {
    throw new Error("missing 'identification' object");
  }
  const ident = id as Record<string, unknown>;

  if (typeof ident.authorName !== "string") {
    throw new Error("bad authorName");
  }

  ident.authorName = authorName;   // writes through the reference into file
  return file;
}

export function setVersion(file: Record<string, unknown>, version: number) {
  const id = file.identification;
  if (typeof id !== "object" || id === null) {
    throw new Error("missing 'identification' object");
  }
  const ident = id as Record<string, unknown>;

  if (typeof ident.mapVersion !== "number" || !Number.isInteger(ident.mapVersion)) {
    throw new Error("bad mapVersion");
  }

  ident.mapVersion = version;   // writes through the reference into file
  return file;
}

export function extractMapRef(file: Record<string, unknown>): MapRef {
  const id = file.identification;
  if (typeof id !== "object" || id === null) {
    throw new Error("missing 'identification' object");
  }
  const { authorName, mapName, mapVersion } = id as Record<string, unknown>;

  if (typeof authorName !== "string") throw new Error("bad authorName");
  if (typeof mapName !== "string") throw new Error("bad mapName");
  if (typeof mapVersion !== "number" || !Number.isInteger(mapVersion)) {
    throw new Error("bad mapVersion");
  }

  return { authorName, mapName, version: mapVersion };
}

function loadCachedSchemas(version: string): Record<string, unknown>[] {
  const dir = join(SCHEMA_DIR, version);
  if (!existsSync(dir)) return [];

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".schema.json"));
  } catch (err) {
    console.error(`[schema] failed to read dir ${dir}:`, err);
    return [];
  }

  const out: Record<string, unknown>[] = [];
  for (const f of files) {
    const path = join(dir, f);
    try {
      const schema = JSON.parse(readFileSync(path, "utf-8")) as Record<
        string,
        unknown
      >;
      if (typeof schema["$id"] === "string") {
        schema["$id"] = normalizeId(schema["$id"]);
      }
      out.push(schema);
    } catch (err) {
      console.error(`[schema] skipping unreadable schema ${path}:`, err);
    }
  }
  return out;
}

export async function ValidateSchema(
  json: Record<string, unknown>,
): Promise<ValidateResult> {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { reason: ReasonInvalid.InvalidStructure, line: 0, file: null };
  }

  const record = json;

  const version = record["schemaVersion"];
  if (typeof version !== "string" || version === "") {
    return { reason: ReasonInvalid.NoVersion, line: 0, file: null };
  }
  if (!VERSION_RE.test(version)) {
    return { reason: ReasonInvalid.InvalidVersion, line: 0, file: null };
  }

  const schemas = loadCachedSchemas(version);
  if (schemas.length === 0) {
    return { reason: ReasonInvalid.VersionNotCached, line: 0, file: null };
  }

  const mapSchema = schemas.find(
    (s) =>
      typeof s["$id"] === "string" &&
      (s["$id"] as string).endsWith("map.schema.json"),
  );
  if (!mapSchema) {
    return { reason: ReasonInvalid.VersionNotCached, line: 0, file: null };
  }

  // Everything below can throw: MissingRefError (unresolved $ref), duplicate
  // $id, or an invalid schema document. The bot runs remotely and must never
  // crash on a bad/incomplete cache, so contain all of it and log for triage.
  try {
    const Ajv2020 = _Ajv2020 as unknown as typeof _Ajv2020.default;
    const ajv = new Ajv2020({ allErrors: true });

    // Register dependencies (node.schema.json, etc.); compile the map directly.
    for (const s of schemas) {
      if (s !== mapSchema) ajv.addSchema(s);
    }
    const validate = ajv.compile(mapSchema);

    if (!validate(record)) {
      return {
        reason: ReasonInvalid.SchemaViolation,
        line: 0,
        errors: validate.errors ?? [],
        file: null,
      };
    }

    return { reason: ReasonInvalid.None, line: 0, file: null };
  } catch (err) {
    console.error(
      `[schema] compile/validate failed for version ${version}:`,
      err instanceof Error ? `${err.name}: ${err.message}` : err,
    );
    return { reason: ReasonInvalid.SchemaLoadFailed, line: 0, file: null };
  }
}
