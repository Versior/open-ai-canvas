/**
 * 电商节点在「画布节点」清单里怎么呈现。
 *
 * 那张清单原来只会说「商品节点」「信息图节点」——对电商画布等于什么都没说。
 * 一套上新有几十个节点，用户扫这张表的目的是**找东西和查漏**：
 * 哪张图还没认领清单、哪条卖点缺依据、交付还差几个目标、哪个节点有拦截项。
 *
 * 所以这里给两样：
 * 1. **一句话摘要**——每类节点说它自己最有信息量的那句，不是通用尺寸
 * 2. **分组**——按工作流阶段分，因为画布上节点本来就是按阶段铺开的，
 *    清单按同一个顺序排，两边的空间位置与列表位置能对上
 *
 * 判断一律复用各领域模块自己的函数（`ecommerceProductReady`、`ecommerceShotSetReady`……），
 * 不在这里重写一遍规则——两份规则一定会分叉，然后清单说的和卡片说的不一样。
 */
import { ecommerceProductReady, ecommerceProductViewCount, ECOMMERCE_PRODUCT_VIEWS, ecommerceCopyReady, ecommerceShotSetReady, ecommerceStyleReady, type EcommerceProductProfile } from "./ecommerce-contract";
import { ecommerceInfographicReady } from "./ecommerce-infographic";
import { ecommerceRevisionChain, ecommerceRevisionIssues, ecommerceRevisionShippingVersion } from "./ecommerce-revision";
import { ecommerceReplicaReady } from "./ecommerce-replica";
import { ecommerceTeardownReady } from "./ecommerce-teardown";
import { ecommerceAplusIssues, ecommerceAplusReady } from "./ecommerce-aplus";
import { ecommerceVideoBlocked, ecommerceVideoIssues, ecommerceVideoSeconds } from "./ecommerce-video";
import { ecommerceSizeChartIssues } from "./ecommerce-size-chart";
import { ECOMMERCE_PLATFORMS } from "./ecommerce-platform-specs";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

/**
 * 清单里的分组。
 *
 * 按**工作流阶段**分，不按节点类型分：类型分组会把「商品」和「卖点」拆到两个组里，
 * 但它们都是「这件事的已知事实」，用户找的时候是一起找的。
 * 顺序与画布上的空间顺序一致（上→下就是事实→成图→收尾）。
 */
export type EcommerceNodeGroupId = "facts" | "media" | "reference" | "finish";

export const ECOMMERCE_NODE_GROUPS: { id: EcommerceNodeGroupId; label: string; hint: string }[] = [
    { id: "facts", label: "商品与约束", hint: "商品档案、卖点、文案、品牌风格——后面所有图的依据" },
    { id: "media", label: "拍摄与成图", hint: "拍法清单、成品图、排版、信息图、复刻" },
    { id: "reference", label: "参考与拆解", hint: "竞品页面的结构结论" },
    { id: "finish", label: "成片与交付", hint: "视频、A+、改稿、交付清单" },
];

const GROUP_BY_TYPE: Partial<Record<string, EcommerceNodeGroupId>> = {
    [CanvasNodeType.Product]: "facts",
    [CanvasNodeType.SellingPoint]: "facts",
    [CanvasNodeType.Copy]: "facts",
    [CanvasNodeType.Style]: "facts",
    [CanvasNodeType.ShotRecipe]: "media",
    [CanvasNodeType.EcommerceStudio]: "media",
    [CanvasNodeType.Image]: "media",
    [CanvasNodeType.Layout]: "media",
    [CanvasNodeType.Infographic]: "media",
    [CanvasNodeType.Replica]: "media",
    [CanvasNodeType.Teardown]: "reference",
    [CanvasNodeType.EcommerceVideo]: "finish",
    [CanvasNodeType.Aplus]: "finish",
    [CanvasNodeType.Revision]: "finish",
    [CanvasNodeType.Delivery]: "finish",
};

export function ecommerceNodeGroup(node: CanvasNodeData): EcommerceNodeGroupId | null {
    return GROUP_BY_TYPE[node.type] ?? null;
}

/** 摘要的严重程度：缺东西是 warn，拦截项是 block。清单上据此点一个点。 */
export type EcommerceNodeFlag = "ok" | "warn" | "block";

export type EcommerceNodeSummary = {
    /** 一句话摘要。空串表示这类节点没有更好的说法，退回通用摘要。 */
    text: string;
    flag: EcommerceNodeFlag;
    /** 有内容但还没配齐。用于「只看没配齐的」筛选。 */
    incomplete: boolean;
};

