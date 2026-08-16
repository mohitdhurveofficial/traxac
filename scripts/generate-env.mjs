#!/usr/bin/env node
/**
 * Fills the blank secrets in a local .env so a new developer can run the app
 * with one command. Never overwrites a value that is already set.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
const examplePath = resolve(root, ".env.example");

if (!existsSync(envPath)) {
  copyFileSync(examplePath, envPath);
  console.log("[env] created .env from .env.example");
}

const GENERATED = { TRAXAC_MASTER_KEY: () => randomBytes(32).toString("base64") };

let contents = readFileSync(envPath, "utf8");
let changed = false;
for (const [key, generate] of Object.entries(GENERATED)) {
  const pattern = new RegExp(`^${key}=(.*)$`, "m");
  const match = pattern.exec(contents);
  if (!match) {
    contents += `\n${key}=${generate()}\n`;
    changed = true;
  } else if (!match[1].trim()) {
    contents = contents.replace(pattern, `${key}=${generate()}`);
    changed = true;
    console.log(`[env] generated ${key}`);
  }
}

if (changed) writeFileSync(envPath, contents);
console.log("[env] ready");
