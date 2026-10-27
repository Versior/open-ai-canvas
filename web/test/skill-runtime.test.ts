import { describe, expect, test } from "bun:test";

import type { Skill, SkillPackageFile, SkillPackageFileContent } from "../src/services/api/skills";
import { setActiveUserScope } from "../src/lib/user-scope";
import { createSkillRuntime, reconcileSkillSelection, resolveSkillMentions } from "../src/services/skill-runtime";

function skill(overrides: Partial<Skill> = {}): Skill {
    return {
        skillId: "director",
        skillName: "AI导演",
        description: "导演工作流",
        versionId: "version-2",
        version: "2.0.0",
        contentHash: "hash",
        fileCount: 5,
        totalBytes: 1024,
        sourceType: "zip",
        sourceUrl: "",
        sourceRef: "",
        sourceSubdir: "",
        sourceCommit: "",
        syncStatus: "synced",
        autoUpdate: false,
        lastCheckedAt: "2026-01-01T00:00:00.000Z",
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        status: 1,
        markdownUrl: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        source: 0,
        tag: "影视",
        sortWeight: 0,
        isPrivate: true,
        likeCount: 0,
        isLike: false,
        ownerUid: "user",
        effectiveUser: { name: "用户", avatarUrl: "", uid: "user" },
        originalSkillId: null,
        showcaseMedia: [],
        addedCount: 1,
        isTest: false,
        extraInfo: "",
        isAdded: true,
        isOwner: true,
        ...overrides,
    };
}

function file(path: string, content: string, kind: SkillPackageFile["kind"] = "markdown"): SkillPackageFileContent {
    return {
        file: { path, kind, mimeType: "text/markdown", size: content.length, sha256: `sha-${path}` },
        content,
        binary: false,
    };
}

