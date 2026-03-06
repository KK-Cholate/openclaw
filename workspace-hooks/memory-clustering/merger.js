/**
 * Append classified memory files into topic cluster files.
 * Cluster files live at memory/clusters/{Topic}.md.
 * Processed originals are moved to memory/archived/.
 */

import fs from "node:fs/promises";
import path from "node:path";

/**
 * Append new entries to a topic cluster file (Append mode).
 * Creates the file if it doesn't exist.
 * Moves original files to memory/archived/ after successful write.
 */
export async function appendToCluster({ topic, files, workspaceDir }) {
  if (files.length === 0) return;

  const clustersDir = path.join(workspaceDir, "memory", "clusters");
  const archivedDir = path.join(workspaceDir, "memory", "archived");

  await fs.mkdir(clustersDir, { recursive: true });
  await fs.mkdir(archivedDir, { recursive: true });

  const clusterFile = path.join(clustersDir, `${topic}.md`);

  // Read existing cluster file
  let existingContent = "";
  let existingCount = 0;
  let archivedSources = [];

  try {
    existingContent = await fs.readFile(clusterFile, "utf-8");

    const countMatch = existingContent.match(/累计 (\d+) 个会话/);
    if (countMatch) existingCount = parseInt(countMatch[1], 10);

    const sourcesMatch = existingContent.match(/<!-- sources:([\s\S]*?)-->/);
    if (sourcesMatch) {
      archivedSources = sourcesMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } catch {
    // File doesn't exist yet — will be created fresh
  }

  // Filter out already-archived files (prevent double-processing)
  const newFiles = files.filter((fp) => !archivedSources.includes(path.basename(fp)));
  if (newFiles.length === 0) return;

  const today = new Date().toISOString().split("T")[0];
  const newCount = existingCount + newFiles.length;

  // Build new entry sections
  const newEntries = await Promise.all(
    newFiles.map(async (fp) => {
      const name = path.basename(fp, ".md");
      const dateStr = name.slice(0, 10); // YYYY-MM-DD
      const slug = name.slice(11); // rest after the date-
      let rawContent = "";
      try {
        rawContent = await fs.readFile(fp, "utf-8");
      } catch {
        rawContent = "(unreadable)";
      }
      // Keep first 1500 chars to avoid unbounded cluster growth
      const excerpt = rawContent.slice(0, 1500);
      return `---\n\n## ${dateStr} · ${slug}\n\n${excerpt}\n`;
    }),
  );

  const newSourceNames = newFiles.map((fp) => path.basename(fp));
  const allSourceNames = [...archivedSources, ...newSourceNames];
  const sourcesComment = `<!-- sources: ${allSourceNames.join(", ")} -->`;
  const metaLine = `> 自动聚合 · 最后更新：${today} · 累计 ${newCount} 个会话`;

  let finalContent;
  if (!existingContent) {
    // New cluster file
    finalContent = [
      `# Cluster: ${topic}`,
      metaLine,
      "",
      ...newEntries,
      sourcesComment,
      "",
    ].join("\n");
  } else {
    // Append to existing — update metadata line and sources comment in place
    let updated = existingContent;

    updated = updated.replace(
      /> 自动聚合 · 最后更新：.+? · 累计 \d+ 个会话/,
      metaLine,
    );

    updated = updated.replace(/<!-- sources:[\s\S]*?-->/, sourcesComment);

    // Insert new entries before the sources comment
    const insertPoint = updated.lastIndexOf("\n<!-- sources:");
    if (insertPoint >= 0) {
      updated =
        updated.slice(0, insertPoint) + "\n" + newEntries.join("") + updated.slice(insertPoint);
    } else {
      updated += "\n" + newEntries.join("") + "\n" + sourcesComment + "\n";
    }

    finalContent = updated;
  }

  await fs.writeFile(clusterFile, finalContent, "utf-8");

  // Move original files to archived/
  for (const fp of newFiles) {
    const dest = path.join(archivedDir, path.basename(fp));
    try {
      await fs.rename(fp, dest);
    } catch {
      // rename may fail across devices — fall back to copy+delete
      try {
        await fs.copyFile(fp, dest);
        await fs.unlink(fp);
      } catch {
        // Ignore move errors — leave original in place
      }
    }
  }
}
