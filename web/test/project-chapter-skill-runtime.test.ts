import { expect, test } from "bun:test";

test("技能选择器占满表单宽度", async () => {
    const source = await Bun.file(new URL("../src/components/skills/skill-runtime-picker.tsx", import.meta.url)).text();
    // 不传 className 时（章节、分镜那些表单里的默认）撑满表单。
    // 嵌在工具条里时会传窄 className——那是例外，不是默认。
    expect(source).toContain('className: "w-full"');
    expect(source).toContain('style: { width: "100%" }');
});

test("画布分镜生成统一经过 Skill Runtime", async () => {
    const source = await Bun.file(new URL("../src/pages/canvas/use-canvas-storyboard.ts", import.meta.url)).text();
    expect(source).toContain('profile: "shortDrama"');
    expect(source).toContain("skillRuntime.prepare");
    expect(source).toContain("...skillExecution.metadata");
    expect(source).not.toContain("getSkillFile");
    expect(source).not.toContain("getSkillBundle");
});
