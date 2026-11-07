import { expect, test } from "bun:test";
import { SOCIAL_PARSE_PRESETS, socialParsePresetInput } from "@/lib/social-video-parse-presets";

test("collected services start disabled with source links and no embedded credential", () => {
    expect(SOCIAL_PARSE_PRESETS).toHaveLength(28);
    expect(new Set(SOCIAL_PARSE_PRESETS.map((item) => item.id)).size).toBe(28);
    for (const item of SOCIAL_PARSE_PRESETS) {
        expect(item.definition.enabled).toBe(false);
        expect(item.definition.secret).toBeUndefined();
        expect(item.source.startsWith("https://")).toBe(true);
        if (!item.instance) expect(item.definition.url).toContain("{url}");
    }
});
test("BugPk contracts cover domestic platforms and use the documented video field", () => {
    const aggregate = SOCIAL_PARSE_PRESETS.find((item) => item.id === "bugpk-short_videos")!;
    for (const platform of ["weishi", "haokan", "zhihu", "xigua", "wechat"]) expect(aggregate.definition.platforms).toContain(platform);
    expect(aggregate.definition.mapping).toMatchObject({ successPath: "code", successValues: "200", videoUrlPath: "data.url" });
    expect(SOCIAL_PARSE_PRESETS.find((item) => item.id === "bugpk-wxsph")?.definition.url).toBe("https://api.bugpk.com/api/wxsph?url={url}");
});
test("self-hosted cobalt requires an explicit HTTPS instance and only accepts single-video responses", () => {
    const preset = SOCIAL_PARSE_PRESETS.find((item) => item.id === "cobalt")!;
    expect(() => socialParsePresetInput(preset)).toThrow();
    expect(() => socialParsePresetInput(preset, "http://localhost:9000")).toThrow();
    expect(() => socialParsePresetInput(preset, "https://user@example.com/")).toThrow();
    const first = socialParsePresetInput(preset, "https://cobalt.example.com/");
    expect(first.mapping.successValues).toBe("tunnel,redirect");
    first.platforms.push("custom");
    expect(socialParsePresetInput(preset, "https://cobalt.example.com/").platforms).not.toContain("custom");
});
