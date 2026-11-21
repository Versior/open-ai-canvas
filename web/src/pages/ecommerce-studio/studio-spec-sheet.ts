import { checkStudioClaim, studioClaimSources, studioSpecRowIssue } from "@/lib/ecommerce-studio/claim-evidence";
import { studioScreenCopyIssue } from "@/lib/ecommerce-studio/detail-plan";
import type { StudioSetEntry } from "@/lib/ecommerce-studio/runs";
import { studioCopyLanguageIssue, studioCopyPair, studioTextRuns } from "@/lib/ecommerce-studio/typography";
import { STUDIO_TYPE_STACK, wrapStudioText } from "@/lib/ecommerce-studio/typeset";
import type { StudioProduct } from "@/lib/ecommerce-studio/types";
import { getResourceBlob, resourceStorageKey } from "@/services/api/resources";

export function isStudioSpecEntry(entry: StudioSetEntry) {
    return !entry.noText && (entry.layout === "spec" || entry.role === "detail-spec" || entry.role === "detail-size") && Boolean(entry.copy?.lines.length);
}

export function wrapStudioSpecText(value: string, width: number, measure: (text: string) => number) {
    const lines: string[] = [];
    let current = "";
    for (const run of studioTextRuns(value)) {
        const tokens = run.atomic ? [run.text] : run.text.match(/\n|[^\S\n]+|[A-Za-z]+(?:[-’'][A-Za-z]+)*|./gu) || [];
        for (const token of tokens) {
            if (token === "\n") {
                lines.push(current.trimEnd());
                current = "";
                continue;
            }
            if (measure(current + token) <= width) {
                current += token;
                continue;
            }
            if (current.trim()) lines.push(current.trimEnd());
            current = token.trimStart();
            if (measure(current) > width) {
                if (run.atomic) throw new Error(`数值与单位「${token}」超出列宽，请调整规格说明`);
                const wrapped = wrapStudioText(current, width, measure);
                current = wrapped.pop() || "";
                lines.push(...wrapped);
            }
        }
    }
    if (current.trim()) lines.push(current.trimEnd());
    return lines;
}

export function studioSpecCopy(product: StudioProduct, entry: StudioSetEntry) {
    const copy = entry.copy;
    if (!copy || !isStudioSpecEntry(entry)) throw new Error("当前屏没有可排版的规格定稿");
    const issue = studioScreenCopyIssue({ ...copy, eyebrow: entry.eyebrow, role: entry.role }) || studioCopyLanguageIssue(product, { ...copy, eyebrow: entry.eyebrow });
    if (issue) throw new Error(issue);
    const sources = studioClaimSources(product);
    for (const text of [entry.eyebrow || "", copy.headline, copy.subline, ...copy.lines]) {
        const checked = checkStudioClaim(text, sources);
        if (checked.issue) throw new Error(checked.issue);
    }
    const rows = copy.lines
        .filter((row) => row.trim())
        .map((row) => {
            const [label, value] = studioCopyPair(row);
            if (!label || !value) throw new Error(`请把「${row}」写成「项目｜数值与条件」，再导出规格图`);
            const mismatch = studioSpecRowIssue(label, value, sources);
            if (mismatch) throw new Error(mismatch);
            return { label, value };
        });
    return { ...copy, eyebrow: entry.eyebrow, rows };
}

export async function renderStudioSpecSheet(product: StudioProduct, entry: StudioSetEntry, resourceId: string) {
    const copy = studioSpecCopy(product, entry);
    const blob = await getResourceBlob(resourceStorageKey(resourceId));
    if (!blob) throw new Error("规格图所选的商品原图读取失败");
    const photo = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    try {
        canvas.width = 750;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法绘制规格图");
        const margin = 44,
            contentWidth = canvas.width - margin * 2,
            valueStart = 275;
        const layout = (text: string, width: number, size: number, weight: number) => {
            const font = `${weight} ${size}px ${STUDIO_TYPE_STACK}`;
            context.font = font;
            return { lines: wrapStudioSpecText(text, width, (line) => context.measureText(line).width), font, leading: Math.ceil(size * 1.44) };
        };
        const headings = [
            [copy.eyebrow || "", 23, 600],
            [copy.headline, 49, 700],
            [copy.subline, 29, 400],
        ] as const;
        const header = headings.filter(([text]) => text.trim()).map(([text, size, weight]) => layout(text, contentWidth, size, weight));
        const rows = copy.rows.map(({ label, value }) => {
            const name = layout(label, valueStart - margin - 22, 28, 500);
            const detail = layout(value, canvas.width - valueStart - margin, 30, 600);
            return { name, detail, height: Math.max(name.leading * name.lines.length, detail.leading * detail.lines.length) + 32 };
        });
        const photoHeight = 240;
        canvas.height = margin * 2 + header.reduce((sum, block) => sum + block.lines.length * block.leading + 12, 0) + photoHeight + 32 + rows.reduce((sum, row) => sum + row.height, 0);
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.textBaseline = "top";
        const draw = (block: ReturnType<typeof layout>, left: number, top: number, ink: string) => {
            context.font = block.font;
            context.fillStyle = ink;
            block.lines.forEach((line, index) => context.fillText(line, left, top + index * block.leading));
        };
        let top = margin;
        for (const block of header) {
            draw(block, margin, top, "#17252a");
            top += block.lines.length * block.leading + 12;
        }
        const scale = Math.min(contentWidth / photo.width, photoHeight / photo.height);
        context.drawImage(photo, (canvas.width - photo.width * scale) / 2, top + (photoHeight - photo.height * scale) / 2, photo.width * scale, photo.height * scale);
        top += photoHeight + 32;
        for (const row of rows) {
            context.fillStyle = "#bdc7c7";
            context.fillRect(margin, top, contentWidth, 1);
            draw(row.name, margin, top + 16, "#415152");
            draw(row.detail, valueStart, top + 16, "#17252a");
            top += row.height;
        }
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob((file) => (file ? resolve(file) : reject(new Error("规格图编码失败"))), "image/png"));
    } finally {
        photo.close();
        canvas.width = canvas.height = 0;
    }
}
