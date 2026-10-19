import type { EcommerceOneClickFlow } from './ecommerce-oneclick';
import type { EcommerceSuiteRow } from './ecommerce-suite';

export type EcommerceBrief = { platform?: string; imageCount?: number; sellingPoints?: string; audience?: string; language?: string; forbidden?: string; style?: string };

export function ecommerceBriefRows(flow: EcommerceOneClickFlow, rows: EcommerceSuiteRow[], brief?: EcommerceBrief) {
    const count = brief?.imageCount;
    if (count === undefined) return rows;
    if (!Number.isInteger(count) || count < 1 || count > 30) throw new Error('计划张数须为 1–30 张');
    return Array.from({ length: count }, (_, index) => rows[index] || { slotId: `${flow.id}-extra-${index + 1}`, title: `第 ${index + 1} 张`, duty: '按商品事实与本套用途规划', prompt: '' });
}

export function ecommerceBriefBlock(brief?: EcommerceBrief) {
    if (!brief) return '';
    const lines = [brief.platform && `发布平台：${brief.platform}`, brief.imageCount && `严格输出 ${brief.imageCount} 张，每张一行`, brief.sellingPoints && `卖点与依据：${brief.sellingPoints}`, brief.audience && `人群与场景：${brief.audience}`, brief.language && `图上文案语言：${brief.language}`, brief.forbidden && `禁止宣称与禁止改动：${brief.forbidden}`, brief.style && `整套视觉规范（所有画面保持一致）：${brief.style}`].filter(Boolean);
    return lines.length ? `【用户补充信息】\n${lines.join('\n')}` : '';
}
