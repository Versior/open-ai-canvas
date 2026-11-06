/** CSV 在表格软件里打开时不能执行用户文案中的公式。 */
export function deliveryCsv(rows: readonly (readonly unknown[])[]) {
    return (
        "\uFEFF" +
        rows
            .map((row) =>
                row
                    .map((value) => {
                        let text = String(value ?? "");
                        if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
                        return `"${text.replace(/"/g, '""')}"`;
                    })
                    .join(","),
            )
            .join("\r\n")
    );
}

export function srtClock(ms: number) {
    const time = Math.max(0, Math.round(ms));
    return `${String(Math.floor(time / 3600000)).padStart(2, "0")}:${String(Math.floor(time / 60000) % 60).padStart(2, "0")}:${String(Math.floor(time / 1000) % 60).padStart(2, "0")},${String(time % 1000).padStart(3, "0")}`;
}

export function deliverySrt(lines: readonly { text: string; startMs: number; endMs: number }[]) {
    return lines
        .filter((line) => line.text.trim() && line.endMs > line.startMs)
        .map(
            (line, index) =>
                `${index + 1}\n${srtClock(line.startMs)} --> ${srtClock(line.endMs)}\n${line.text
                    .replace(/\r\n?/g, "\n")
                    .replace(/\n\s*\n/g, "\n")
                    .trim()}\n`,
        )
        .join("\n");
}

export function deliveryFileStem(value: string) {
    return (
        value
            .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "_")
            .replace(/^\.+|\.+$/g, "_")
            .trim()
            .slice(0, 80) || "方案"
    );
}

export function xmlText(value: string) {
    return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
}
