import type { Attachment } from "discord.js";
import settings from "./../../settings.json";
import type { ErrorObject } from "ajv";
import { ValidateSchema } from "./schema.js";

export interface ValidateResult {
  reason: ReasonInvalid;
  line: number;
  errors?: ErrorObject[] | undefined | null;
  file: Record<string, unknown> | null;
}

export enum ReasonInvalid {
  None,
  InvalidFormat,
  TooLarge,
  FetchingContent,
  JsonInvalid,
  InvalidStructure,
  NoVersion,
  InvalidVersion,
  VersionNotCached,
  SchemaViolation,
  SchemaLoadFailed,
}

export const ReasonMessages: Record<ReasonInvalid, string> = {
  [ReasonInvalid.None]: "Valid",
  [ReasonInvalid.InvalidFormat]: "File format is invalid, must be a utf-8 json file.",
  [ReasonInvalid.TooLarge]: "File exceeds maximum size",
  [ReasonInvalid.FetchingContent]: "Unable to retrieve file from server",
  [ReasonInvalid.JsonInvalid]: "File should be parsable json format",
  [ReasonInvalid.NoVersion]: "Missing required version field",
  [ReasonInvalid.InvalidStructure]: "Top-level value must be a JSON object",
  [ReasonInvalid.InvalidVersion]: "Schema version format is invalid",
  [ReasonInvalid.VersionNotCached]: "Schema version is not available",
  [ReasonInvalid.SchemaViolation]: "Content does not match the schema",
  [ReasonInvalid.SchemaLoadFailed]: "Unable to load schema for map version (possibly server error)",
};

export async function Validate(file: Attachment): Promise<ValidateResult> {
  // download file
  if (!file.contentType?.startsWith("application/json")) {
    return { reason: ReasonInvalid.InvalidFormat, line: 0, file: null };
  }

  if (file.size > settings["max-size"]) {
    return { reason: ReasonInvalid.TooLarge, line: file.size, file: null };
  }

  var content;
  try {
    const response = await fetch(file.url);
    if (!response.ok) {
      return { reason: ReasonInvalid.FetchingContent, line: response.status, file: null };
    }
    content = await response.text();
  } catch {
    return { reason: ReasonInvalid.FetchingContent, line: 0, file: null };
  }

  var parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { reason: ReasonInvalid.JsonInvalid, line: 0, file: null };
  }

  // validate it conforms to a schema version
  const res = await ValidateSchema(parsed);
  if (res.reason != ReasonInvalid.None) {
    return res;
  }

  // TODO: Migrate if version not latest
  return { reason: ReasonInvalid.None, line: 0, file: parsed };
}