describe("skill runtime", () => {
    test("技能引用解析由统一规则同时支持稳定 token 和自然提及", () => {
        const director = skill();
        const storyboard = skill({ skillId: "storyboard", skillName: "小说转分镜" });

        expect(resolveSkillMentions("用 @[skill:director] 处理", [director, storyboard]).map((item) => item.skillId)).toEqual(["director"]);
        expect(resolveSkillMentions("请用 @小说转分镜。", [director, storyboard]).map((item) => item.skillId)).toEqual(["storyboard"]);
        expect(resolveSkillMentions("请用 /小说转分镜 处理。", [director, storyboard]).map((item) => item.skillId)).toEqual(["storyboard"]);
        expect(resolveSkillMentions("@AI导演增强版", [director])).toEqual([]);
        expect(resolveSkillMentions("/AI导演增强版", [director])).toEqual([]);
    });

    test("普通生成只加载入口和与当前任务最相关的直接引用文本", async () => {
        const entry = [
            "# AI导演",
            "视频提示词读取 `references/prompt_templates.md`。",
            "角色资产读取 [角色规则](references/character_assets.md)。",
            "维护脚本见 `scripts/audit_skill.py`。",
            "项目模板见 `assets/project-ledger-template.md`。",
        ].join("\n");
        const files: SkillPackageFile[] = [
            file("SKILL.md", entry).file,
            file("references/prompt_templates.md", "视频提示词模板正文").file,
            file("references/character_assets.md", "角色资产正文").file,
            file("scripts/audit_skill.py", "print('audit')", "code").file,
            file("assets/project-ledger-template.md", "台账模板").file,
        ];
        const readPaths: string[] = [];
        const runtime = createSkillRuntime({
            getFile: async (_id, path) => {
                readPaths.push(path);
                if (path === "SKILL.md") return { file: file(path, entry) };
                return { file: file(path, path.includes("prompt_templates") ? "视频提示词模板正文" : "角色资产正文") };
            },
            listFiles: async () => ({ files }),
        });

        const result = await runtime.prepare({ profile: "canvas", prompt: "@[skill:director] 帮我生成视频提示词", skills: [skill()] });

        expect(result.prompt).toContain('<skill-file path="SKILL.md">');
        expect(result.prompt).toContain('<skill-file path="references/prompt_templates.md">');
        expect(readPaths).not.toContain("references/character_assets.md");
        expect(readPaths).not.toContain("scripts/audit_skill.py");
        expect(readPaths).not.toContain("assets/project-ledger-template.md");
        expect(result.prompt).toContain("【用户任务】\n@AI导演 帮我生成视频提示词");
        expect(result.metadata.skillIds).toEqual(["director"]);
    });

    test("云端 Agent 只准备已加入技能的上下文并保留来源", async () => {
        const runtime = createSkillRuntime({
            getFile: async () => ({ file: file("SKILL.md", "# AI导演") }),
            listFiles: async () => ({ files: [] }),
        });

        const result = await runtime.prepare({ profile: "canvas", prompt: "@[skill:director] 开始", skills: [skill()] });
        expect(result.selectedSkills.map((item) => item.skillId)).toEqual(["director"]);
        expect(result.prompt).toContain('<skill-context skill-id="director"');
        expect(result.metadata.skillIds).toEqual(["director"]);
    });

    for (const [name, skills, selectedSkillIds] of [
        ["empty catalog", [], ["director"]],
        ["partially missing selection", [skill()], ["director", "removed"]],
        ["removed library membership", [skill({ isAdded: false })], ["director"]],
        ["missing ID beyond the selection limit", [skill()], ["director", "director", "director", "director", "removed"]],
    ] as const) {
        test(`rejects ${name} before reading skill files`, async () => {
            let reads = 0;
            const runtime = createSkillRuntime({
                getFile: async () => { reads += 1; return { file: file("SKILL.md", "# Director") }; },
                listFiles: async () => { reads += 1; return { files: [] }; },
            });
            await expect(runtime.prepare({ profile: "canvas", prompt: "Generate", skills: [...skills], selectedSkillIds: [...selectedSkillIds] })).rejects.toThrow();
            expect(reads).toBe(0);
        });
    }

    test("rejects an unavailable stable skill token", async () => {
        const runtime = createSkillRuntime({
            getFile: async () => ({ file: file("SKILL.md", "# Director") }),
            listFiles: async () => ({ files: [] }),
        });
        await expect(runtime.prepare({ profile: "canvas", prompt: "Use @[skill:removed]", skills: [skill()] })).rejects.toThrow();
    });

    test("rejects too many selected skills rather than silently truncating", async () => {
        let reads = 0;
        const runtime = createSkillRuntime({
            getFile: async () => { reads += 1; return { file: file("SKILL.md", "# Director") }; },
            listFiles: async () => { reads += 1; return { files: [] }; },
        });
        const skills = ["one", "two", "three", "four", "five"].map((skillId) => skill({ skillId }));
        await expect(runtime.prepare({ profile: "canvas", prompt: "Generate", skills, selectedSkillIds: skills.map((item) => item.skillId) })).rejects.toThrow();
        expect(reads).toBe(0);
    });

    test("deduplicates explicit selections and records exact loaded provenance", async () => {
        const runtime = createSkillRuntime({
            getFile: async () => ({ file: file("SKILL.md", "# Director") }),
            listFiles: async () => ({ files: [] }),
        });
        const result = await runtime.prepare({ profile: "canvas", prompt: "Generate", skills: [skill()], selectedSkillIds: ["director", "director"] });
        expect(result.selectedSkills.map((item) => item.skillId)).toEqual(["director"]);
        expect(result.provenance).toEqual({
            skillIds: ["director"],
            skillVersions: [{ skillId: "director", versionId: "version-2", version: "2.0.0" }],
            skillFiles: [{ skillId: "director", path: "SKILL.md", sha256: "sha-SKILL.md" }],
        });
        expect(result.metadata).toEqual(result.provenance);
    });

    test("an explicitly empty selection does not infer skills from mentions", async () => {
        const runtime = createSkillRuntime({
            getFile: async () => { throw new Error("No file should be loaded"); },
            listFiles: async () => { throw new Error("No file list should be loaded"); },
        });
        const result = await runtime.prepare({ profile: "canvas", prompt: "@[skill:director]", skills: [skill()], selectedSkillIds: [] });
        expect(result.selectedSkills).toEqual([]);
        expect(result.metadata).toEqual({});
    });

    for (const stage of ["entry", "linked"] as const) {
        test(`account changes during ${stage} file reads prevent prompt injection`, async () => {
            const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
            const values = new Map<string, string>();
            Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
                getItem: (key: string) => values.get(key) ?? null,
                setItem: (key: string, value: string) => values.set(key, value),
            } } });
            try {
                setActiveUserScope("runtime-A");
                const linked = file("references/guide.md", "Private guide");
                const runtime = createSkillRuntime({
                    getFile: async (_id, path) => {
                        if ((stage === "entry" && path === "SKILL.md") || (stage === "linked" && path === linked.file.path)) setActiveUserScope("runtime-B");
                        return { file: path === "SKILL.md" ? file(path, "先读取 references/guide.md。") : linked };
                    },
                    listFiles: async () => ({ files: [linked.file] }),
                });
                await expect(runtime.prepare({ profile: "canvas", prompt: "Generate", skills: [skill()], selectedSkillIds: ["director"] })).rejects.toThrow();
            } finally {
                if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
                else Reflect.deleteProperty(globalThis, "window");
            }
        });
    }
});

describe("reconcileSkillSelection", () => {
    const installed = [skill(), skill({ skillId: "script", skillName: "剧本" })];

    test("剔除技能库里已不存在的技能并保持原顺序", () => {
        expect(reconcileSkillSelection(["script", "deleted", "director", "script"], installed)).toEqual({
            skillIds: ["script", "director"],
            removedSkillIds: ["deleted"],
        });
    });

    test("取消安装的技能同样视为失效", () => {
        const catalog = [skill(), skill({ skillId: "script", isAdded: false })];
        expect(reconcileSkillSelection(["director", "script"], catalog)).toEqual({
            skillIds: ["director"],
            removedSkillIds: ["script"],
        });
    });

    test("目录未成功加载时不清空已选技能", () => {
        expect(reconcileSkillSelection(["director", "script"], [], false)).toEqual({
            skillIds: ["director", "script"],
            removedSkillIds: [],
        });
    });

    test("目录就绪且为空说明技能全被删除", () => {
        expect(reconcileSkillSelection(["director"], [])).toEqual({ skillIds: [], removedSkillIds: ["director"] });
    });
});
