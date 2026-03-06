---
name: memory-clustering
description: "Auto-cluster memory files by topic when count exceeds threshold"
metadata:
  {
    "openclaw":
      {
        "events": ["command:new", "command:reset"],
        "requires": { "config": ["workspace.dir"] },
      },
  }
---

# Memory Clustering Hook

Automatically clusters dated memory files by topic (Project / Coding / Personal / Other)
when `memory/` contains more than 10 daily log files.

## What It Does

When you run `/new` or `/reset`:

1. **Counts daily logs** — scans `memory/YYYY-MM-DD-*.md` files
2. **Triggers when > 10** — classifies each file via LLM (or heuristic fallback)
3. **Clusters by topic** — appends content to `memory/clusters/{Topic}.md`
4. **Archives originals** — moves processed logs to `memory/archived/`

## Topics

- **Project**: project planning, requirements, architecture, task management
- **Coding**: code implementation, debugging, API usage, technical issues
- **Personal**: user preferences, habits, non-technical topics
- **Other**: uncategorized

## Configuration

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "memory-clustering": { "enabled": true }
      }
    }
  }
}
```
