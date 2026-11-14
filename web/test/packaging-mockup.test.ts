import { afterEach, describe, expect, test } from "bun:test";
import { packagingMockupConfig, packagingMockupInput, packagingMockupPrompt, packagingMockupRequirements, packagingMockupScenes } from "../src/lib/packaging/mockup";
import { defaultImageParamsForModel } from "../src/lib/model-selection";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { newPackagingDocument, type PackagingProject } from "../src/lib/packaging/types";
import { defaultConfig } from "../src/stores/use-config-store";
import { apiClient } from "../src/services/api/request";
import { submitPackagingMockup } from "../src/services/packaging-generation";
import type { CreateTaskInput } from "../src/services/api/task-center";

const originalAdapter = apiClient.defaults.adapter;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    if (!originalWindow) Reflect.deleteProperty(globalThis, "window");
});

const project: PackagingProject = {
    id: "packaging-qa",
    userId: "qa",
    name: "包装",
    templateId: "tuck",
    revision: 1,
    createdAt: "",
    updatedAt: "",
    document: newPackagingDocument(
        {
            id: "tuck",
            name: "双插盒",
            category: "折叠纸盒",
            structure: "tuck",
            description: "",
            enabled: true,
            defaults: { length: 120, width: 60, height: 80, thickness: 0.45, bleed: 3, glue: 12, tab: 15, gap: 1, frontHeight: 30, windowWidth: 0, windowHeight: 0, inflation: 0.6, spoutRadius: 8 },
        },
        { id: "card", name: "白卡", color: "#ffffff", insideColor: "#eeeeee", thickness: 0.45, roughness: 0.65, metalness: 0, enabled: true },
    ),
};

function configFor(maxImages: number) {
    const profile = defaultModelCapabilityConfig("openai-image", "qa-image");
    profile.image!.references.maxImages = maxImages;
    const base = {
        ...defaultConfig,
        model: "qa::qa-image",
        imageModel: "qa::qa-image",
        channels: [
            {
                id: "qa",
                name: "QA",
                baseUrl: "https://example.com",
                apiKey: "YOUR_API_KEY_HERE",
                apiFormat: "openai" as const,
                interfaceType: "openai-image" as const,
                models: ["qa-image"],
                modelCosts: [{ model: "qa-image", capability: "image" as const, capabilityConfig: profile, unitPriceMicrocredits: 1, billingMode: "fixed_request" as const }],
            },
        ],
    };
    return { ...base, ...defaultImageParamsForModel(base, base.model), count: "1" };
}

describe("包装模型效果图", () => {
    test("五场景都保持结构与事实约束，补充要求不混进其他场景", () => {
        for (const scene of packagingMockupScenes) {
            const prompt = packagingMockupPrompt(project, scene.id, "  柔和蓝色背景  ");
            expect(prompt).toContain("120 × 60 × 80 mm");
            expect(prompt).toContain("不重新设计刀版");
            expect(prompt).toContain("Logo 和已有文字");
            expect(prompt).toContain(scene.prompt);
            expect(prompt).toContain("补充场景要求：柔和蓝色背景");
        }
        expect(() => packagingMockupPrompt(project, "invalid", "")).toThrow("有效");
        expect(() => packagingMockupPrompt(project, "studio", "x".repeat(1201))).toThrow("1200");
    });
    test("使用显式模型和一张参考图，不自动切换为无参考模型", () => {
        const config = configFor(1);
        expect(packagingMockupRequirements(config).input).toEqual(packagingMockupInput);
        expect(packagingMockupConfig(config)).toMatchObject({ model: config.model, count: "1", taskWorkflowProvider: "model" });
        expect(() => packagingMockupConfig({ ...config, model: "" })).toThrow("请选择");
        expect(() => packagingMockupConfig(configFor(0))).toThrow();
        expect(project.revision).toBe(1);
        expect(project.document.artworks).toEqual([]);
    });
    test("真实提交链使用服务端保存快照，上传一次并关联通用图片任务", async () => {
        Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: () => "qa", setItem: () => undefined }, dispatchEvent: () => true, setTimeout, clearTimeout } });
        const calls: string[] = [];
        const submissions: CreateTaskInput[] = [];
        apiClient.defaults.adapter = async (config) => {
            calls.push(`${config.method} ${config.url}`);
            if (config.url === "/tasks") submissions.push(JSON.parse(config.data) as CreateTaskInput);
            const data =
                config.url === "/tasks"
                    ? { id: "mockup-task", type: "canvas_image", status: "queued", prompt: "效果图", createdAt: "", updatedAt: "" }
                    : config.url === "/resources"
                      ? { resource: { id: "uploaded-preview", kind: "image", status: "ready", mimeType: "image/png" } }
                      : project;
            return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data } };
        };
        const draft = { ...project, document: { ...project.document, parameters: { ...project.document.parameters, length: 300 } } };
        await submitPackagingMockup(draft, new Blob(["png"], { type: "image/png" }), configFor(1), "studio", "蓝色背景", new AbortController().signal);
        expect(calls).toEqual(["get /packaging/projects/packaging-qa", "post /resources", "post /tasks"]);
        expect(submissions[0].prompt).toContain("120 × 60 × 80 mm");
        expect(submissions[0].prompt).not.toContain("300 ×");
        expect(submissions[0].projectId).toBeUndefined();
        expect(submissions[0].input).toMatchObject({ mode: "image", config: { count: "1" }, referenceImages: [{ storageKey: "resource:uploaded-preview" }], metadata: { source: "packaging-mockup", packagingProjectId: project.id, packagingRevision: 1 } });
    });
    test("过期版本与取消在上传或计费前停止；继续修改复用资源而不重复上传", async () => {
        Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: () => "qa", setItem: () => undefined }, dispatchEvent: () => true, setTimeout, clearTimeout } });
        const calls: string[] = [];
        apiClient.defaults.adapter = async (config) => {
            calls.push(`${config.method} ${config.url}`);
            return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: project } };
        };
        await expect(submitPackagingMockup({ ...project, revision: 2 }, new Blob(), configFor(1), "studio", "", new AbortController().signal)).rejects.toThrow("版本");
        expect(calls).toEqual(["get /packaging/projects/packaging-qa"]);
        calls.length = 0;
        await expect(submitPackagingMockup(project, new Blob(), configFor(1), "studio", "", AbortSignal.abort())).rejects.toThrow();
        expect(calls).toHaveLength(0);
        await submitPackagingMockup(project, new Blob(), configFor(1), "studio", "调整布光", new AbortController().signal, { resourceId: "previous-image", parentTaskId: "previous-task" });
        expect(calls).toEqual(["get /packaging/projects/packaging-qa", "post /tasks"]);
    });
});
