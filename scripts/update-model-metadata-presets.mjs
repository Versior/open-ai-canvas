import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

// Explicit maintenance command; the application never sends channel data to Pi.
const source = "https://pi.dev/api/models";
const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`Pi catalog returned HTTP ${response.status}`);
const raw = await response.text();
const catalog = JSON.parse(raw);
const models = [];
for (const [provider, entries] of Object.entries(catalog)) {
    for (const model of Object.values(entries)) {
        if (model.provider !== provider || typeof model.id !== "string" || typeof model.name !== "string" ||
            !Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0 ||
            !Number.isSafeInteger(model.maxTokens) || model.maxTokens <= 0 ||
            typeof model.reasoning !== "boolean" || !Array.isArray(model.input)) {
            throw new Error(`Unsupported Pi catalog entry in ${provider}`);
        }
        models.push({
            provider, id: model.id, name: model.name, context: model.contextWindow, output: model.maxTokens,
            reasoning: model.reasoning, vision: model.input.includes("image"),
            ...(Number.isSafeInteger(model.inputLimits?.images?.maxPerRequest) && model.inputLimits.images.maxPerRequest > 0
                ? { maxImages: model.inputLimits.images.maxPerRequest } : {}),
        });
    }
}
if (!models.length) throw new Error("Pi catalog is empty");
models.sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`, "en"));
const directory = new URL("../web/src/lib/data/", import.meta.url);
await mkdir(directory, { recursive: true });
const snapshot = JSON.stringify({
    source, fetchedAt: new Date().toISOString(), sha256: createHash("sha256").update(raw).digest("hex"), models,
}) + "\n";
await writeFile(new URL("model-metadata-presets.json", directory), snapshot);
const backendDirectory = new URL("../backend/internal/modelpreset/", import.meta.url);
await mkdir(backendDirectory, { recursive: true });
await writeFile(new URL("catalog.json", backendDirectory), snapshot);
console.log(`Updated ${models.length} model presets from Pi`);
