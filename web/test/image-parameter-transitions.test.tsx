import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import { ImageParameterSizeEditor } from "../src/components/image-parameter-fields";
import { imageParameterRequest, projectImageParameters, resolveImageParameters, updateImageParameterSchema, updateImageParameterSize, type ImageParameter } from "../src/lib/image-parameters";
import { IMAGE_RATIOS, imagePresetForRatio, imageSizeConfigWithPresets } from "../src/lib/image-size-presets";
import { defaultImageCapabilityConfig, type ImageCapabilityConfig } from "../src/lib/model-capabilities";
import { projectLogicalCapability } from "../src/lib/user-session";
import { capabilitySpecFromChannelModel } from "../src/pages/admin/logical-models/model-routing-capabilities";
import type { ChannelModel } from "../src/services/api/wallet";

const definitions: ImageParameter[] = [
    { name: "size", label: "画幅", type: "string", encoding: "pixels" },
    { name: "imageResolution", label: "分辨率", type: "string" },
];

function change(profile: ImageCapabilityConfig, name: string, patch: Partial<ImageParameter>, declared = definitions) {
    return updateImageParameterSchema(
        profile,
        profile.parameters!.map((field) => (field.name === name ? { ...field, ...patch } : field)),
        declared,
    );
}

function disabledProfile(encoding: "pixels" | "ratio" = "pixels") {
    return projectImageParameters(defaultImageCapabilityConfig(), [
        { ...definitions[0], encoding, enabled: false, values: [...IMAGE_RATIOS], default: "1:1" },
        { ...definitions[1], enabled: false, values: ["1k", "2k", "4k"], default: "2k" },
    ]);
}

function expectRatios(profile: ImageCapabilityConfig, tier: string, ratios = IMAGE_RATIOS) {
    expect(
        profile.size.presets
            ?.filter((preset) => preset.tier === tier)
            .map((preset) => preset.ratio)
            .sort(),
    ).toEqual([...ratios].sort());
}

