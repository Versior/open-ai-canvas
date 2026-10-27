/** Kept stable between input comparison and resource-promotion rewriting. */
export function canvasBatchInputToken(nodeId: string, content: string) {
    let hash = 2166136261;
    for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619);
    return `${nodeId}:${content.length}:${hash >>> 0}`;
}

const signatureFields = new Set(["batchInputSignature", "batchResultInputSignature", "generatedInputSignature"]);

function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Only rebase identities proven to be the same resource in this upload, never current row inputs. */
export function rebaseCanvasBatchInputSignatures<T>(before: T, prepared: T, uploaded: ReadonlyMap<string, string>): T {
    if (!uploaded.size) return prepared;
    const tokens = new Map<string, string>();
    const mediaKeys = new Map<string, string>();
    const collect = (left: unknown, right: unknown) => {
        if (Array.isArray(left) && Array.isArray(right)) {
            left.forEach((child, index) => collect(child, right[index]));
            return;
        }
        const a = record(left),
            b = record(right);
        if (!a || !b) return;
        if (typeof a.id === "string" && a.id === b.id) {
            // Canvas image nodes and frozen ReferenceImage entries both carry the original node ID.
            const mediaNode = typeof a.type === "string" && ["image", "video", "audio"].includes(a.type);
            const source = mediaNode && record(a.metadata) ? record(a.metadata) : typeof a.dataUrl === "string" ? a : undefined;
            const target = mediaNode && record(b.metadata) ? record(b.metadata) : typeof a.dataUrl === "string" ? b : undefined;
            const oldKey = source?.storageKey,
                newKey = target?.storageKey;
            if (typeof oldKey === "string" && typeof newKey === "string" && oldKey !== newKey && uploaded.get(oldKey) === newKey) {
                const oldToken = canvasBatchInputToken(a.id, oldKey);
                tokens.set(oldToken, canvasBatchInputToken(a.id, newKey));
                mediaKeys.set(oldToken, newKey);
            }
        }
        Object.entries(a).forEach(([key, child]) => collect(child, b[key]));
    };
    collect(before, prepared);
    if (!tokens.size) return prepared;

    const rewriteCreativePlanSignature = (value: string) => {
        let signature: unknown;
        try {
            signature = JSON.parse(value);
        } catch {
            return value;
        }
        if (
            !Array.isArray(signature) ||
            signature.length !== 8 ||
            typeof signature[0] !== "string" ||
            typeof signature[1] !== "string" ||
            typeof signature[2] !== "string" ||
            !Array.isArray(signature[3]) ||
            typeof signature[4] !== "string" ||
            typeof signature[5] !== "string" ||
            !Array.isArray(signature[6]) ||
            !Array.isArray(signature[7])
        )
            return value;
        const reference = tokens.get(signature[4]) || signature[4];
        const images = signature[7].map((token: unknown) => (typeof token === "string" ? tokens.get(token) || token : token));
        return reference !== signature[4] || images.some((token, index) => token !== signature[7][index])
            ? JSON.stringify([...signature.slice(0, 4), reference, ...signature.slice(5, 7), images])
            : value;
    };
    const rewriteSignature = (value: string) => {
        let signature: unknown;
        try {
            signature = JSON.parse(value);
        } catch {
            return value;
        }
        if (!Array.isArray(signature)) return value;
        let changed = false;
        if (signature.length === 3 && Array.isArray(signature[1]) && Array.isArray(signature[2])) {
            const images = signature[1].map((token: unknown) => {
                const replacement = typeof token === "string" ? tokens.get(token) : undefined;
                if (replacement === undefined) return token;
                changed = true;
                return replacement;
            });
            return changed ? JSON.stringify([signature[0], images, signature[2]]) : value;
        }
        if (signature.length === 8 && Array.isArray(signature[1])) {
            const references = signature[1].map((reference: unknown) => {
                if (!Array.isArray(reference) || typeof reference[0] !== "string" || typeof reference[1] !== "string") return reference;
                const replacement = mediaKeys.get(canvasBatchInputToken(reference[0], reference[1]));
                if (replacement === undefined) return reference;
                changed = true;
                return [reference[0], replacement, ...reference.slice(2)];
            });
            return changed ? JSON.stringify([signature[0], references, ...signature.slice(2)]) : value;
        }
        return value;
    };
    const rewrite = (value: unknown): unknown => {
        if (!value || typeof value !== "object") return value;
        if (Array.isArray(value)) {
            const next = value.map(rewrite);
            return next.some((child, index) => child !== value[index]) ? next : value;
        }
        const current = value as Record<string, unknown>;
        const creativePlanSource = typeof current.targetNodeId === "string" && typeof current.referenceVideoId === "string";
        const entries = Object.entries(current).map(([key, child]) => {
            const next =
                typeof child === "string" && (key === "planSourceSignature" || (key === "signature" && creativePlanSource))
                    ? rewriteCreativePlanSignature(child)
                    : signatureFields.has(key) && typeof child === "string"
                      ? rewriteSignature(child)
                      : rewrite(child);
            return [key, next] as const;
        });
        return entries.some(([key, child]) => child !== current[key]) ? Object.fromEntries(entries) : value;
    };
    return rewrite(prepared) as T;
}
