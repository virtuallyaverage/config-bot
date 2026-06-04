import type { MapRef } from "../config/local.js";
import { OCTOKIT } from "../index.js";
import { readFile } from "node:fs/promises";
import path, { basename } from "node:path";

export interface IdWithMap {
    maps: string[],
    refs: MapRef[],
}

export interface HostingPr {
    maps: MapRef[],
    status: PrStatus,
}

export enum PrStatus {
    Open,
    Closed,
    Merged,
}

const HOSTING_URL: string = "https://github.com/VRC-Haptics/haptic-config-hosting/";
const CATALOG_URL = "https://vrc-haptics.github.io/haptic-config-hosting/catalog.json";

const { owner: OWNER, repo: REPO } = (() => {
    const p = new URL(HOSTING_URL).pathname.replace(/^\/|\/$/g, "").split("/");
    const owner = p[0];
    const repo = p[1];
    return { owner: p[0] as string, repo: p[1] as string };
})();

export async function fetchHostingPr(pr: number): Promise<HostingPr> {
    /// create a list of MapRef's from the files added in a pull request
    const { data: prData } = await OCTOKIT.rest.pulls.get({
        owner: OWNER, repo: REPO, pull_number: pr,
    });

    let status: PrStatus;
    if (prData.merged) status = PrStatus.Merged;
    else if (prData.state === "closed") status = PrStatus.Closed;
    else status = PrStatus.Open;

    // PR may come from a fork; read file contents from the head repo.
    const headOwner = prData.head.repo?.owner.login ?? OWNER;
    const headRepo = prData.head.repo?.name ?? REPO;
    const headSha = prData.head.sha;

    const files = await OCTOKIT.paginate(OCTOKIT.rest.pulls.listFiles, {
        owner: OWNER, repo: REPO, pull_number: pr, per_page: 100,
    });

    const maps: MapRef[] = [];
    for (const f of files) {
        if (f.status !== "added") continue;
        // configs/{author}/{mapName}_{version}.json  (version = trailing _<digits>)
        const m = f.filename.match(/^configs\/([^/]+)\/(.+)_(\d+)\.json$/);
        if (!m) continue;
        const [, authorName, mapName, version] = m;

        const { data: content } = await OCTOKIT.rest.repos.getContent({
            owner: headOwner, repo: headRepo, path: f.filename, ref: headSha,
        });
        if (Array.isArray(content) || content.type !== "file") continue;
        const json = JSON.parse(Buffer.from(content.content, "base64").toString("utf8"));

        maps.push({
            authorName,
            mapName,
            version: Number(version),
            schemaVersion: json.schemaVersion,
            url: f.filename.replace(/^configs\//, ""),
        } as MapRef);
    }

    return { maps, status };
}

export async function fetchCatalog(): Promise<MapRef[]> {
    /// fetches and parses into a list of maprefs.
    const res = await fetch(CATALOG_URL);
    if (!res.ok) throw new Error(`Failed to fetch catalog: ${res.status} ${res.statusText}`);

    const raw = await res.json() as Array<{
        author: string; name: string; version: number; schemaVersion: string; url: string;
    }>;

    return raw.map((e) => ({
        authorName: e.author,
        mapName: e.name,
        version: e.version,
    } as MapRef));
}

export async function MakePr({ maps, refs }: IdWithMap): Promise<number> {
    /// Make a pr to https://vrc-haptics.github.io/haptic-config-hosting
    if (maps.length !== refs.length) {
        throw new Error(`maps (${maps.length}) and refs (${refs.length}) length mismatch`);
    }

    const timeUTC = new Date().toISOString();
    const branch = `update-maps-${Date.now()}`;
    const message = `[Update]: Maps:${timeUTC}`;

    // 1. Resolve upstream default branch + its tip commit/tree (the PR base).
    const { data: upstream } = await OCTOKIT.rest.repos.get({ owner: OWNER, repo: REPO });
    const base = upstream.default_branch;
    const { data: baseRef } = await OCTOKIT.rest.git.getRef({
        owner: OWNER, repo: REPO, ref: `heads/${base}`,
    });
    const baseSha = baseRef.object.sha;
    const { data: baseCommit } = await OCTOKIT.rest.git.getCommit({
        owner: OWNER, repo: REPO, commit_sha: baseSha,
    });

    // 2. Build blobs for every file not already present upstream (add-only).
    const tree: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
    for (let i = 0; i < maps.length; i++) {
        const ref = refs[i];
        if (!ref) continue;

        const localPath = maps[i];
        if (!localPath) continue;
        const destPath = `configs/${ref.authorName}/${ref.mapName}_${ref.version}.json`;

        try {
            await OCTOKIT.rest.repos.getContent({ owner: OWNER, repo: REPO, path: destPath, ref: base });
            continue; // exists upstream -> never overwrite
        } catch (e: any) {
            if (e.status !== 404) throw e;
        }

        const buf = await readFile(localPath);
        const { data: blob } = await OCTOKIT.rest.git.createBlob({
            owner: OWNER, repo: REPO, content: buf.toString("base64"), encoding: "base64",
        });
        tree.push({ path: destPath, mode: "100644", type: "blob", sha: blob.sha });
    }

    if (tree.length === 0) {
        throw new Error("No new files to add; all targets already exist upstream.");
    }

    // 3. Create tree + commit on upstream, then point a new branch at it.
    const { data: newTree } = await OCTOKIT.rest.git.createTree({
        owner: OWNER, repo: REPO, base_tree: baseCommit.tree.sha, tree,
    });
    const { data: commit } = await OCTOKIT.rest.git.createCommit({
        owner: OWNER, repo: REPO, message, tree: newTree.sha, parents: [baseSha],
    });
    await OCTOKIT.rest.git.createRef({
        owner: OWNER, repo: REPO, ref: `refs/heads/${branch}`, sha: commit.sha,
    });

    // 4. Open the PR against the default branch (same repo, no fork).
    const { data: pr } = await OCTOKIT.rest.pulls.create({
        owner: OWNER, repo: REPO, title: message, head: branch, base,
    });
    return pr.number;
}