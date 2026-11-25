import { expect, test } from "bun:test";
import { studioTemplatePlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { buildDetailPlanPrompt } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { studioImageInput } from "@/lib/ecommerce-studio/generation-input";
import { studioPlanInputSignature } from "@/lib/ecommerce-studio/plan-input";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { compileStudioPrompt } from "@/lib/ecommerce-studio/prompt-compiler";
import { studioSetEntries, type StudioSetEntry } from "@/lib/ecommerce-studio/runs";
import { studioSuiteFromTemplate, studioSuiteUse } from "@/lib/ecommerce-studio/suites";
import { studioTextRuns } from "@/lib/ecommerce-studio/typography";
import type { StudioShot } from "@/lib/ecommerce-studio/types";
import { studioSpecCopy, wrapStudioSpecText } from "@/pages/ecommerce-studio/studio-spec-sheet";
import { defaultConfig } from "@/stores/use-config-store";

function cup() {
    const product = createStudioProduct("synthetic-cup");
    product.name = "测试杯";
    product.sellerNotes = "杯高：24 厘米";
    product.photos = [{ id: "front", resourceId: "cup-front", url: "", truth: true, view: "front", addedAt: "" }];
    return product;
}

test("template keeps responsibilities after long photography instructions; image model owns design", () => {
    const product = cup();
    const suite = studioSuiteFromTemplate(
        {
            id: "library",
            flow: "detail",
            name: "选购",
            category: "家居",
            style: "风格".repeat(850) + "保留字阶",
            shots: [
                { title: "规格", duty: `确认真实商品\n镜头：${"camera ".repeat(200)}\n主体占比：58%\n留白：铭牌周围留白\n文字位置：右上标题区域\n画幅：2:3\n画面参考：不要复制的来源文案` },
                { title: "场景", duty: "实拍\n文字位置：none\n画幅：1:1" },
            ],
        },
        "library",
    );
    product.brief = { ...product.brief, suite, outputType: "template-set" };
    const prompt = buildDetailPlanPrompt(product, studioTemplatePlanRoles(product, suite), { scope: "template" });
    expect(prompt).not.toContain("主体占比：58%");
    expect(prompt).not.toContain("留白：铭牌周围留白");
    expect(prompt).not.toContain("文字位置：右上标题区域");
    expect(prompt).not.toContain("保留字阶");
    expect(prompt).not.toContain("不要复制的来源文案");
    expect(prompt).not.toContain("建议 role：detail-spec");
    expect(prompt).toContain("这张不放文字");
    expect(() => buildDetailPlanPrompt(product, studioTemplatePlanRoles(product, suite), { scope: "template" }, Array.from(prompt).length - 1)).toThrow("未提交策划任务");
    expect(() => buildDetailPlanPrompt(product, studioTemplatePlanRoles(product, suite), { scope: "template" }, 800)).toThrow("未提交策划任务");
    expect(studioSuiteUse(suite.shots)).toContain("混合");
    expect(studioSuiteUse(suite.shots.slice(1))).toContain("全套无字");
    expect(normalizeStudioProduct(product)?.brief.suite).toEqual(suite);
    expect(studioSetEntries(product)[0].duty).toContain("文字位置：右上标题区域");
    product.brief.ratio = "9:16";
    const overridden = buildDetailPlanPrompt(product, studioTemplatePlanRoles(product, suite), { scope: "template" });
    expect(overridden).toContain("画幅 9:16");
    expect(overridden).not.toContain("画幅 2:3");
    expect(buildDetailPlanPrompt(product, studioTemplatePlanRoles(product, suite), { scope: "detail" })).not.toContain("每屏画幅 3:4");
});

test("optional proof reference is priced as a real slot and cannot evict the product; unconfirmed proof isn't sent", () => {
    const product = cup();
    const shot: StudioShot = {
        id: "s",
        role: "detail-scene",
        title: "杯沿",
        ratio: "3:4",
        layout: "poster",
        visual: "杯身在右侧，杯沿形成视觉焦点",
        composition: "left",
        headline: "杯沿细节",
        subline: "",
        lines: [],
        tweaks: [],
        sellingPointIds: [],
        attempts: [],
    };
    const input = { product, brief: product.brief, shot, model: "gpt-image", maxReferences: 2 };
    expect(compileStudioPrompt(input).layoutGuide).toBeUndefined();
    const identity = studioPlanInputSignature(product);
    product.brief.useProofLayout = true;
    expect(studioPlanInputSignature(product)).toBe(identity);
    const compiled = compileStudioPrompt(input);
    expect(compiled.layoutGuide).toMatchObject({ proof: true, composition: "left" });
    expect(compiled.copySnapshot?.headline).toBe(shot.headline);
    expect(compiled.prompt).toContain("图2是卖家采用的定稿排版参考");
    const narrowShot = { ...shot, ratio: "1:4" };
    const sized = studioImageInput(product, { shot: narrowShot, textMode: "model", quality: "", resolution: "", fromForm: true }, "gpt-image-1", defaultConfig);
    expect(sized.request.aspectRatio).toBe("9:16");
    expect(sized.compiled.layoutGuide?.ratio).toBe(sized.request.aspectRatio);
    expect(sized.compiled.layers.find((layer) => layer.id === "planning-brief")?.text).toMatch(new RegExp(`画幅[：: ]+${sized.request.aspectRatio}`));
    expect(sized.compiled.prompt).not.toMatch(/画幅[：: ]+1:4/);
    expect(narrowShot.ratio).toBe("1:4");
    expect(() => compileStudioPrompt({ ...input, maxReferences: 1 })).toThrow("没有额外参考图名额");
    product.brief.language = "en";
    expect(compileStudioPrompt(input).layers.find((layer) => layer.id === "copy")?.text).toContain("英文");
    const lockedCopy = compileStudioPrompt({ ...input, shot: { ...shot, headline: "Cup rim", copySource: "user" } });
    expect(lockedCopy.layers.find((layer) => layer.id === "copy")?.text).toMatch(/「Cup rim」[^。]*逐字/);
});

test("specification export retains keys, units, and conditions; altered unsupported performance is blocked", () => {
    const product = cup();
    const entry: StudioSetEntry = { key: "p0", role: "detail-spec", title: "规格", purpose: "能否放得下", included: true, layout: "spec", copy: { headline: "外形尺寸", subline: "", lines: ["杯高 | 24 厘米"] } };
    expect(studioSpecCopy(product, entry).rows).toEqual([{ label: "杯高", value: "24 厘米" }]);
    expect(() => studioSpecCopy(product, { ...entry, copy: { ...entry.copy!, lines: ["保温｜24 小时"] } })).toThrow();
    expect(() => studioSpecCopy(product, { ...entry, copy: { ...entry.copy!, lines: ["没有项目分隔符"] } })).toThrow("项目｜数值");
    product.sellerNotes += "\n材质：不锈钢\n颜色：蓝色";
    expect(studioSpecCopy(product, { ...entry, copy: { ...entry.copy!, lines: ["材质｜不锈钢", "颜色｜蓝色"] } }).rows).toHaveLength(2);
    expect(() => studioSpecCopy(product, { ...entry, copy: { ...entry.copy!, lines: ["材质｜纯钛"] } })).toThrow();
    expect(() => studioSpecCopy(product, { ...entry, copy: { ...entry.copy!, lines: ["颜色｜红色"] } })).toThrow();
    const text = "柜内净宽至少 30 × 20 × 12 cm，以实测为准";
    expect(
        studioTextRuns(text)
            .filter((run) => run.atomic)
            .map((run) => run.text),
    ).toEqual(["30 × 20 × 12 cm"]);
    expect(wrapStudioSpecText(text, 16, (item) => item.length).some((line) => line.includes("30 × 20 × 12 cm"))).toBe(true);
    expect(() => wrapStudioSpecText("30 × 20 × 12 cm", 10, (item) => item.length)).toThrow("单位");
});
