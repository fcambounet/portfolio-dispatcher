import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve("data");

export function appendJSONL(file: string, obj: unknown) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.appendFileSync(path.join(DATA, file), JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n");
}