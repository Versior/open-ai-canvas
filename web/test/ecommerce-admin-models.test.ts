import { describe, expect, test } from "bun:test";

import { matchCommerceAdminModel } from "../src/pages/ecommerce/admin-models";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot } from "../src/stores/use-config-store";

// The model catalog projects system channel models without logical model IDs; the stage
// model saved in the admin console must still resolve to the user's selectable option.
function stageConfig(logicalModelId?: string) {
    const channel = createModelChannel({
        id: "stage-channel",
        name: "",
        scope: "system",
        baseUrl: "/api/stage-channel",
        apiKey: "system",
        apiFormat: "openai",
        models: ["planner"],
        modelCosts: [{ model: "planner", capability: "text", pricePolicy: "channel", billingMode: "fixed_request", unitPriceMicrocredits: 1_000_000, logicalModelId }],
    });
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], model: "stage-channel::planner" } }).config;
}

describe("电商 Agent 后台阶段模型匹配", () => {
    test("渠道模型按渠道和模型标识匹配可选项", () => {
        const config = stageConfig();
        const options = ["stage-channel::planner"];
        expect(matchCommerceAdminModel(config, options, { channelModelId: "row-1", channelId: "stage-channel", modelKey: "planner" })).toBe("stage-channel::planner");
        expect(matchCommerceAdminModel(config, options, { channelModelId: "row-2", channelId: "other-channel", modelKey: "planner" })).toBe("");
        expect(matchCommerceAdminModel(config, options, null)).toBe("");
    });

    test("逻辑模型按逻辑模型 ID 匹配", () => {
        const config = stageConfig("logical-planner");
        expect(matchCommerceAdminModel(config, ["stage-channel::planner"], { logicalModelId: "logical-planner" })).toBe("stage-channel::planner");
        expect(matchCommerceAdminModel(config, ["stage-channel::planner"], { logicalModelId: "other" })).toBe("");
    });
});
