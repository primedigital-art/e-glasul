#!/usr/bin/env node
// Poarta statică pentru migrații. Complementară gate-urilor C*/T* (care rulează pe DB viu):
// aceasta prinde pattern-urile periculoase ÎNAINTE de a fi aplicate, direct din SQL.
// Un pattern periculos e permis DOAR dacă fișierul conține markerul:
//   -- guard-approved: ADR-NNNN
// iar ADR-ul respectiv există în docs/decisions/.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const DECISIONS_DIR = "docs/decisions";

// [regex, descriere]. Comentariile SQL sunt eliminate înainte de verificare,
// deci mențiunile din comentarii nu declanșează fals pozitiv.
const DANGEROUS = [
  [/\bdrop\s+policy\b/i, "DROP POLICY"],
  [/\balter\s+policy\b/i, "ALTER POLICY"],
  [/\bdrop\s+table\b/i, "DROP TABLE"],
  [/\bdisable\s+row\s+level\s+security\b/i, "DISABLE ROW LEVEL SECURITY"],
  [/\btruncate\b/i, "TRUNCATE"],
  [/\bsecurity\s+definer\b/i, "SECURITY DEFINER"],
  [/\bdrop\s+function\b/i, "DROP FUNCTION"],
  [/\bgrant\b[^;]*\bto\s+anon\b/i, "GRANT ... TO anon"],
];

const APPROVAL = /--\s*guard-approved:\s*(ADR-\d{4})/g;

function stripSqlComments(sql) {
  return sql
    .replace(/--[^\n]*/g, "") // comentarii de linie
    .replace(/\/\*[\s\S]*?\*\//g, ""); // comentarii bloc
}

let failures = 0;
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

for (const file of files) {
  const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  const code = stripSqlComments(raw);

  const approvals = [...raw.matchAll(APPROVAL)].map((m) => m[1]);
  const missingAdrs = approvals.filter(
    (adr) =>
      !readdirSync(DECISIONS_DIR).some((d) => d.startsWith(adr + "-")) &&
      !existsSync(join(DECISIONS_DIR, adr + ".md"))
  );

  const hits = DANGEROUS.filter(([re]) => re.test(code)).map(([, name]) => name);

  if (hits.length > 0 && approvals.length === 0) {
    failures++;
    console.error(`✗ ${file}: pattern periculos fără aprobare: ${hits.join(", ")}`);
    console.error(`  Adaugă "-- guard-approved: ADR-NNNN" DOAR dacă există un ADR acceptat care justifică.`);
  } else if (hits.length > 0 && missingAdrs.length > 0) {
    failures++;
    console.error(`✗ ${file}: marker către ADR inexistent: ${missingAdrs.join(", ")}`);
  } else if (hits.length > 0) {
    console.log(`⚠ ${file}: pattern periculos (${hits.join(", ")}) aprobat prin ${approvals.join(", ")}`);
  } else {
    console.log(`✓ ${file}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} migrație(i) blocate de guard.`);
  process.exit(1);
}
console.log(`\nToate cele ${files.length} migrații trec guard-ul.`);
