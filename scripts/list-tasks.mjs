#!/usr/bin/env node
// Index viu al backlog-ului. Citește frontmatter-ul din docs/tasks/TASK-*.md.
// Nu există index manual — indexul manual ar restata statusuri și ar putrezi.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "docs/tasks";
const files = readdirSync(DIR)
  .filter((f) => /^TASK-\d{4}-.*\.md$/.test(f))
  .sort();

const tasks = files.map((f) => {
  const raw = readFileSync(join(DIR, f), "utf8");
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const get = (k) =>
    fm.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? "";
  return {
    id: get("id"),
    title: get("title"),
    status: get("status"),
    blocked_by: get("blocked_by"),
    file: f,
  };
});

const order = ["in-progress", "review", "ready", "blocked", "done"];
tasks.sort(
  (a, b) =>
    order.indexOf(a.status) - order.indexOf(b.status) ||
    a.id.localeCompare(b.id),
);

for (const t of tasks) {
  const block =
    t.blocked_by && t.blocked_by !== "[]" ? `  ⛔ ${t.blocked_by}` : "";
  console.log(`${t.status.padEnd(12)} ${t.id}  ${t.title}${block}`);
}

const ready = tasks.filter((t) => t.status === "ready").length;
console.log(`\n${tasks.length} task-uri · ${ready} ready pentru agent`);
