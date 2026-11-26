/** Older system model records used a literal placeholder for an unset directory. */
export function modelGroupName(modelKey: string, displayName?: string) {
    const name = displayName?.trim();
    return name && name !== "未分类" ? name : modelKey.trim().replace(/^models\//, "");
}
