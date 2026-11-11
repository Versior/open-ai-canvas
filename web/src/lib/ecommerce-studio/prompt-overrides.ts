/**
 * 后台改过的出图提示词：键是提示词编号（如 shot.main-white.composition），值替换内置写法。
 * 生图台打开时从服务端读一次放在这里，镜头规格、拍法、市场、风格、品类规则和微调取文字时先查它；
 * 没读到或没改过时一律用内置默认，出图照常进行。这个文件不依赖任何默认值，避免循环引用。
 */
let overrides: Readonly<Record<string, string>> = {};
let revision = 0;
const listeners = new Set<() => void>();

export function setStudioPromptOverrides(value: Record<string, string>) {
    overrides = Object.fromEntries(Object.entries(value).filter(([key, text]) => typeof key === "string" && typeof text === "string" && text.trim()));
    revision += 1;
    for (const listener of listeners) listener();
}

export function subscribeStudioPromptOverrides(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function studioPromptOverride(key: string): string | undefined {
    return overrides[key];
}

/** 有覆盖用覆盖，没有用内置默认。 */
export function studioPromptText(key: string, fallback: string) {
    return overrides[key] ?? fallback;
}

/** 覆盖每次更新都会变，界面用它判断要不要重新编译预览。 */
export function studioPromptOverridesRevision() {
    return revision;
}
