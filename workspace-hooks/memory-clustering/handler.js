/**
 * Memory Clustering Hook
 *
 * Triggered on /new or /reset. When memory/ has more than CLUSTER_THRESHOLD
 * daily log files, classifies them by topic via LLM (or heuristic fallback)
 * and merges them into memory/clusters/{Topic}.md.
 *
 * Original files are moved to memory/archived/ after clustering.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classifyFiles } from "./classifier.js";
import { appendToCluster } from "./merger.js";

const CLUSTER_THRESHOLD = 10;

// Matches: YYYY-MM-DD-{slug}.md  (daily logs only, not cluster or other files)
const DAILY_LOG_RE = /^\d{4}-\d{2}-\d{2}-.+\.md$/;

/**
 * Derive workspace directory from hook event context.
 */
function resolveWorkspaceDir(event) {
  const cfg = event?.context?.cfg;

  // agents.defaults.workspace is the most reliable source
  if (typeof cfg?.agents?.defaults?.workspace === "string") {
    return cfg.agents.defaults.workspace;
  }

  // Derive from session file path: <workspace>/sessions/<file>.jsonl
  const sessionEntry =
    event?.context?.previousSessionEntry ?? event?.context?.sessionEntry ?? {};
  const sessionFile = sessionEntry.sessionFile;
  if (typeof sessionFile === "string" && sessionFile.includes("/sessions/")) {
    return path.dirname(path.dirname(sessionFile));
  }

  return path.join(os.homedir(), ".openclaw", "workspace");
}

/**
 * Extract agent ID from session key (format: "agent:<agentId>:<channel>").
 */
function resolveAgentId(sessionKey) {
  const parts = (sessionKey ?? "").split(":");
  return parts[1] || "main";
}

/**
 * Main hook handler.
 */
const handler = async (event) => {
  if (event.type !== "command" || (event.action !== "new" && event.action !== "reset")) {
    return;
  }

  try {
    const workspaceDir = resolveWorkspaceDir(event);
    const agentId = resolveAgentId(event.sessionKey);
    const memoryDir = path.join(workspaceDir, "memory");

    // Scan for daily log files (top-level only — exclude clusters/ and archived/)
    let dirEntries;
    try {
      dirEntries = await fs.readdir(memoryDir, { withFileTypes: true });
    } catch {
      return; // memory/ doesn't exist yet
    }

    const dailyLogs = dirEntries
      .filter((e) => e.isFile() && DAILY_LOG_RE.test(e.name))
      .map((e) => path.join(memoryDir, e.name));

    if (dailyLogs.length <= CLUSTER_THRESHOLD) {
      return; // Not enough files to cluster
    }

    // Classify all daily logs by topic
    const classified = await classifyFiles(dailyLogs, agentId);

    // Group by topic
    const groups = {};
    for (const { file, topic } of classified) {
      if (!groups[topic]) groups[topic] = [];
      groups[topic].push(file);
    }

    // Append each group to its cluster file and move originals to archived/
    for (const [topic, files] of Object.entries(groups)) {
      await appendToCluster({ topic, files, workspaceDir });
    }
  } catch (err) {
    // Fail silently — clustering is best-effort, never interrupt main flow
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[memory-clustering] ${msg}`);
  }
};

export default handler;