describe("图片尺寸与分辨率配置顺序", () => {
    test("像素枚举的比例按钮反映真实选中项，不把同一个预设再标为自定义", () => {
        const base = defaultImageCapabilityConfig();
        const preset = imagePresetForRatio("1k", "1:1");
        base.size.presets = [preset];
        const field = { ...definitions[0], values: [preset.size], default: preset.size };
        const profile = projectImageParameters(base, [field]);
        const doc = new Window().document;
        doc.body.innerHTML = renderToStaticMarkup(<ImageParameterSizeEditor profile={profile} definition={field} onChange={() => {}} />);
        const group = doc.querySelector('[aria-label="默认输出"]')!;
        expect(group.querySelector('[aria-pressed="true"]')!.textContent).toBe("1:1");
        expect(group.querySelector('[aria-haspopup="dialog"]')!.textContent).toBe("自定义尺寸");
    });

    test.each([undefined, "auto"])("不把跟随模型默认和显式自动混为一谈：%s", (value) => {
        for (const values of [[], ["auto", "1:1"]]) {
            const profile = projectImageParameters(defaultImageCapabilityConfig(), [{ ...definitions[0], values, default: value }]);
            expect(imageParameterRequest(profile, {}, true)).toEqual(value ? { size: value } : {});
        }
    });

    test.each([true, false])("混合尺寸合同只展示一次比例，不把已有精确默认值改成比例（分组 %s）", (grouped) => {
        const base = defaultImageCapabilityConfig();
        base.size.presets = [imagePresetForRatio("1k", "1:1"), imagePresetForRatio("2k", "1:1")];
        base.size.defaultTier = "1k";
        const field = { ...definitions[0], values: ["auto", "1:1", "1024x1024", "2048x2048", "1600x960"], default: "1024x1024" };
        const profile = projectImageParameters(base, [field, { ...definitions[1], enabled: grouped, values: ["1k", "2k"], default: "1k" }]);
        const before = structuredClone(profile);
        const doc = new Window().document;
        doc.body.innerHTML = renderToStaticMarkup(
            <ImageParameterSizeEditor
                profile={profile}
                definition={definitions[0]}
                onChange={() => {
                    throw Error("不应在打开时写入");
                }}
            />,
        );
        const group = doc.querySelector('[role="group"][aria-label="默认输出"]')!;
        const buttons = [...group.querySelectorAll("button")];
        expect(buttons.map((b) => b.textContent)).not.toContain("1024x1024");
        expect(buttons.filter((b) => b.textContent === "1:1")).toHaveLength(1);
        expect(buttons.find((b) => b.textContent?.includes("自定义尺寸"))?.getAttribute("aria-pressed")).toBe("true");
        expect(group.textContent).toContain("1024 × 1024");
        expect(profile).toEqual(before);
    });

    test("纯比例协议不铺旧像素值，也不承诺自定义像素", () => {
        const field = { ...definitions[0], encoding: "ratio" as const, values: ["auto", "1:1", "1024x1024"], default: "1:1" };
        const profile = projectImageParameters(defaultImageCapabilityConfig(), [field]);
        const doc = new Window().document;
        doc.body.innerHTML = renderToStaticMarkup(<ImageParameterSizeEditor profile={profile} definition={field} onChange={() => {}} />);
        expect(doc.querySelector('[aria-label="默认输出"]')!.textContent).not.toContain("1024x1024");
        expect(doc.querySelector('[aria-label="支持的宽高比"]')!.textContent).not.toContain("1024x1024");
        expect(doc.body.textContent).not.toContain("自定义尺寸");
        expect(doc.querySelector('[aria-label="自定义比例"]')).not.toBeNull();
    });

    for (const encoding of ["pixels", "ratio"] as const) {
        test(`${encoding}: 两种开关顺序得到相同的完整配置`, () => {
            const initial = disabledProfile(encoding);
            const declared = definitions.map((field) => (field.name === "size" ? { ...field, encoding } : field));
            const enableSize = (profile: ImageCapabilityConfig) => change(profile, "size", { enabled: true }, declared);
            const enableResolution = (profile: ImageCapabilityConfig) => change(profile, "imageResolution", { enabled: true }, declared);
            const sizeFirst = enableResolution(enableSize(initial));
            const resolutionFirst = enableSize(enableResolution(initial));
            expect(resolutionFirst).toEqual(sizeFirst);
            for (const tier of ["1k", "2k", "4k"]) expectRatios(resolutionFirst, tier);
        });
    }

    test("先选全部尺寸再启用分辨率，保留精确尺寸并为其他档位继承全部比例", () => {
        let profile = change(disabledProfile(), "size", { enabled: true });
        const presets = IMAGE_RATIOS.map((ratio) => imagePresetForRatio("2k", ratio));
        presets[0] = { ...presets[0], width: 2000, height: 2000, size: "2000x2000" };
        profile = updateImageParameterSize(profile, { ...imageSizeConfigWithPresets(profile, presets), defaultTier: "2k" });
        const enabled = change(profile, "imageResolution", { enabled: true });
        for (const tier of ["1k", "2k", "4k"]) expectRatios(enabled, tier);
        expect(enabled.size.presets?.find((preset) => preset.tier === "2k" && preset.ratio === "1:1")).toEqual(presets[0]);

        const reopened = resolveImageParameters(JSON.parse(JSON.stringify(enabled)), definitions, "test-model");
        expect(reopened.size.presets).toEqual(enabled.size.presets);
        const spec = capabilitySpecFromChannelModel({ capability: "image", capabilityConfig: { version: 1, image: reopened } } as ChannelModel)!;
        const projected = projectLogicalCapability(spec, {}).image!;
        for (const tier of ["1k", "2k", "4k"]) {
            expectRatios(projected, tier);
            for (const ratio of IMAGE_RATIOS) {
                expect(imageParameterRequest(projected, { size: ratio, imageResolution: tier }, true)).toEqual({ size: ratio, imageResolution: tier });
            }
        }
    });

    test("先启用 1K 再添加 2K，比例不会被裁成常用六个", () => {
        let profile = change(disabledProfile(), "size", { enabled: true });
        profile = updateImageParameterSize(
            profile,
            imageSizeConfigWithPresets(
                profile,
                IMAGE_RATIOS.map((ratio) => imagePresetForRatio("2k", ratio)),
            ),
        );
        profile = change(profile, "imageResolution", { enabled: true, values: ["1k"], default: "1k" });
        expectRatios(profile, "1k");
        expect(profile.size.presets?.some((preset) => preset.tier === "2k")).toBe(false);
        profile = change(profile, "imageResolution", { values: ["1k", "2k"] });
        expectRatios(profile, "1k");
        expectRatios(profile, "2k");
    });

    test("切换默认分辨率沿用同一画幅的精确像素，跟随模型时继续省略尺寸", () => {
        const portrait = { tier: "1k", ratio: "9:16", width: 720, height: 1280, size: "720x1280" };
        const larger = { tier: "2k", ratio: "9:16", width: 1440, height: 2560, size: "1440x2560" };
        const size = { ...definitions[0], encoding: "pixels" as const, values: [portrait.size, larger.size] };
        const resolution = { ...definitions[1], values: ["1k", "2k"], default: "1k" };
        for (const initial of [undefined, portrait.size]) {
            const base = defaultImageCapabilityConfig();
            base.size.presets = [portrait, larger];
            const profile = projectImageParameters(base, [{ ...size, default: initial }, resolution]);
            const updated = change(profile, "imageResolution", { default: "2k" });
            expect(updated.parameters!.find((field) => field.name === "size")!.default).toBe(initial && larger.size);
            expect(updated.size.presets).toEqual(base.size.presets);
        }
    });

    test("混合像素合同切换首选档位只替换已映射的精确默认值", () => {
        const presets = [imagePresetForRatio("1k", "1:1"), imagePresetForRatio("2k", "1:1")];
        const base = defaultImageCapabilityConfig();
        base.size.presets = presets;
        for (const [before, after] of [
            ["1024x1024", "2048x2048"],
            ["1088x1088", "1088x1088"],
            ["1:1", "1:1"],
            [undefined, undefined],
        ]) {
            const values = ["auto", "1:1", "1024x1024", "2048x2048", "1088x1088"];
            const profile = projectImageParameters(base, [
                { ...definitions[0], values, default: before },
                { ...definitions[1], values: ["1k", "2k"], default: "1k" },
            ]);
            const changed = change(profile, "imageResolution", { default: "2k" });
            expect(changed.parameters![0].default).toBe(after);
            expect(changed.size.values).toEqual(values);
            expect(changed.size.presets).toEqual(presets);
        }
    });

    test("切换首选档时，目标像素不在支持值中则使用已声明的同一比例", () => {
        const base = defaultImageCapabilityConfig();
        base.size.presets = [imagePresetForRatio("1k", "1:1"), imagePresetForRatio("2k", "1:1")];
        const values = ["1:1", "1024x1024"];
        const profile = projectImageParameters(base, [
            { ...definitions[0], values, default: "1024x1024" },
            { ...definitions[1], values: ["1k", "2k"], default: "1k" },
        ]);
        const changed = change(profile, "imageResolution", { default: "2k" });
        expect(changed.parameters![0].default).toBe("1:1");
        expect(changed.size.values).toEqual(values);
        expect(imageParameterRequest(changed, {}, true)).toEqual({ size: "1:1", imageResolution: "2k" });
    });

    test("像素支持值也能通过已有预设继承比例，保留原始像素", () => {
        const presets = IMAGE_RATIOS.map((ratio) => imagePresetForRatio("1k", ratio));
        let profile = projectImageParameters(defaultImageCapabilityConfig(), [
            { ...definitions[0], values: presets.map((preset) => preset.size), default: presets[0].size },
            { ...definitions[1], values: ["1k"], default: "1k" },
        ]);
        profile = updateImageParameterSize(profile, { ...profile.size, presets });
        const next = change(profile, "imageResolution", { values: ["1k", "2k"] });
        expectRatios(next, "2k");
        expect(next.size.presets?.filter((preset) => preset.tier === "1k")).toEqual(presets);
    });

    test("已有档位的独立比例和手动清空结果不被补齐覆盖", () => {
        let profile = change(change(disabledProfile(), "size", { enabled: true }), "imageResolution", { enabled: true, values: ["1k", "2k"], default: "1k" });
        const exact = { ...imagePresetForRatio("1k", "16:9"), width: 1600, height: 900, size: "1600x900" };
        profile = updateImageParameterSize(profile, imageSizeConfigWithPresets(profile, [exact]));
        const next = change(profile, "imageResolution", { values: ["1k", "2k", "4k"] });
        expect(next.size.presets?.filter((preset) => preset.tier === "1k")).toEqual([exact]);
        expect(next.size.presets?.filter((preset) => preset.tier === "2k")).toEqual([]);
        expectRatios(next, "4k", ["16:9"]);
        expect(change(next, "imageResolution", { default: "4k" }).size.presets).toEqual(next.size.presets);
    });

    test("继承自定义比例但不超出插件声明", () => {
        const declared = [{ ...definitions[0], values: ["1:1", "17:11"] }, definitions[1]];
        let profile = projectImageParameters(defaultImageCapabilityConfig(), [
            { ...definitions[0], values: ["1:1", "17:11", "4:5"], default: "1:1" },
            { ...definitions[1], enabled: false, values: ["2k"], default: "2k" },
        ]);
        profile = change(profile, "imageResolution", { enabled: true }, declared);
        expectRatios(profile, "2k", ["1:1", "17:11"]);
    });

    test("编辑期间关闭再开启尺寸保留精确像素，禁用时不发送尺寸", () => {
        let profile = change(change(disabledProfile(), "size", { enabled: true }), "imageResolution", { enabled: true, values: ["2k"] });
        const exact = { ...imagePresetForRatio("2k", "16:9"), width: 2560, height: 1440, size: "2560x1440" };
        profile = updateImageParameterSize(profile, imageSizeConfigWithPresets(profile, [exact]));
        const disabled = change(profile, "size", { enabled: false });
        expect(imageParameterRequest(disabled, { size: "16:9", imageResolution: "2k" }, true)).toEqual({ imageResolution: "2k" });
        expect(change(disabled, "size", { enabled: true }).size.presets).toEqual([exact]);
    });

    test("没有换算规则的档位保留待填写比例并显示提示", () => {
        let profile = change(disabledProfile(), "size", { enabled: true, values: ["1:1", "17:11"] });
        profile = change(profile, "imageResolution", { enabled: true, values: ["panorama"], default: "panorama" });
        expectRatios(profile, "panorama", ["1:1", "17:11"]);
        expect(profile.size.presets?.every((preset) => preset.width === 0 && preset.height === 0 && preset.size === "")).toBe(true);
        const html = renderToStaticMarkup(<ImageParameterSizeEditor profile={profile} definition={definitions[0]} onChange={() => {}} />);
        expect(html).toContain("请填写所选比例的宽度和高度");
        expect(html).toContain('aria-label="PANORAMA 17:11 宽度像素"');
    });
});
