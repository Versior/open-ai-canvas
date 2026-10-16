/**
 * 改稿版本链——一张图从第一版到上架那一版的完整记录。
 *
 * 这是调研里排第一的缺口，也是最不像「AI 功能」的一个：
 *
 * 设计师 80% 的时间在改，而 AI 工具 80% 的能力在「生成」。原话是「AI 生成的东西
 * 想微调比重做还麻烦」「想改个西瓜？对不起，你只能重新抽卡，然后祈祷——西瓜对了，
 * 背景又崩了」。更糟的是改稿**没有版本记录**：运营说「回到上一版」，设计师只能
 * 凭记忆重做。行业里能查到的实践全是 SOP 教育（文件名加 v1/v2、禁用「最终版」、
 * 会变的进标签不会变的进文件名），没有一款专门做电商图片版本管理的工具。
 *
 * 所以这一层不生成任何东西，只做两件事：
 * 1. **记清楚每一版为什么存在**——一句话的改动说明是必填项，不是备注
 * 2. **让版本可追溯**——从哪一版改的、改了什么、哪一版上架了
 *
 * 一条硬规矩：**版本号只增不减，禁用「最终版」。** 版本号作废不复用；
 * 「回到上一版」不改版本号，只是把旧的那一版标记为当前。
 */

/** 改动的种类。决定卡片上标什么颜色，也决定提示词里怎么描述这次改动。 */
export type EcommerceRevisionKind =
    | "first"
    | "local"
    | "color"
    | "background"
    | "compose"
    | "text"
    | "crop"
    | "regenerate";

export const ECOMMERCE_REVISION_KINDS: { id: EcommerceRevisionKind; label: string; hint: string }[] = [
    { id: "first", label: "初版", hint: "第一次生成，没有上一版" },
    { id: "local", label: "局部修改", hint: "圈一块区域改，其余部分必须保持原样" },
    { id: "color", label: "改色", hint: "换商品颜色或背景色系" },
    { id: "background", label: "换背景", hint: "商品不动，只换环境" },
    { id: "compose", label: "改构图", hint: "换角度、景别或主体位置" },
    { id: "text", label: "改文字", hint: "改文案或版式，画面不动" },
    { id: "crop", label: "裁切", hint: "只改画幅，不重新生成" },
    { id: "regenerate", label: "重出", hint: "整张重来。最后一招——能用局部改就别用这个" },
];

/** 需要圈选区域的改动种类——只有这些才走局部重绘。 */
export function ecommerceRevisionNeedsRegion(kind: EcommerceRevisionKind) {
    return kind === "local" || kind === "color";
}

export type EcommerceRevision = {
    id: string;
    /** 版本号。从 1 开始，只增不减，作废不复用。 */
    version: number;
    kind: EcommerceRevisionKind;
    /**
     * 这一版改了什么。**必填**——没有改动说明的版本链等于没有版本链，
     * 运营说「回到上一版」时还是没人知道上一版是什么。
     */
    change: string;
    /** 基于哪一版的 id 改的。初版为空。 */
    basedOn: string | null;
    /** 这一版对应的图片节点 id。 */
    imageNodeId: string;
    createdAt: string;
    /** 这一版是不是当前采用的。同一时刻只有一版为真。 */
    current: boolean;
};

export function createEcommerceRevision(input: { version: number; kind: EcommerceRevisionKind; change: string; basedOn: string | null; imageNodeId: string }): EcommerceRevision {
    return { id: `rev-${Math.random().toString(36).slice(2, 10)}`, createdAt: new Date().toISOString(), current: true, ...input };
}

/** 版本链：一张图的所有版本，按版本号升序。 */
export function ecommerceRevisionChain(revisions: EcommerceRevision[] | undefined) {
    return [...(revisions || [])].sort((a, b) => a.version - b.version);
}

/** 当前采用的那一版。可能没有——比如所有版本都被标成非当前。 */
export function ecommerceCurrentRevision(revisions: EcommerceRevision[] | undefined) {
    return ecommerceRevisionChain(revisions).find((revision) => revision.current);
}

export function ecommerceRevisionLabel(revision: EcommerceRevision) {
    const kind = ECOMMERCE_REVISION_KINDS.find((item) => item.id === revision.kind);
    return `v${revision.version} · ${kind?.label || revision.kind}`;
}

/**
 * 下一个版本号。
 *
 * 取已有最大值加一，而不是数组长度加一——删掉中间某一版时，长度会缩，
 * 版本号就会重复。行业硬规矩是作废不复用。
 */
export function ecommerceNextRevisionVersion(revisions: EcommerceRevision[] | undefined) {
    return ecommerceRevisionChain(revisions).reduce((max, revision) => Math.max(max, revision.version), 0) + 1;
}

/**
 * 从某一版接着改。
 *
 * 「回到上一版」在这里是**把旧版标成当前**，不是新建一版、也不是删掉后面的版本。
 * 后面的版本要留着——运营可能改主意又要回来，而且它们记录了走过的弯路。
 */
