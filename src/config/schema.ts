import _Ajv2020 from "ajv/dist/2020.js";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import settings from "./../../settings.json";
import { ReasonInvalid, type ValidateResult } from "./validate.js";

const ALLOWED_DOMAINS: string[] = settings.schema["allowed-domains"];
const VERSION_RE = /^v\d+\.\d+\.\d+$/;
const SCHEMA_DIR = join(process.cwd(), "schema");

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const domainPath = parsed.host + parsed.pathname;
    return ALLOWED_DOMAINS.some((d) => domainPath.startsWith(d));
  } catch {
    return false;
  }
}

function extractVersion(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/schema\/(v[\d.]+)\//);
    if (!match?.[1]) return null;
    return VERSION_RE.test(match[1]) ? match[1] : null;
  } catch {
    return null;
  }
}

function loadCachedSchemas(version: string): Record<string, unknown>[] {
  const dir = join(SCHEMA_DIR, version);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".schema.json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")));
}

export async function ValidateSchema(json: unknown): Promise<ValidateResult> {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { reason: ReasonInvalid.InvalidStructure, line: 0 };
  }

  const record = json as Record<string, unknown>;

  const version = record["schema-version"];
  if (typeof version !== "string" || version === "") {
    return { reason: ReasonInvalid.NoVersion, line: 0 };
  }

  if (!VERSION_RE.test(version)) {
    return { reason: ReasonInvalid.InvalidVersion, line: 0 };
  }

  const schemas = loadCachedSchemas(version);
  if (schemas.length === 0) {
    return { reason: ReasonInvalid.VersionNotCached, line: 0 };
  }

  const Ajv2020 = _Ajv2020 as unknown as typeof _Ajv2020.default;
  const ajv = new Ajv2020({ allErrors: true });

  const mapSchema = schemas.find(
    (s) => typeof s["$id"] === "string" && s["$id"].endsWith("map.schema.json"),
  );
  if (!mapSchema) {
    return { reason: ReasonInvalid.VersionNotCached, line: 0 };
  }

  for (const s of schemas) {
    if (s !== mapSchema) ajv.addSchema(s);
  }

  const validate = ajv.compile(mapSchema);

  if (!validate(record)) {
    return {
      reason: ReasonInvalid.SchemaViolation,
      line: 0,
      errors: validate.errors ?? [],
    };
  }

  return { reason: ReasonInvalid.None, line: 0 };
}