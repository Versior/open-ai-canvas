import { http } from "@/services/api/request";

export type DomainMCPPermission = "read_only" | "external_write" | "canvas_write" | "prohibited";

export type DomainMCPToolManifest = {
    name: string;
    description: string;
    permission: DomainMCPPermission;
    inputSchema: Record<string, unknown>;
    outputSchemaVersion: number;
};

export type AdminDomainMCPPack = {
    id: string;
    displayName: string;
    description: string;
    version: string;
    providerRequirements: string[];
    dataNotice?: string;
    tools: DomainMCPToolManifest[];
    source: string;
    executable: boolean;
    installed: boolean;
    installationId?: string;
    enabled: boolean;
};

export type AdminDomainMCPInstallation = {
    id: string;
    packId: string;
    name: string;
    enabled: boolean;
    allowedTools: string[];
    provider: string;
    endpoint: string;
    credentialConfigured: boolean;
    createdAt: string;
    updatedAt: string;
};

export type InstallDomainMCPInput = {
    packId: string;
    name?: string;
    enabled?: boolean;
    allowedTools: string[];
    endpoint?: string;
    apiKey?: string;
};

export type UpdateDomainMCPInput = {
    name?: string;
    enabled?: boolean;
    allowedTools?: string[];
    endpoint?: string;
    apiKey?: string;
    clearCredential?: boolean;
};

export function fetchDomainMCPCatalog() {
    return http.get<AdminDomainMCPPack[]>("/admin/domain-mcp/catalog");
}

export function fetchDomainMCPInstallations() {
    return http.get<AdminDomainMCPInstallation[]>("/admin/domain-mcp/installations");
}

export function installDomainMCPPack(input: InstallDomainMCPInput) {
    return http.post<AdminDomainMCPInstallation>("/admin/domain-mcp/installations", input);
}

export function updateDomainMCPInstallation(id: string, input: UpdateDomainMCPInput) {
    return http.patch<AdminDomainMCPInstallation>(`/admin/domain-mcp/installations/${encodeURIComponent(id)}`, input);
}

export function deleteDomainMCPInstallation(id: string) {
    return http.delete<{ deleted: boolean }>(`/admin/domain-mcp/installations/${encodeURIComponent(id)}`);
}

export function testDomainMCPInstallation(id: string) {
    return http.post<{ ok: boolean; tools: string[] }>(`/admin/domain-mcp/installations/${encodeURIComponent(id)}/test`, {});
}