export function ecommerceSwitchCurrentRevision(revisions: EcommerceRevision[], targetId: string): EcommerceRevision[] {
    return revisions.map((revision) => ({ ...revision, current: revision.id === targetId }));
}

/** 从某一版分叉出去的新版本。basedOn 记的是那一版，所以链条能看出是从哪里岔开的。 */
export function ecommerceForkRevision(revisions: EcommerceRevision[], fromId: string, input: { kind: EcommerceRevisionKind; change: string; imageNodeId: string }) {
    const from = revisions.find((revision) => revision.id === fromId);
    if (!from) return revisions;
    const next = createEcommerceRevision({ ...input, version: ecommerceNextRevisionVersion(revisions), basedOn: fromId });
    return [...revisions.map((revision) => ({ ...revision, current: false })), next];
}

/** 有没有从这一版分叉出去——卡片上要标出来，否则用户不知道这一版已经被取代过。 */
export function ecommerceRevisionHasBranches(revisions: EcommerceRevision[], revisionId: string) {
    return revisions.some((revision) => revision.basedOn === revisionId);
}

/**
 * 版本链的完整性问题。
 *
 * 只报能确定的：缺改动说明、版本号重复、basedOn 指向不存在的版本、没有当前版本。
 * 这些都会让链条失去追溯能力，而追溯能力是它存在的全部理由。
 */
export type EcommerceRevisionIssue = { level: "block" | "warn"; message: string };

export function ecommerceRevisionIssues(revisions: EcommerceRevision[] | undefined): EcommerceRevisionIssue[] {
    const chain = ecommerceRevisionChain(revisions);
    if (!chain.length) return [];
    const issues: EcommerceRevisionIssue[] = [];

    const missingChange = chain.filter((revision) => !revision.change.trim());
    if (missingChange.length) {
        issues.push({ level: "block", message: `v${missingChange.map((revision) => revision.version).join("、v")} 没有写改了什么——没有改动说明的版本链等于没有版本链` });
    }

    const versions = chain.map((revision) => revision.version);
    const duplicated = versions.filter((version, index) => versions.indexOf(version) !== index);
    if (duplicated.length) {
        issues.push({ level: "block", message: `版本号 ${duplicated.join("、")} 重复了；版本号作废不复用，只能往上加` });
    }

    const ids = new Set(chain.map((revision) => revision.id));
    const broken = chain.filter((revision) => revision.basedOn && !ids.has(revision.basedOn));
    if (broken.length) {
        issues.push({ level: "block", message: `v${broken.map((revision) => revision.version).join("、v")} 记的上一版已经不存在，链条断了` });
    }

    if (!chain.some((revision) => revision.current)) {
        issues.push({ level: "warn", message: "没有标记当前采用的版本，交付时不知道该出哪一张" });
    }

    // 「重出」是最后一招：能用局部改就不该整张重来
    const regenerated = chain.filter((revision) => revision.kind === "regenerate");
    if (regenerated.length && regenerated.length >= chain.length - 1 && chain.length > 2) {
        issues.push({ level: "warn", message: `这一张已经整张重出 ${regenerated.length} 次——每次都换掉了上一版对的地方，试试局部修改` });
    }

    return issues;
}

export function ecommerceRevisionBlocked(issues: EcommerceRevisionIssue[]) {
    return issues.some((issue) => issue.level === "block");
}

/**
 * 把一次改动编译成给模型的指令。
 *
 * 局部修改的关键不是「改成什么」，而是「**其余部分必须保持原样**」——
 * 没有这句话，模型会顺手把整张图重新画一遍，这正是「西瓜对了背景又崩了」的成因。
 */
export function ecommerceRevisionPrompt(revision: EcommerceRevision, region?: { x: number; y: number; width: number; height: number }) {
    const change = revision.change.trim();
    if (!change) return "";
    if (!ecommerceRevisionNeedsRegion(revision.kind)) return change;
    const lines = [`只修改指定的区域，画面其余部分必须逐像素保持原样，不要重新生成整张图。`, `改动要求：${change}`];
    if (region) lines.push(`改动区域：横向 ${Math.round(region.x * 100)}%–${Math.round((region.x + region.width) * 100)}%，纵向 ${Math.round(region.y * 100)}%–${Math.round((region.y + region.height) * 100)}%`);
    return lines.join("\n");
}

/**
 * 交付时用哪一版。
 *
 * 交付清单要记「哪一版上架了」——调研里这是最乱的一环：换版后图片 URL 会变，
 * 平台会爬旧图，靠人肉 + 云盘 + 表格对照。所以这里把版本号直接写进文件名。
 */
export function ecommerceRevisionShippingVersion(revisions: EcommerceRevision[] | undefined) {
    return ecommerceCurrentRevision(revisions)?.version ?? 1;
}
