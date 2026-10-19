/**
 * 交付——出图之后到上架之前的那一段。
 *
 * 调研里最一致的发现：AI 工具在「生」上卷得厉害，但设计师的钱和时间花在
 * **改、套、配、审、名、装、传**上。这一段目前全靠人肉 + 云盘 + 表格：
 *
 * - 命名规范在行业里是纯 SOP 教育（大量教程的存在本身就是证明没有工具）
 * - 版本号靠「最终版 / 最终版2 / 打死不改版」，运营说「回到上一版」只能凭记忆重做
 * - 多平台尺寸适配的工具全在生成工具之外，出图 → 导出 → 换工具 → 改名 → 打包，五步割裂
 * - 平台校验是事后独立扫描，不合规会直接导致 listing 被压制
 *
 * 交付节点把这一段收进画布：**汇总这一套图 → 逐张按平台校验 → 按规范命名 →
 * 导出一份可以直接核对的清单**。不替代上传（平台 API 各有各的门槛），
 * 但把「能不能上架」这件事在导出前说清楚。
 */
import { checkImageAgainstSpec, ecommerceRoleSpec, ecommerceFileName, type EcommerceImageRole, type EcommercePlatformId, type EcommerceSpecIssue } from "./ecommerce-platform-specs";
import type { CanvasNodeData } from "@/types/canvas";

/** 一个交付目标：发到哪个平台的哪个位置。 */
export type EcommerceDeliveryTarget = {
    id: string;
    platformId: EcommercePlatformId;
    role: EcommerceImageRole;
};

export function createEcommerceDeliveryTarget(platformId: EcommercePlatformId = "taobao", role: EcommerceImageRole = "main"): EcommerceDeliveryTarget {
    return { id: `target-${Math.random().toString(36).slice(2, 10)}`, platformId, role };
}

export type EcommerceDelivery = {
    name: string;
    /** 商品编码，进文件名。留空则用 ITEM。 */
    code: string;
    /** 这一批交付到哪些位置。 */
    targets: EcommerceDeliveryTarget[];
    /** 版本号。只增不减——行业硬规矩，禁用「最终版」。 */
    version: number;
};

export function createEcommerceDelivery(name = "未命名交付"): EcommerceDelivery {
    return { name, code: "", targets: [createEcommerceDeliveryTarget("taobao", "main")], version: 1 };
}

/**
 * 一张图在交付清单里的一行。
 *
 * facts 里的宽高字节由调用方量好传进来；量不到就留 undefined，校验会跳过对应项，
 * 不用猜测填满报告。
 */
export type EcommerceDeliveryEntry = {
    nodeId: string;
    title: string;
    /** 按交付规范生成的文件名。 */
    fileName: string;
    width: number;
    height: number;
    bytes?: number;
    /** 逐张、逐目标的校验结果。 */
    issues: (EcommerceSpecIssue & { targetId: string })[];
};

/** The canvas box is a display size; only original media metadata is evidence. */
export function buildEcommerceDeliveryEntry(image: CanvasNodeData, delivery: EcommerceDelivery, target: EcommerceDeliveryTarget, index: number): EcommerceDeliveryEntry {
    const positive = (value: number | undefined) => value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
    const width = positive(image.metadata?.naturalWidth);
    const height = positive(image.metadata?.naturalHeight);
    const bytes = positive(image.metadata?.bytes);
    const facts = { width: width ?? NaN, height: height ?? NaN, bytes };
    const spec = ecommerceRoleSpec(target.platformId, target.role);
    const missing: string[] = [];
    if (!spec) missing.push("平台用途规范");
    if (spec && (spec.minWidth || spec.minHeight || spec.ratio || spec.allowedRatios?.length) && (!width || !height)) missing.push("原图尺寸与比例");
    if (spec?.maxBytes && !bytes) missing.push("文件大小");
    if (spec?.whiteBackground) missing.push("纯白背景");
    if (spec?.minSubjectRatio) missing.push("主体占比");
    if (spec?.noText || spec?.maxTextRatio) missing.push("文字面积");
    if (spec?.maxBadges !== undefined) missing.push("角标数量");
    if (spec?.maxBorderRatio !== undefined) missing.push("边框留白");
    if (spec?.requiresAiDisclosure) missing.push("AI 标识");
    return {
        nodeId: image.id, title: image.title || image.id,
        fileName: ecommerceDeliveryFileName(delivery, target, index, image.metadata?.ecommerceShotId ? undefined : image.title || undefined),
        width: width ?? NaN, height: height ?? NaN, bytes,
        issues: [
            ...checkImageAgainstSpec({ ...target, facts }).map(issue => ({ ...issue, targetId: target.id })),
            ...missing.map(item => ({ level: "warn" as const, scope: "检测覆盖", message: `未检测：${item}`, targetId: target.id })),
        ],
    };
}

/** 清单的汇总数字，用于节点卡片页脚与导出摘要。 */
export function ecommerceDeliverySummary(entries: EcommerceDeliveryEntry[]) {
    const blocked = entries.filter((entry) => entry.issues.some((issue) => issue.level === "block")).length;
    const warned = entries.filter((entry) => !entry.issues.some((issue) => issue.level === "block") && entry.issues.length).length;
    return { total: entries.length, blocked, warned, clean: entries.length - blocked - warned };
}

/**
 * 交付清单 CSV。
 *
 * 字段照着行业里跑通的交付清单来：源节点、用途、文件名、尺寸、校验结果。
 * 加 BOM，否则 Excel 打开中文是乱码——这一条是交付件能不能用的分水岭。
 */
export function ecommerceDeliveryCsv(entries: EcommerceDeliveryEntry[]) {
    const header = ["节点", "标题", "文件名", "宽", "高", "大小KB", "校验"];
    const rows = entries.map((entry) => [
        entry.nodeId,
        entry.title,
        entry.fileName,
        Number.isFinite(entry.width) ? String(entry.width) : "未检测",
        Number.isFinite(entry.height) ? String(entry.height) : "未检测",
        entry.bytes ? String(Math.round(entry.bytes / 1024)) : "",
        entry.issues.length ? entry.issues.map((issue) => `${issue.level === "block" ? "拦" : "警"}:${issue.scope} ${issue.message}`).join(" / ") : "通过",
    ]);
    const escape = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
    return `﻿${[header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n")}\r\n`;
}

/** 按交付目标算一张图的文件名。多个目标时带上平台后缀，避免同名覆盖。 */
export function ecommerceDeliveryFileName(delivery: EcommerceDelivery, target: EcommerceDeliveryTarget, index: number, variant?: string) {
    const multi = delivery.targets.length > 1;
    return ecommerceFileName({
        code: delivery.code,
        role: target.role,
        index,
        version: delivery.version,
        variant,
        platformId: multi ? target.platformId : undefined,
    });
}

/**
 * 版本号只增不减。
 *
 * 行业里两条硬规矩：禁用「最终版」（当天能懂，两周失效），版本号作废不复用。
 * 所以这里是单调递增，不提供「回到上一版」——回退由保留旧文件实现，不改版本号。
 */
export function ecommerceNextVersion(version: number) {
    return Math.max(1, Math.floor(version) + 1);
}

/** 交付清单的文件名，跟着商品编码与版本走。 */
export function ecommerceDeliveryManifestName(delivery: EcommerceDelivery) {
    const code = delivery.code.trim() || "ITEM";
    return `${code}_交付清单_v${delivery.version}.csv`;
}
