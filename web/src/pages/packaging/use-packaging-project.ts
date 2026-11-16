import { useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { assertCurrentUserSession, captureUserSession } from "@/lib/user-scope";
import { packagingApi } from "@/services/api/packaging";
import { resourceFileUrl, uploadResourceFile } from "@/services/api/resources";
import { newPackagingDocument, validatePackagingParameters, type PackagingCatalog, type PackagingDocument, type PackagingProject, type PackagingProjectSummary, type PackagingTemplate } from "@/lib/packaging/types";
import { readPackagingProjectZip } from "@/lib/packaging/delivery";
import { compilePackaging } from "@/lib/packaging/geometry";
import { useUserStore } from "@/stores/use-user-store";
import { useRequireLogin } from "@/hooks/use-require-login";
import { PackagingHistory, type PackagingSnapshot } from "@/lib/packaging/history";
import { packagingResourceIds, reflowPackagingLayers } from "@/lib/packaging/layers";
import { packagingSampleDocument } from "@/lib/packaging/sample";

export function usePackagingProject() {
    const requireLogin = useRequireLogin();
    const userId = useUserStore((s) => s.user?.id);
    const [catalog, setCatalog] = useState<PackagingCatalog>();
    const [project, setProject] = useState<PackagingProject>();
    const [projects, setProjects] = useState<PackagingProjectSummary[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [error, setError] = useState("");
    const [status, setStatus] = useState<"loading" | "ready" | "saving" | "uploading">("loading");
    const [dirty, setDirty] = useState(false);
    const sequence = useRef(0);
    const projectEpoch = useRef(0);
    const pageRequest = useRef(0);
    const currentProject = useRef(project);
    currentProject.current = project;
    const resources = useRef(new Map<string, Blob>());
    const images = useRef(new Map<string, HTMLImageElement>());
    const [imageRevision, setImageRevision] = useState(0);
    const history = useRef(new PackagingHistory());
    const savedSnapshot = useRef<PackagingSnapshot>(undefined);
    const matchesSaved = (value: PackagingSnapshot) => savedSnapshot.current?.name === value.name && (savedSnapshot.current.document === value.document || JSON.stringify(savedSnapshot.current.document) === JSON.stringify(value.document));
    const replaceProject = (value?: PackagingProject, changed = false) => {
        history.current.clear();
        savedSnapshot.current = value && !changed ? { name: value.name, document: value.document } : undefined;
        currentProject.current = value;
        setProject(value);
        setDirty(changed);
    };
    useEffect(() => {
        const controller = new AbortController();
        setStatus("loading");
        projectEpoch.current++;
        setCatalog(undefined);
        replaceProject();
        setProjects([]);
        resources.current.clear();
        images.current.clear();
        const session = captureUserSession();
        Promise.all([packagingApi.catalog(controller.signal), userId ? packagingApi.projects(1, false, {}, controller.signal) : undefined])
            .then(([c, list]) => {
                assertCurrentUserSession(session);
                setCatalog(c);
                setProjects(list?.items || []);
                setTotal(list?.total || 0);
                setPage(1);
                if (c.templates[0] && c.materials[0])
                    replaceProject({ id: "", userId: session.scope, name: "包装设计示例", templateId: c.templates[0].id, revision: 0, createdAt: "", updatedAt: "", document: packagingSampleDocument(c.templates[0], c.materials[0]) });
                setStatus("ready");
                setDirty(false);
                setError("");
            })
            .catch((e: unknown) => {
                if (!controller.signal.aborted) {
                    setStatus("ready");
                    setError(e instanceof Error ? e.message : "目录读取失败");
                }
            });
        return () => controller.abort();
    }, [userId]);
    useEffect(() => {
        const controller = new AbortController();
        const session = captureUserSession();
        const ids = project ? packagingResourceIds(project.document) : [];
        Promise.all(
            ids.map(async (id) => {
                if (images.current.has(id)) return;
                const response = await fetch(resourceFileUrl(id), { credentials: "include", signal: controller.signal });
                if (!response.ok) throw new Error(`图稿读取失败（${response.status}）`);
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                try {
                    const image = new Image();
                    image.src = url;
                    await image.decode();
                    assertCurrentUserSession(session);
                    resources.current.set(id, blob);
                    images.current.set(id, image);
                } finally {
                    URL.revokeObjectURL(url);
                }
            }),
        )
            .then(() => {
                if (!controller.signal.aborted) setImageRevision((v) => v + 1);
            })
            .catch((e: unknown) => {
                if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "图稿读取失败");
            });
        return () => controller.abort();
    }, [
        project?.id,
        project?.document.artworks
            .filter((a) => !a.content)
            .map((a) => a.resourceId)
            .join("|"),
    ]);
    const edit = (update: (p: PackagingProject) => PackagingProject, group?: string) => {
        const previous = currentProject.current;
        if (!previous) return;
        const next = update(previous);
        if (previous.name === next.name && previous.document === next.document) return;
        history.current.record(previous, group);
        sequence.current++;
        currentProject.current = next;
        setProject(next);
        setDirty(!matchesSaved(next));
    };
    const updateDocument = (update: (d: PackagingDocument) => PackagingDocument, group?: string) => {
        try {
            edit((p) => {
                const document = update(p.document);
                if (document.parameters !== p.document.parameters && document.template === p.document.template) {
                    validatePackagingParameters(document.parameters);
                    return { ...p, document: { ...document, artworks: reflowPackagingLayers(document, compilePackaging(p.document), compilePackaging(document)) } };
                }
                return { ...p, document };
            }, group);
        } catch (error) {
            setError(error instanceof Error ? error.message : "包装编辑失败");
        }
    };
    const restore = (direction: "undo" | "redo" | "cancelGesture") => {
        if (!currentProject.current || status !== "ready") return;
        const snapshot = history.current[direction](currentProject.current);
        if (!snapshot) return;
        sequence.current++;
        const next = { ...currentProject.current, ...snapshot };
        currentProject.current = next;
        setProject(next);
        setDirty(!matchesSaved(next));
    };
    const newProject = (template?: PackagingTemplate) => {
        const session = captureUserSession();
        sequence.current++;
        projectEpoch.current++;
        if (!template || !catalog!.materials[0]) {
            replaceProject();
            return;
        }
        replaceProject({ id: "", userId: session.scope, name: template.name, templateId: template.id, revision: 0, createdAt: "", updatedAt: "", document: newPackagingDocument(template, catalog!.materials[0]) });
        setError("");
    };
    const loadPage = async (next: number) => {
        if (!requireLogin()) return;
        const request = ++pageRequest.current;
        const session = captureUserSession();
        const list = await packagingApi.projects(next, false, {}, session.signal);
        assertCurrentUserSession(session);
        if (request !== pageRequest.current) return;
        setProjects(list.items);
        setTotal(list.total);
        setPage(next);
    };
    const load = async (id: string) => {
        if (!requireLogin()) return;
        const epoch = ++projectEpoch.current;
        const submitted = sequence.current;
        const session = captureUserSession();
        const value = await packagingApi.project(id, session.signal);
        assertCurrentUserSession(session);
        if (epoch !== projectEpoch.current) return;
        if (submitted !== sequence.current) throw new Error("读取期间有新的编辑，已保留当前修改；请重新打开项目");
        replaceProject(value);
        setError("");
        sequence.current++;
    };
    const save = async (copy = false) => {
        if (!requireLogin()) return;
        if (!project || status !== "ready") return;
        const session = captureUserSession();
        validatePackagingParameters(project.document.parameters);
        setStatus("saving");
        setError("");
        const submitted = sequence.current;
        const epoch = projectEpoch.current;
        try {
            const value = await packagingApi.save(copy ? "" : project.id, copy ? `${project.name} 副本` : project.name, project.document, copy ? 0 : project.revision, session.signal);
            assertCurrentUserSession(session);
            if (epoch !== projectEpoch.current) return;
            savedSnapshot.current = { name: value.name, document: value.document };
            history.current.endGroup();
            const next = submitted === sequence.current ? value : { ...currentProject.current!, id: value.id, revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt };
            currentProject.current = next;
            setProject(next);
            setDirty(!matchesSaved(next));
            await loadPage(1);
        } catch (e) {
            if (!session.signal.aborted && epoch === projectEpoch.current) setError(e instanceof Error ? e.message : "保存失败");
        } finally {
            if (!session.signal.aborted) setStatus("ready");
        }
    };
    const upload = async (file: File, panelId = "", role: PackagingDocument["artworks"][number]["role"] = "artwork") => {
        if (!requireLogin()) return;
        if (!project) return;
        if (project.document.artworks.length >= 40) throw new Error("图稿与工艺最多 40 层");
        const session = captureUserSession();
        const base = project;
        const epoch = projectEpoch.current;
        if (file.size > 25 * 1024 * 1024) throw new Error("图稿不能超过 25 MB");
        const blobUrl = URL.createObjectURL(file);
        setStatus("uploading");
        try {
            const image = new Image();
            image.src = blobUrl;
            await image.decode();
            if (file.size > 25 * 1024 * 1024 || image.width * image.height > 40_000_000) throw new Error("图稿最多 25 MB / 4000 万像素");
            const uploadFile =
                file.type !== "image/svg+xml"
                    ? file
                    : await new Promise<File>((resolve, reject) => {
                          const canvas = document.createElement("canvas");
                          canvas.width = image.width;
                          canvas.height = image.height;
                          canvas.getContext("2d")!.drawImage(image, 0, 0);
                          canvas.toBlob((blob) => (blob ? resolve(new File([blob], file.name.replace(/\.svg$/i, "") + ".png", { type: "image/png" })) : reject(new Error("SVG 转换失败"))), "image/png");
                      });
            const resource = await uploadResourceFile(uploadFile, "image", { fileName: uploadFile.name, expectedUserId: session.scope, signal: session.signal });
            assertCurrentUserSession(session);
            if (epoch !== projectEpoch.current || currentProject.current?.document.parameters !== base.document.parameters || currentProject.current.document.template !== base.document.template)
                throw new Error("项目或尺寸已切换，请重新添加图稿；已上传文件保留在素材库");
            if (currentProject.current.document.artworks.length >= 40) throw new Error("图稿与工艺最多 40 层；已上传文件保留在素材库");
            const layout = compilePackaging(base.document);
            const panel = layout.panels.find((p) => p.id === panelId);
            const x = panel ? Math.min(...panel.points.map((p) => p[0])) : layout.bounds.x;
            const y = panel ? Math.min(...panel.points.map((p) => p[1])) : layout.bounds.y;
            const width = panel ? Math.max(...panel.points.map((p) => p[0])) - x : layout.bounds.width;
            resources.current.set(resource.id, uploadFile);
            images.current.set(resource.id, image);
            setImageRevision((v) => v + 1);
            updateDocument((d) => ({ ...d, artworks: [...d.artworks, { id: nanoid(), resourceId: resource.id, name: file.name, panelId, role, x, y, width, height: (width * image.height) / image.width, rotation: 0, opacity: 1 }] }));
        } finally {
            URL.revokeObjectURL(blobUrl);
            if (!session.signal.aborted) setStatus("ready");
        }
    };
    const importProject = async (file: File) => {
        if (!requireLogin()) return;
        if (file.size > 100 * 1024 * 1024) throw new Error("方案包不能超过 100 MB");
        const epoch = ++projectEpoch.current;
        const submitted = sequence.current;
        const session = captureUserSession();
        const imported = readPackagingProjectZip(new Uint8Array(await file.arrayBuffer()));
        assertCurrentUserSession(session);
        const template = catalog!.templates.find((t) => t.id === imported.document.template.id && t.structure === imported.document.template.structure);
        const material = catalog!.materials.find((m) => m.id === imported.document.material.id);
        if (!template || !material) throw new Error("方案盒型或材料不在当前启用目录中");
        setStatus("uploading");
        try {
            const ids = new Map<string, string>();
            for (const [id, blob] of imported.resources) {
                const url = URL.createObjectURL(blob);
                try {
                    const image = new Image();
                    image.src = url;
                    await image.decode();
                    if (image.width * image.height > 40_000_000) throw new Error("图稿不能超过 4000 万像素");
                } finally {
                    URL.revokeObjectURL(url);
                }
                const resource = await uploadResourceFile(blob, "image", {
                    fileName: `${id}.${blob.type === "image/jpeg" ? "jpg" : blob.type === "image/svg+xml" ? "svg" : blob.type === "image/webp" ? "webp" : "png"}`,
                    expectedUserId: session.scope,
                    signal: session.signal,
                });
                assertCurrentUserSession(session);
                ids.set(id, resource.id);
            }
            if (epoch !== projectEpoch.current) return;
            if (submitted !== sequence.current) throw new Error("导入期间有新的编辑，已保留当前修改；请重新导入。已上传图稿保留在素材库");
            replaceProject(
                {
                    id: "",
                    userId: session.scope,
                    name: imported.name,
                    templateId: template.id,
                    revision: 0,
                    createdAt: "",
                    updatedAt: "",
                    document: { ...imported.document, artworks: imported.document.artworks.map((a) => (a.content ? a : { ...a, resourceId: ids.get(a.resourceId)! })) },
                },
                true,
            );
            sequence.current++;
        } finally {
            if (!session.signal.aborted) setStatus("ready");
        }
    };
    return {
        catalog,
        project,
        projects,
        total,
        page,
        error,
        setError,
        status,
        dirty,
        canUndo: history.current.canUndo,
        canRedo: history.current.canRedo,
        undo: () => restore("undo"),
        redo: () => restore("redo"),
        endHistoryGroup: () => history.current.endGroup(),
        beginArtworkInteraction: () => history.current.beginGesture(),
        cancelArtworkInteraction: () => restore("cancelGesture"),
        images: images.current,
        resources: resources.current,
        imageRevision,
        edit,
        updateDocument,
        newProject,
        loadPage,
        load,
        save,
        upload,
        importProject,
        remove: async () => {
            if (!project?.id) return;
            const session = captureUserSession();
            const epoch = projectEpoch.current;
            await packagingApi.remove(project.id, project.revision, session.signal);
            assertCurrentUserSession(session);
            if (epoch !== projectEpoch.current) return;
            newProject(catalog!.templates[0]);
            await loadPage(1);
        },
    };
}
