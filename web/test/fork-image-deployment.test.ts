import { describe, expect, test } from "bun:test";

const root = new URL("../../", import.meta.url);

async function source(path: string) {
    return Bun.file(new URL(path, root)).text();
}

describe("fork image deployment", () => {
    test("the image workflow builds the private development branch", async () => {
        const workflow = await source(".github/workflows/publish-images.yml");
        expect(workflow).toContain("      - dev");
    });

    test("the production compose pulls Versior images by default", async () => {
        const compose = await source("docker-compose.deploy.yml");
        expect(compose).toContain("ghcr.io/${CANVAS_IMAGE_OWNER:-versior}/open-ai-canvas-backend:${CANVAS_IMAGE_TAG:-dev}");
        expect(compose).toContain("ghcr.io/${CANVAS_IMAGE_OWNER:-versior}/open-ai-canvas-web:${CANVAS_IMAGE_TAG:-dev}");
        expect(compose).not.toContain("ghcr.io/ddcat-ai/");
    });

    test("every backend compose forwards the managed MCP catalog", async () => {
        for (const path of ["docker-compose.yml", "docker-compose.local.yml", "docker-compose.dev.yml", "docker-compose.deploy.yml", "docker-compose.server.yml"]) {
            expect(await source(path)).toContain("CANVAS_AGENT_MCP_SERVERS_JSON: ${CANVAS_AGENT_MCP_SERVERS_JSON:-[]}");
        }
    });

    test("the standard Domain MCP endpoint is opt-in and no provider credential is embedded", async () => {
        const composePaths = ["docker-compose.yml", "docker-compose.local.yml", "docker-compose.dev.yml", "docker-compose.deploy.yml", "docker-compose.server.yml"];
        for (const path of composePaths) {
            const compose = await source(path);
            expect(compose).toContain("CANVAS_DOMAIN_MCP_TOKEN: ${CANVAS_DOMAIN_MCP_TOKEN:-}");
            expect(compose).not.toContain("as_sk_");
            expect(compose).not.toContain("ANYSEARCH_API_KEY");
        }
        const environment = await source(".env.example");
        expect(environment).toContain("CANVAS_DOMAIN_MCP_TOKEN=");
        expect(environment).toContain("默认关闭");
        expect(environment).not.toContain("as_sk_");
    });
});
