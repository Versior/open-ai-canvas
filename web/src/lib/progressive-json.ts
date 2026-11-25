export function createProgressiveJSONReader<Field extends string, Item>(stringFields: readonly Field[], arrayField: string, readItem: (value: Record<string, unknown>, index: number) => Item | undefined) {
    const empty = () => ({ fields: {} as Partial<Record<Field, string>>, items: [] as Item[] });
    let snapshot = empty();
    let previous = "";
    let cursor = 0;
    let depth = 0;
    let complete = false;
    let quoted = false;
    let escaped = false;
    let stringStart = -1;
    let rootKey = "";
    let expectsKey = true;
    let arrayDepth = -1;
    let itemStart = -1;
    let itemIndex = 0;

    return {
        read(raw: string) {
            if (!raw.startsWith(previous)) {
                snapshot = empty();
                cursor = depth = itemIndex = 0;
                complete = quoted = escaped = false;
                stringStart = arrayDepth = itemStart = -1;
                rootKey = "";
                expectsKey = true;
            }
            previous = raw;
            for (; !complete && cursor < raw.length; cursor++) {
                const character = raw[cursor];
                if (depth === 0) {
                    if (character === "{") depth = 1;
                    continue;
                }
                if (quoted) {
                    if (escaped) {
                        escaped = false;
                        continue;
                    }
                    if (character === "\\") {
                        escaped = true;
                        continue;
                    }
                    if (character !== '"') continue;
                    quoted = false;
                    if (depth === 1) {
                        let value: string;
                        try {
                            value = JSON.parse(raw.slice(stringStart, cursor + 1)) as string;
                        } catch {
                            continue;
                        }
                        if (expectsKey) {
                            rootKey = value;
                            expectsKey = false;
                        } else {
                            const field = stringFields.find((key) => key === rootKey);
                            if (field !== undefined && snapshot.fields[field] !== value) snapshot = { ...snapshot, fields: { ...snapshot.fields, [field]: value } };
                        }
                    }
                    continue;
                }
                if (character === '"') {
                    quoted = true;
                    stringStart = cursor;
                } else if (character === "{" || character === "[") {
                    if (depth === 1 && character === "[" && rootKey === arrayField) {
                        arrayDepth = 2;
                        itemIndex = 0;
                        if (snapshot.items.length) snapshot = { ...snapshot, items: [] };
                    } else if (depth === arrayDepth && character === "{") itemStart = cursor;
                    depth++;
                } else if (character === "}" || character === "]") {
                    depth--;
                    if (character === "}" && itemStart >= 0 && depth === arrayDepth) {
                        const start = itemStart;
                        itemStart = -1;
                        let value: Record<string, unknown>;
                        try {
                            value = JSON.parse(raw.slice(start, cursor + 1)) as Record<string, unknown>;
                        } catch {
                            continue;
                        }
                        const item = readItem(value, itemIndex);
                        if (item !== undefined) snapshot = { ...snapshot, items: [...snapshot.items, item] };
                    }
                    if (character === "]" && depth === arrayDepth - 1) arrayDepth = -1;
                    if (depth === 0) complete = true;
                } else if (character === ",") {
                    if (depth === 1) {
                        expectsKey = true;
                        rootKey = "";
                    } else if (depth === arrayDepth) itemIndex++;
                }
            }
            return snapshot;
        },
    };
}
