import { readFile, writeFile, rename, mkdir } from "fs/promises";
import { dirname, join } from "path";
import type { IdWithMap } from "../github/fetch.js";

export interface MapRef {
    authorName: string,
    mapName: string,
    version: number,
}

export interface ProcessedMaps {
    /// The pr id that we have published but haven't been resolved. 
    /// If a pr containing a MapRef is resolved (merged or not), and it doesn't show up in catalog,
    /// safe to merge.
    publishedPrs: number[]
    /// already published, can't be edited either.
    published: MapRef[],
    /// maps already sent out to a pr, waiting on merge
    /// Can not overwrite these.
    pending: MapRef[],
    /// maps cached locally. Safe to update without causing issues.
    cached: MapRef[],
}

export enum QueueError {
    /// map already in queue with this value
    InQueue,
    /// map has been pushed out to a PR.
    Duplicate,
    None,
}

const VALIDATED_DIR = join(process.cwd(), "validated");
const IDX_DIR = join(VALIDATED_DIR, "idx.json");

// highest version of author/name across pending + cached, or null if absent
export async function findVersion(authorName: string, mapName: string): Promise<number | null> {
    const rec = await getRecord();

    let max: number | null = null;
    for (const r of [...rec.published, ...rec.pending, ...rec.cached]) {
        if (r.authorName === authorName && r.mapName === mapName) {
            if (max === null || r.version > max) max = r.version;
        }
    }
    return max;
}

function sameRef(a: MapRef, b: MapRef): boolean {
    return (
        a.authorName === b.authorName &&
        a.mapName === b.mapName &&
        a.version === b.version
    );
}

let record: ProcessedMaps | null = null;
let loading: Promise<ProcessedMaps> | null = null;

function getRecord(): Promise<ProcessedMaps> {
    if (record) return Promise.resolve(record);
    // assignment is synchronous (pre-await) so concurrent callers share one load
    if (!loading) loading = loadRecord().then(r => (record = r));
    return loading;
}

let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);          // run regardless of prior outcome
    chain = run.then(() => {}, () => {});     // keep the chain alive on rejects
    return run;
}

async function loadRecord(): Promise<ProcessedMaps> {
    try {
        return JSON.parse(await readFile(IDX_DIR, "utf-8")) as ProcessedMaps;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            return { publishedPrs: [], published: [], pending: [], cached: [] };
        }
        throw err;
    }
}

async function saveRecord(map: ProcessedMaps): Promise<void> {
    await mkdir(VALIDATED_DIR, { recursive: true });
    const tmp = `${IDX_DIR}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(map, null, 2));
    await rename(tmp, IDX_DIR);
}

function mapFilePath(id: MapRef): string {
    return join(
        VALIDATED_DIR,
        id.authorName,
        `${id.mapName}_${id.version}.json`,
    );
}

async function writeMapFile(id: MapRef, file: Record<string, unknown>): Promise<void> {
    const path = mapFilePath(id);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(file, null, 2));
    await rename(tmp, path);
}

// maps validated and stored locally but not yet sent to a PR
export function unpushedMaps(): Promise<IdWithMap> {
    return withLock(async () => {
        const rec = await getRecord();
        const refs = rec.cached.map(r => ({ ...r }));
        const maps = refs.map(mapFilePath);
        return { refs, maps };
    });
}

export function insertPr(pr: number) {
    withLock(async () =>  {
        const rec = await getRecord();
        rec.publishedPrs.push(pr);
    });
}

export function queueMap(
    overwrite: boolean,
    file: Record<string, unknown>,
    id: MapRef,
): Promise<QueueError> {
    return withLock(async () => {
        const rec = await getRecord();

        // immutable: already published, or on an open PR awaiting merge.
        // overwrite cannot help here — the version must change.
        if (rec.published.some(r => sameRef(r, id))) return QueueError.Duplicate;
        if (rec.pending.some(r => sameRef(r, id))) return QueueError.Duplicate;

        // local cache: overwritable, but only with explicit confirmation.
        const cachedIdx = rec.cached.findIndex(r => sameRef(r, id));
        if (cachedIdx !== -1 && !overwrite) return QueueError.InQueue;

        // build next state immutably; commit to memory only after persist.
        const next: ProcessedMaps = {
            publishedPrs: rec.publishedPrs,
            published: rec.published,
            pending: rec.pending,
            cached: cachedIdx === -1
                ? [...rec.cached, id]
                : rec.cached.map((r, j) => (j === cachedIdx ? id : r)),
        };

        // write data file first; if idx save then fails, idx never points at
        // a missing file (a stray data file just gets overwritten on retry)
        await writeMapFile(id, file);
        await saveRecord(next);
        record = next;            // atomic reference swap == commit
        return QueueError.None;
    });
}

// lifecycle completion: pending -> cached once the PR merges
export function markMerged(id: MapRef): Promise<void> {
    return withLock(async () => {
        const rec = await getRecord();
        const merged = rec.pending.find(r => sameRef(r, id));
        if (!merged) return;

        const next: ProcessedMaps = {
            publishedPrs: rec.publishedPrs,
            published: [...rec.published.filter(r => !sameRef(r, id)), merged],
            pending: rec.pending.filter(r => !sameRef(r, id)),
            cached: rec.cached.filter(r => !sameRef(r, id)),
        };
        await saveRecord(next);
        record = next;
    });
}