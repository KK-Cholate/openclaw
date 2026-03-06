/**
 * LLM-based (or heuristic fallback) topic classifier for memory files.
 * Topics: Project | Coding | Personal | Other
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const VALID_TOPICS = ["Project", "Coding", "Personal", "Other"];

/**
 * Resolve LLM credentials from auth-profiles.json or environment variables.
 * Returns { key, provider, model } or null if unavailable.
 */
async function resolveCredentials(agentId) {
  // 1. Try auth-profiles.json
  const stateDir = path.join(os.homedir(), ".openclaw");
  const profilesPath = path.join(stateDir, "agents", agentId, "agent", "auth-profiles.json");
  try {
    const raw = await fs.readFile(profilesPath, "utf-8");
    const data = JSON.parse(raw);
    const profiles = data.profiles ?? {};
    for (const [, profile] of Object.entries(profiles)) {
      if (profile.type === "api_key" && profile.key) {
        return { key: profile.key, provider: profile.provider ?? "openrouter" };
      }
    }
  } catch {
    // fall through
  }

  // 2. Try environment variables
  if (process.env.OPENROUTER_API_KEY) {
    return { key: process.env.OPENROUTER_API_KEY, provider: "openrouter" };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { key: process.env.ANTHROPIC_API_KEY, provider: "anthropic" };
  }
  if (process.env.OPENAI_API_KEY) {
    return { key: process.env.OPENAI_API_KEY, provider: "openai" };
  }

  return null;
}

/**
 * Call LLM to classify a batch of files.
 * Returns array of { file, topic }.
 */
async function classifyBatchViaLLM(filePaths, credentials) {
  const contents = await Promise.all(
    filePaths.map(async (fp, idx) => {
      try {
        const raw = await fs.readFile(fp, "utf-8");
        return `[${idx + 1}] ${raw.slice(0, 600)}`;
      } catch {
        return `[${idx + 1}] (unreadable)`;
      }
    }),
  );

  const prompt = `Classify each of the following ${filePaths.length} work session logs into one category:
- Project: project planning, requirements, architecture, task management
- Coding: code implementation, debugging, API usage, technical issues
- Personal: user preferences, habits, settings, non-technical topics
- Other: unclassifiable

${contents.join("\n\n")}

Output ONLY the index:category pairs separated by spaces, e.g.: 1:Coding 2:Project 3:Personal
No explanation. No other text.`;

  try {
    let url, headers, body;

    if (credentials.provider === "anthropic") {
      url = "https://api.anthropic.com/v1/messages";
      headers = {
        "Content-Type": "application/json",
        "x-api-key": credentials.key,
        "anthropic-version": "2023-06-01",
      };
      body = JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 100,
        messages: [{ role: "user", content: prompt }],
      });
    } else if (credentials.provider === "openai") {
      url = "https://api.openai.com/v1/chat/completions";
      headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.key}`,
      };
      body = JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 100,
        messages: [{ role: "user", content: prompt }],
      });
    } else {
      // openrouter (default) — OpenAI-compatible
      url = "https://openrouter.ai/api/v1/chat/completions";
      headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.key}`,
      };
      body = JSON.stringify({
        model: "openai/gpt-4o-mini",
        max_tokens: 100,
        messages: [{ role: "user", content: prompt }],
      });
    }

    const response = await fetch(url, { method: "POST", headers, body });
    const data = await response.json();

    let text = "";
    if (credentials.provider === "anthropic") {
      text = data?.content?.[0]?.text ?? "";
    } else {
      text = data?.choices?.[0]?.message?.content ?? "";
    }

    return filePaths.map((file, idx) => {
      const match = text.match(new RegExp(`${idx + 1}:(\\w+)`));
      const topic = match?.[1] && VALID_TOPICS.includes(match[1]) ? match[1] : "Other";
      return { file, topic };
    });
  } catch {
    return filePaths.map((file) => ({ file, topic: "Other" }));
  }
}

/**
 * Heuristic topic classification based on filename slug and content keywords.
 * Used as fallback when no LLM credentials are available.
 */
async function classifyHeuristic(filePaths) {
  const CODING_WORDS = /debug|fix|error|code|api|test|build|deploy|bug|refactor|function|class|import|npm|git|typescript|javascript|python/i;
  const PROJECT_WORDS = /plan|project|task|feature|design|arch|roadmap|sprint|milestone|goal|requirement|spec|review/i;
  const PERSONAL_WORDS = /config|setup|prefer|personal|user|setting|profile|habit|account|password/i;

  return Promise.all(
    filePaths.map(async (file) => {
      const name = path.basename(file, ".md");
      let content = "";
      try {
        content = (await fs.readFile(file, "utf-8")).slice(0, 800);
      } catch {}
      const text = name + " " + content;

      let topic = "Other";
      if (CODING_WORDS.test(text)) topic = "Coding";
      else if (PROJECT_WORDS.test(text)) topic = "Project";
      else if (PERSONAL_WORDS.test(text)) topic = "Personal";

      return { file, topic };
    }),
  );
}

/**
 * Classify an array of file paths by topic.
 * Uses LLM if credentials available, otherwise falls back to heuristic.
 */
export async function classifyFiles(filePaths, agentId) {
  if (filePaths.length === 0) return [];

  const credentials = await resolveCredentials(agentId);
  if (!credentials) {
    return classifyHeuristic(filePaths);
  }

  const BATCH_SIZE = 5;
  const results = [];
  for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
    const batch = filePaths.slice(i, i + BATCH_SIZE);
    const batchResults = await classifyBatchViaLLM(batch, credentials);
    results.push(...batchResults);
  }
  return results;
}