const EMPTY: EcommerceNodeSummary = { text: "", flag: "ok", incomplete: false };

function join(parts: (string | number | false | undefined | null)[], separator = " · ") {
    return parts.filter((part) => part !== "" && part !== false && part !== undefined && part !== null).join(separator);
}

/** 商品档案的完成度：四项事实里填了几项 + 绑了几个视角。 */
function productSummary(profile: EcommerceProductProfile | undefined): EcommerceNodeSummary {
    if (!profile) return EMPTY;
    const facts = [profile.category, profile.appearance, profile.marks, profile.forbidden].filter((value) => value.trim()).length;
    const views = ecommerceProductViewCount(profile);
    const ready = ecommerceProductReady(profile);
    return {
        text: join([`档案 ${facts}/4 项`, views ? `视角 ${views}/${ECOMMERCE_PRODUCT_VIEWS.length}` : "未绑视角"]),
        flag: ready ? (views ? "ok" : "warn") : "warn",
        incomplete: !ready || views === 0,
    };
}

/**
 * 一类节点的摘要。
 *
 * 每一条都尽量回答「这个节点现在能不能往下走」——清单的价值在查漏，
 * 不在复述节点叫什么。
 */
export function ecommerceNodeSummary(node: CanvasNodeData): EcommerceNodeSummary {
    const metadata = node.metadata;
    switch (node.type) {
        case CanvasNodeType.EcommerceStudio: {
            const shots = metadata?.ecommerceStudio?.plan?.shots || [];
            const ready = shots.filter((shot) => shot.title.trim() && shot.duty.trim() && shot.prompt?.trim()).length;
            return { text: shots.length ? `${ready}/${shots.length} 张可出图` : "待规划画面", flag: ready && ready === shots.length ? "ok" : "warn", incomplete: !ready || ready !== shots.length };
        }
        case CanvasNodeType.Product:
            return productSummary(metadata?.productProfile);

        case CanvasNodeType.ShotRecipe: {
            const set = metadata?.shotSet;
            if (!set) return EMPTY;
            const shots = set.shots.length;
            return {
                text: shots ? `${shots} 张清单${set.global.trim() ? " · 有整组要求" : " · 缺整组要求"}` : "清单为空",
                flag: ecommerceShotSetReady(set) ? "ok" : "warn",
                incomplete: !ecommerceShotSetReady(set),
            };
        }

        case CanvasNodeType.SellingPoint: {
            const points = metadata?.sellingPoints || [];
            const missing = points.filter((point) => point.claim.trim() && !point.evidence.trim()).length;
            return {
                text: points.length ? `${points.length} 条${missing ? ` · ${missing} 条缺依据` : " · 依据齐全"}` : "还没有卖点",
                // 缺依据是提示不是拦截——但它是这套图里最容易变成虚假宣传的地方
                flag: missing ? "warn" : "ok",
                incomplete: !points.length || missing > 0,
            };
        }

        case CanvasNodeType.Copy: {
            const copy = metadata?.ecommerceCopy;
            if (!copy) return EMPTY;
            return {
                text: copy.price.trim() ? "含价格" : "价格留空（模型不会替你编）",
                flag: "ok",
                incomplete: !ecommerceCopyReady(copy),
            };
        }

        case CanvasNodeType.Style: {
            const style = metadata?.ecommerceStyle;
            if (!style) return EMPTY;
            return {
                text: join([style.name, style.palette.length ? `${style.palette.length} 色` : "无色板"]),
                flag: ecommerceStyleReady(style) ? "ok" : "warn",
                incomplete: !ecommerceStyleReady(style),
            };
        }

        case CanvasNodeType.Layout: {
            const layout = metadata?.ecommerceLayout;
            if (!layout) return EMPTY;
            return {
                text: join([layout.name, metadata?.ecommerceAspectRatio || "1:1", `${layout.blocks.length} 块文字`]),
                flag: "ok",
                incomplete: false,
            };
        }

        case CanvasNodeType.Infographic: {
            const info = metadata?.ecommerceInfographic;
            if (!info) return EMPTY;
            const sizeChartIssues = ecommerceSizeChartIssues(metadata?.ecommerceSizeChart).filter((issue) => issue.level === "block");
            const callouts = info.callouts.length;
            const hasTable = Boolean(info.table?.rows.some((row) => row.some((cell) => cell.trim())));
            return {
                text: join([info.headline.trim() || "无标题", callouts ? `${callouts} 条标注` : "无标注", hasTable ? "含表格" : ""]),
                flag: sizeChartIssues.length ? "block" : ecommerceInfographicReady(info) ? "ok" : "warn",
                incomplete: !ecommerceInfographicReady(info),
            };
        }

        case CanvasNodeType.Replica: {
            const replica = metadata?.ecommerceReplica;
            if (!replica) return EMPTY;
            const compose = replica.purpose === "compose";
            return {
                text: join([compose ? "溶图合成" : "复刻爆款", compose ? "" : `${replica.aspects.length} 个维度`]),
                flag: ecommerceReplicaReady(replica) ? "ok" : "warn",
                incomplete: !ecommerceReplicaReady(replica),
            };
        }

        case CanvasNodeType.Teardown: {
            const teardown = metadata?.ecommerceTeardown;
            if (!teardown) return EMPTY;
            const follow = teardown.outline.filter((row) => row.stance === "follow").length;
            return {
                text: join([`${teardown.findings.length} 条结论`, teardown.outline.length ? `大纲 ${teardown.outline.length} 行（${follow} 行跟着做）` : "无大纲"]),
                flag: ecommerceTeardownReady(teardown) ? "ok" : "warn",
                incomplete: !ecommerceTeardownReady(teardown),
            };
        }

        case CanvasNodeType.EcommerceVideo: {
            const video = metadata?.ecommerceVideo;
            if (!video) return EMPTY;
            const issues = ecommerceVideoIssues(video);
            const blocked = ecommerceVideoBlocked(issues);
            const shots = video.shots.filter((shot) => shot.imageNodeId).length;
            return {
                // 秒数 + 镜数是这条清单上最该先看的两项
                text: join([shots ? `${shots} 镜` : "无镜头", `${ecommerceVideoSeconds(video)}s`, video.platform]),
                flag: blocked ? "block" : issues.length ? "warn" : "ok",
                incomplete: !shots || blocked,
            };
        }

        case CanvasNodeType.Aplus: {
            const aplus = metadata?.ecommerceAplus;
            if (!aplus) return EMPTY;
            const issues = ecommerceAplusIssues(aplus);
            const blocked = issues.filter((issue) => issue.level === "block").length;
            return {
                text: aplus.blocks.length ? `${aplus.blocks.length} 块${blocked ? ` · ${blocked} 项超限` : ""}` : "还没有模块",
                flag: blocked ? "block" : ecommerceAplusReady(aplus) ? "ok" : "warn",
                incomplete: !ecommerceAplusReady(aplus),
            };
        }

        case CanvasNodeType.Revision: {
            const revisions = metadata?.ecommerceRevisions || [];
            if (!revisions.length) return { text: "还没有版本", flag: "warn", incomplete: true };
            const chain = ecommerceRevisionChain(revisions);
            const blocked = ecommerceRevisionIssues(revisions).some((issue) => issue.level === "block");
            return {
                text: `v${ecommerceRevisionShippingVersion(revisions)} 在采用 · 共 ${chain.length} 版`,
                flag: blocked ? "block" : "ok",
                incomplete: false,
            };
        }

        case CanvasNodeType.Delivery: {
            const delivery = metadata?.ecommerceDelivery;
            if (!delivery) return EMPTY;
            const targets = delivery.targets.length;
            const names = delivery.targets.map((target) => ECOMMERCE_PLATFORMS.find((platform) => platform.id === target.platformId)?.name || target.platformId);
            return {
                text: join([delivery.code.trim() || "无商品编码", targets ? `投放 ${names.join("/")}` : "无目标", `v${delivery.version}`]),
                flag: targets ? "ok" : "warn",
                incomplete: !targets || !delivery.code.trim(),
            };
        }

        case CanvasNodeType.Image: {
            // 产物图最关键的一件事是「认领了清单里的哪一行」——没认领的图生成时只用整组统一
            const shotId = metadata?.ecommerceShotId;
            const hasContent = Boolean(metadata?.content || metadata?.storageKey);
            if (!hasContent && !shotId) return { text: "空图节点", flag: "warn", incomplete: true };
            return {
                text: hasContent ? (shotId ? "已认领清单行" : "未认领清单行") : shotId ? "待生成（已认领）" : "待生成",
                flag: hasContent ? (shotId ? "ok" : "warn") : "warn",
                incomplete: !hasContent,
            };
        }

        default:
            return EMPTY;
    }
}
