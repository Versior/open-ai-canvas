import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// 执行真实页面回调，未登录时任何后续依赖都不应被访问。
function guestAction(path: string, name: string, requireLogin: () => boolean) {
    const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
    const match = source.match(new RegExp(`    const ${name} = ((?:async )?\\([^\\n]*?\\) => \\{[\\s\\S]*?\\n    \\});`));
    if (!match) throw new Error(`Missing action: ${path} ${name}`);
    const js = new Bun.Transpiler({ loader: "ts" }).transformSync(`const handler = ${match[1]};`);
    return new Function("requireLogin", `${js}; return handler;`)(requireLogin);
}

test("游客生成、保存、加入技能和连接 Eagle 都先请求登录", async () => {
    for (const [path, name] of [
        ["pages/ecommerce-studio/studio-form.tsx", "generate"],
        ["pages/interior/index.tsx", "submit"],
        ["pages/interior/interior-scene-studio.tsx", "generate"],
        ["pages/video-replication/replication-home.tsx", "send"],
        ["pages/video-replication/index.tsx", "startRun"],
        ["pages/plugins/index.tsx", "togglePlugin"],
        ["pages/plugins/eagle.tsx", "load"],
        ["pages/skills/index.tsx", "toggleAdded"],
        ["pages/skills/index.tsx", "toggleLiked"],
        ["pages/packaging/index.tsx", "execute"],
    ]) {
        let calls = 0;
        await guestAction(path, name, () => {
            calls++;
            return false;
        })({}, {});
        expect(calls, `${path} ${name}`).toBe(1);
    }
});
