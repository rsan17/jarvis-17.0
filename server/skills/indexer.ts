import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import chokidar, { type FSWatcher } from "chokidar";
import matter from "gray-matter";
import { api } from "../../convex/_generated/api.js";
import { convex } from "../convex-client.js";
import { embed } from "../embeddings.js";

const here = dirname(fileURLToPath(import.meta.url));
// .claude/skills/ at project root.
const PROJECT_SKILLS_DIR = resolve(here, "..", "..", ".claude", "skills");

interface ParsedSkill {
  name: string;
  description: string;
  body: string;
  allowedTools?: string;
  tokenShape: "short" | "medium" | "long";
  sourceFile: string;
  fileHash: string;
}

function classifyShape(bodyLineCount: number): "short" | "medium" | "long" {
  if (bodyLineCount < 200) return "short";
  if (bodyLineCount < 400) return "medium";
  return "long";
}

function hashContent(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

// Parse a single SKILL.md. Returns null and logs if frontmatter is malformed
// or required fields are missing — we'd rather skip a bad skill than crash
// the indexer and lose all skills.
async function parseSkillFile(filePath: string): Promise<ParsedSkill | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = matter(raw);
    const fm = parsed.data as Record<string, unknown>;
    const name = typeof fm.name === "string" ? fm.name : "";
    const description = typeof fm.description === "string" ? fm.description : "";
    if (!name || !description) {
      console.warn(`[skills] ${filePath}: missing required frontmatter (name, description)`);
      return null;
    }
    const allowedTools =
      typeof fm["allowed-tools"] === "string"
        ? (fm["allowed-tools"] as string)
        : Array.isArray(fm["allowed-tools"])
          ? (fm["allowed-tools"] as unknown[]).join(", ")
          : undefined;
    const body = parsed.content;
    return {
      name,
      description,
      body,
      allowedTools,
      tokenShape: classifyShape(body.split("\n").length),
      sourceFile: filePath,
      fileHash: hashContent(raw),
    };
  } catch (err) {
    console.warn(`[skills] ${filePath}: parse failed`, err);
    return null;
  }
}

// Walk `.claude/skills/<folder>/SKILL.md`. We only look one level deep —
// SKILL.md must sit directly inside its named folder; that's the Anthropic
// spec.
async function discoverSkillFiles(root: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const folder = join(root, entry);
    let s;
    try {
      s = await stat(folder);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;
    const skillFile = join(folder, "SKILL.md");
    try {
      await stat(skillFile);
      out.push(skillFile);
    } catch {
      // No SKILL.md in this folder — silently skip.
    }
  }
  return out;
}

async function indexOne(
  filePath: string,
  knownByName: Map<string, { sourceFile: string; fileHash: string }>,
): Promise<{ name: string; action: "created" | "updated" | "skipped" } | null> {
  const parsed = await parseSkillFile(filePath);
  if (!parsed) return null;

  const known = knownByName.get(parsed.name);
  if (known && known.fileHash === parsed.fileHash && known.sourceFile === parsed.sourceFile) {
    return { name: parsed.name, action: "skipped" };
  }

  // Embed for find_skills RAG. Cheap (one short doc), but failures here
  // shouldn't block indexing — substring fallback covers it.
  const embedText = `${parsed.name}: ${parsed.description}\n\n${parsed.body.slice(0, 2000)}`;
  let embedding: number[] | undefined;
  try {
    const v = await embed(embedText);
    if (v) embedding = v;
  } catch (err) {
    console.warn(`[skills] embedding failed for ${parsed.name}:`, err);
  }

  await convex.mutation(api.skills.upsert, {
    name: parsed.name,
    description: parsed.description,
    body: parsed.body,
    allowedTools: parsed.allowedTools,
    tokenShape: parsed.tokenShape,
    sourceFile: parsed.sourceFile,
    fileHash: parsed.fileHash,
    embedding,
  });

  return { name: parsed.name, action: known ? "updated" : "created" };
}

async function reconcile(): Promise<{
  created: number;
  updated: number;
  skipped: number;
  removed: number;
}> {
  const files = await discoverSkillFiles(PROJECT_SKILLS_DIR);
  const meta = await convex.query(api.skills.listMeta, {});
  const knownByName = new Map(meta.map((m) => [m.name, m]));
  const seenNames = new Set<string>();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const f of files) {
    const res = await indexOne(f, knownByName);
    if (!res) continue;
    seenNames.add(res.name);
    if (res.action === "created") created++;
    else if (res.action === "updated") updated++;
    else skipped++;
  }

  // Drop registry entries whose source file vanished.
  let removed = 0;
  for (const m of meta) {
    if (!seenNames.has(m.name)) {
      await convex.mutation(api.skills.remove, { name: m.name });
      removed++;
    }
  }

  return { created, updated, skipped, removed };
}

let watcher: FSWatcher | null = null;

export async function startSkillIndexer(): Promise<void> {
  const summary = await reconcile();
  console.log(
    `[skills] indexed: ${summary.created} created, ${summary.updated} updated, ${summary.skipped} unchanged, ${summary.removed} removed`,
  );

  // Watcher debounces are not needed — indexOne hash-checks before writing.
  // ignoreInitial skips the initial-add events (we already did the scan).
  watcher = chokidar.watch(`${PROJECT_SKILLS_DIR}/*/SKILL.md`, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200 },
  });
  watcher
    .on("add", () => void reconcile().catch((err) => console.warn("[skills] reindex failed", err)))
    .on("change", () =>
      void reconcile().catch((err) => console.warn("[skills] reindex failed", err)),
    )
    .on("unlink", () =>
      void reconcile().catch((err) => console.warn("[skills] reindex failed", err)),
    );
  console.log(`[skills] watching ${PROJECT_SKILLS_DIR}/*/SKILL.md for changes`);
}

export async function stopSkillIndexer(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
}
