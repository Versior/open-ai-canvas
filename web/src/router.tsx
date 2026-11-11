import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router";
import { lazyAdminPage } from "@/pages/admin/admin-page-loader";

import { RequireAuth } from "@/components/auth/require-auth";
// 功能开关守卫包在页面 Suspense 之外，懒加载会让整个工作区退回全屏加载页；体积很小，直接静态引入。
import { RequireFeature } from "@/components/auth/require-feature";
import { FullScreenLoader, WorkspaceRouteLoader } from "@/components/ui/aceternity/full-screen-loader";
import { workspaceRoutePages } from "@/lib/workspace-route-modules";
import { CanvasRefreshShell } from "@/pages/canvas/canvas-refresh-shell";
import { AuthScene } from "@/pages/auth/auth-scene";
import RouteErrorPage from "@/pages/route-error";
import { isGuestWorkspacePath } from "@/lib/guest-workspace";
import { useUserStore } from "@/stores/use-user-store";

const AdminPage = lazy(() => import("@/pages/admin"));
const EcommerceManagementPage = lazyAdminPage(() => import("@/pages/admin/ecommerce-management-page"));
const EcommerceAgentConfigPage = lazyAdminPage(() => import("@/pages/admin/ecommerce-agent-config-page"));
const AnalyticsPage = lazyAdminPage(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.AnalyticsPage })));
const TrafficPage = lazyAdminPage(() => import("@/pages/admin/traffic/traffic-page"));
const AnnouncementsPage = lazyAdminPage(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.AnnouncementsPage })));
const BannerAnnouncementsPage = lazyAdminPage(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.BannerAnnouncementsPage })));
const StorageResourcesPage = lazyAdminPage(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.StorageResourcesPage })));
const CreditOperationsPage = lazyAdminPage(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.CreditOperationsPage })));
const AccessSettingsPage = lazyAdminPage(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.AccessSettingsPage })));
const EmailSettingsPage = lazyAdminPage(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.EmailSettingsPage })));
const FeatureAvailabilityPage = lazyAdminPage(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.FeatureAvailabilityPage })));
const AgentLessonsPage = lazyAdminPage(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.AgentLessonsPage })));
const ChannelsPage = lazyAdminPage(() => import("@/pages/admin/channels/channels-page"));
const VideoReplicationAdminPage = lazyAdminPage(() => import("@/pages/admin/video-replication/video-replication-admin-page"));
const LogicalModelsPage = lazyAdminPage(() => import("@/pages/admin/logical-models/logical-models-page"));
const AdminPluginsPage = lazyAdminPage(() => import("@/pages/admin/plugins/plugins-page"));
const SkillCurationPage = lazyAdminPage(() => import("@/pages/admin/skill-curation-page"));
const AdminSkillsPage = lazyAdminPage(() => import("@/pages/admin/skills/skills-page"));
const AdminSkillWorkbenchPage = lazyAdminPage(() => import("@/pages/admin/skills/admin-skill-workbench-page"));
const AdminPaymentsPage = lazyAdminPage(() => import("@/pages/admin/payments/payments-page"));
const LogsPage = lazyAdminPage(() => import("@/pages/admin/logs/logs-page"));
const LoginLogsPage = lazyAdminPage(() => import("@/pages/admin/login-logs/login-logs-page"));
const EmailLogsPage = lazyAdminPage(() => import("@/pages/admin/email-logs/email-logs-page"));
const RedemptionCodesPage = lazyAdminPage(() => import("@/pages/admin/redemption-codes/redemption-codes-page"));
const RuntimePolicySettingsPage = lazyAdminPage(() => import("@/pages/admin/settings/runtime-policy-settings-page"));
const AppearanceSettingsPage = lazyAdminPage(() => import("@/pages/admin/settings/appearance-settings-page"));
const AgentPetsSettingsPage = lazyAdminPage(() => import("@/pages/admin/settings/agent-pets-page"));
const DrawingEngineSettingsPage = lazyAdminPage(() => import("@/pages/admin/settings/drawing-engine-settings-page"));
const EcommerceSettingsPage = lazyAdminPage(() => import("@/pages/admin/settings/ecommerce-settings-page"));
const StudioModelsPage = lazyAdminPage(() => import("@/pages/admin/settings/studio-models-page"));
const StorageSettingsPage = lazyAdminPage(() => import("@/pages/admin/settings/storage-settings-page"));
const ArkPrivateAssetsSettingsPage = lazyAdminPage(() => import("@/pages/admin/settings/ark-private-assets-settings-page"));
const ResponseInterceptionSettingsPage = lazyAdminPage(() => import("@/pages/admin/settings/response-interception-settings-page"));
const ThirdPartySettingsPage = lazyAdminPage(() => import("@/pages/admin/settings/libtv-settings-page"));
const WorkbenchToolsPage = lazyAdminPage(() => import("@/pages/admin/workbench-tools/workbench-tools-page"));
const PoseLibraryAdminPage = lazyAdminPage(() => import("@/pages/admin/pose-library/pose-library-page"));
const LUTLibraryAdminPage = lazyAdminPage(() => import("@/pages/admin/lut-library/lut-library-page"));
const SystemUpdatePage = lazyAdminPage(() => import("@/pages/admin/settings/system-update-page"));
const SystemPerformancePage = lazyAdminPage(() => import("@/pages/admin/settings/system-performance-page"));
const StoryboardPromptsPage = lazyAdminPage(() => import("@/pages/admin/storyboard-prompts/storyboard-prompts-page"));
const AdminFeedbacksPage = lazyAdminPage(() => import("@/pages/admin/feedbacks/feedbacks-page"));
const UsersPage = lazyAdminPage(() => import("@/pages/admin/users/users-page"));
const UserGroupsPage = lazyAdminPage(() => import("@/pages/admin/user-groups/user-groups-page"));
const InteriorAdminPage = lazyAdminPage(() => import("@/pages/admin/interior/interior-admin-page"));
const AssetsPage = workspaceRoutePages.assets;
const InspirationGalleryPage = workspaceRoutePages.inspiration;
const WorkDetailPage = lazy(() => import("@/pages/inspiration/work-detail"));
const LoginPage = lazy(() => import("@/pages/auth/login"));
const RegisterPage = lazy(() => import("@/pages/auth/register"));
const ForgotPasswordPage = lazy(() => import("@/pages/auth/forgot-password"));
const CanvasPage = workspaceRoutePages.canvas;
const EcommerceStudioPage = workspaceRoutePages.ecommerceStudio;
const InteriorPage = workspaceRoutePages.interior;
const VideoReplicationPage = workspaceRoutePages.videoReplication;
const CanvasProjectPage = workspaceRoutePages.canvasProject;
const SharedCanvasPage = lazy(() => import("@/pages/canvas/shared"));
const ArkPortraitResultPage = lazy(() => import("@/pages/ark-portrait-result"));
const CreatePage = workspaceRoutePages.create;
const EcommercePage = workspaceRoutePages.ecommerce;
const ImageWorkbenchPage = workspaceRoutePages.imageWorkbench;
const VideoWorkbenchPage = workspaceRoutePages.videoWorkbench;
const NotFound = lazy(() => import("@/pages/not-found"));
const SkillsPage = workspaceRoutePages.skills;
const SkillWorkbenchPage = workspaceRoutePages.skillWorkbench;
const PluginsPage = workspaceRoutePages.plugins;
const EagleLibraryPage = workspaceRoutePages.eagleLibrary;
const TasksPage = workspaceRoutePages.tasks;
const ProjectsPage = workspaceRoutePages.projects;
const ProjectDetailPage = workspaceRoutePages.projectDetail;
const ProjectCreatePage = workspaceRoutePages.projectCreate;
const SettingsPage = workspaceRoutePages.settings;
const ReferralPage = workspaceRoutePages.referral;
const AdminReferralPage = lazyAdminPage(() => import("@/pages/admin/referral/referral-admin-page"));
const UserLayout = lazy(() => import("@/layouts/user-layout"));
const WelcomePage = lazy(() => import("@/pages/welcome"));

function SiteHomeLayout() {
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);
    const welcomeEnabled = useUserStore((state) => state.features.welcomeEnabled);
    if (!hydrated) return <FullScreenLoader />;
    if (!user && welcomeEnabled) return fullScreenDeferred(<WelcomePage />);
    return <AuthenticatedWorkspaceLayout />;
}

function deferred(element: ReactNode) {
    return <Suspense fallback={<WorkspaceRouteLoader />}>{element}</Suspense>;
}

function fullScreenDeferred(element: ReactNode) {
    return <Suspense fallback={<FullScreenLoader label="正在打开创作空间" detail="准备当前页面" />}>{element}</Suspense>;
}

function LegacyInspirationsRedirect() {
    const { search, hash } = useLocation();
    const params = new URLSearchParams(search);
    if (!params.has("view") && !params.has("work")) params.set("view", "prompt");
    return <Navigate to={{ pathname: "/inspiration", search: `?${params}`, hash }} replace />;
}

function AuthenticatedWorkspaceLayout() {
    const { pathname } = useLocation();
    const isCanvasProjectRoute = pathname.startsWith("/canvas/");
    const fallback = isCanvasProjectRoute ? <CanvasRefreshShell /> : <FullScreenLoader label="正在打开创作空间" detail="准备当前页面" />;
    return (
        <RequireAuth allowAnonymous={isGuestWorkspacePath(pathname)}>
            <Suspense fallback={fallback}>
                <UserLayout>
                    <Outlet />
                </UserLayout>
            </Suspense>
        </RequireAuth>
    );
}

/**
 * DEV 专用实验室路由。
 *
 * lazy(() => import(...)) 写在函数体内，而不是模块顶层常量：
 * 生产构建时 import.meta.env.DEV 被替换为 false，本函数随之不可达，
 * 摇树会连同其中的动态 import 一起删除，实验室代码不进入生产依赖图。
 * 若把 lazy 提到模块顶层，动态 import 会被静态分析成真实 chunk 并打进 dist。
 */
function devRoutes() {
    const FolderPreviewLab = lazy(() => import("@/pages/dev/folder-preview-lab"));
    const PrevisReproLab = lazy(() => import("@/pages/dev/previs-repro-lab"));
    const TestVoiceRecording = lazy(() => import("@/pages/test-voice-recording"));
    return [
        { path: "/dev/folders", element: fullScreenDeferred(<FolderPreviewLab />), errorElement: <RouteErrorPage /> },
        { path: "/dev/previs-repro", element: fullScreenDeferred(<PrevisReproLab />), errorElement: <RouteErrorPage /> },
        { path: "/test-voice-recording", element: <RequireAuth>{fullScreenDeferred(<TestVoiceRecording />)}</RequireAuth>, errorElement: <RouteErrorPage /> },
    ];
}

export const router = createBrowserRouter([
    { path: "/", element: <SiteHomeLayout />, errorElement: <RouteErrorPage />, children: [{ index: true, element: deferred(<CreatePage />) }] },
    {
        element: <AuthScene />,
        errorElement: <RouteErrorPage />,
        children: [
            { path: "/login", element: fullScreenDeferred(<LoginPage />) },
            { path: "/register", element: fullScreenDeferred(<RegisterPage />) },
            { path: "/forgot-password", element: fullScreenDeferred(<ForgotPasswordPage />) },
        ],
    },
    { path: "/share/canvas/:token", element: fullScreenDeferred(<SharedCanvasPage />), errorElement: <RouteErrorPage /> },
    // H5 真人认证回跳页：多在未登录的手机上打开，不进入工作区登录守卫。
    { path: "/ark-portrait/result", element: fullScreenDeferred(<ArkPortraitResultPage />), errorElement: <RouteErrorPage /> },
    ...(import.meta.env.DEV ? devRoutes() : []),
    {
        element: <AuthenticatedWorkspaceLayout />,
        errorElement: <RouteErrorPage />,
        children: [
            { path: "/create", element: deferred(<CreatePage />) },
            { path: "/inspirations", element: <LegacyInspirationsRedirect /> },
            { path: "/ecommerce", element: <RequireAuth>{deferred(<EcommercePage />)}</RequireAuth> },
            // 电商生图台：独立于电商 Agent 的商品出图工作台。
            {
                path: "/studio",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="ecommerceStudioEnabled">{deferred(<EcommerceStudioPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            // 商品视频（元素替换）并进了视频复刻，旧地址跳过去。
            { path: "/product-video", element: <Navigate to="/video-replication?mode=replace" replace /> },
            // 室内设计：房间照片、毛坯、线稿出装修效果图。
            {
                path: "/interior",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="interiorEnabled">{deferred(<InteriorPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            // 视频复刻：上传视频或粘贴平台链接，拆出镜头、口播和节奏。
            {
                path: "/video-replication",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="videoReplicationEnabled">{deferred(<VideoReplicationPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/toolbox/image",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="imageWorkbenchEnabled">{deferred(<ImageWorkbenchPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/toolbox/video",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="videoWorkbenchEnabled">{deferred(<VideoWorkbenchPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/tasks",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="taskCenterEnabled">{deferred(<TasksPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            { path: "/assets", element: <RequireAuth>{deferred(<AssetsPage />)}</RequireAuth> },
            { path: "/inspiration", element: <RequireAuth>{deferred(<InspirationGalleryPage />)}</RequireAuth> },
            { path: "/inspiration/:templateUuid", element: <RequireAuth>{deferred(<WorkDetailPage />)}</RequireAuth> },
            { path: "/skills", element: <RequireAuth>{deferred(<SkillsPage />)}</RequireAuth> },
            { path: "/skills/:skillId/edit", element: <RequireAuth>{deferred(<SkillWorkbenchPage />)}</RequireAuth> },
            {
                path: "/plugins",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="pluginCenterEnabled">{deferred(<PluginsPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/plugins/eagle",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="pluginCenterEnabled">{deferred(<EagleLibraryPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/wallet",
                element: <RequireAuth>{null}</RequireAuth>,
            },
            { path: "/settings", element: <RequireAuth>{deferred(<SettingsPage />)}</RequireAuth> },
            { path: "/referral", element: <RequireAuth>{deferred(<ReferralPage />)}</RequireAuth> },
            {
                path: "/projects",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="shortDramaEnabled">{deferred(<ProjectsPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/projects/new",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="shortDramaEnabled">{deferred(<ProjectCreatePage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/projects/:projectId",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="shortDramaEnabled">{deferred(<ProjectDetailPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/projects/:projectId/e/:episodeId",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="shortDramaEnabled">{deferred(<ProjectDetailPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            { path: "/projects/:projectId/*", element: <Navigate to=".." relative="path" replace /> },
            { path: "/canvas", element: <RequireAuth>{deferred(<CanvasPage />)}</RequireAuth> },
            // 旧版电商画布已下线：旧入口收进画布列表，存量电商画布按自由画布打开。
            { path: "/ecommerce/canvas", element: <Navigate to="/canvas" replace /> },
            {
                path: "/canvas/:id",
                element: (
                    <RequireAuth>
                        <CanvasProjectPage />
                    </RequireAuth>
                ),
            },
            {
                path: "/admin",
                element: <RequireAuth>{deferred(<AdminPage />)}</RequireAuth>,
                children: [
                    { index: true, element: <AnalyticsPage /> },
                    { path: "traffic", element: <TrafficPage /> },
                    { path: "users", element: <UsersPage /> },
                    { path: "user-groups", element: <UserGroupsPage /> },
                    { path: "login-logs", element: <LoginLogsPage /> },
                    { path: "email-logs", element: <EmailLogsPage /> },
                    { path: "feedbacks", element: <AdminFeedbacksPage /> },
                    { path: "channels", element: <ChannelsPage /> },
                    // 关闭前台模型只影响用户端模型来源；后台仍可进入，便于开启前先配置。
                    { path: "models", element: <LogicalModelsPage /> },
                    { path: "ecommerce", element: <Navigate to="/admin/ecommerce/agent" replace /> },
                    { path: "ecommerce/agent", element: <EcommerceAgentConfigPage /> },
                    { path: "ecommerce/library", element: <EcommerceManagementPage /> },
                    { path: "ecommerce/library/skills", element: <EcommerceManagementPage /> },
                    { path: "ecommerce/library/categories", element: <EcommerceManagementPage /> },
                    // 旧地址：知识库、Skills、品类并入「知识与技能」，小夜设置并入「电商 Agent 配置」
                    { path: "ecommerce/skills", element: <Navigate to="/admin/ecommerce/library/skills" replace /> },
                    { path: "ecommerce/categories", element: <Navigate to="/admin/ecommerce/library/categories" replace /> },
                    { path: "ecommerce-knowledge", element: <Navigate to="/admin/ecommerce/library" replace /> },
                    { path: "ecommerce-skills", element: <Navigate to="/admin/ecommerce/library/skills" replace /> },
                    { path: "ecommerce-categories", element: <Navigate to="/admin/ecommerce/library/categories" replace /> },
                    // 室内设计后台不受功能开关限制，方便开放前先配好模式、风格和默认模型。
                    { path: "interior", element: <Navigate to="/admin/interior/overview" replace /> },
                    { path: "interior/overview", element: <InteriorAdminPage /> },
                    { path: "interior/records", element: <InteriorAdminPage /> },
                    { path: "interior/modes", element: <InteriorAdminPage /> },
                    { path: "interior/styles", element: <InteriorAdminPage /> },
                    { path: "interior/rooms", element: <InteriorAdminPage /> },
                    { path: "interior/knowledge", element: <InteriorAdminPage /> },
                    { path: "interior/settings", element: <InteriorAdminPage /> },
                    { path: "plugins", element: <AdminPluginsPage /> },
                    { path: "workbench-tools", element: <WorkbenchToolsPage /> },
                    // 视频复刻的统计、记录、解析接口和设置；关闭视频复刻只影响用户端，后台仍可进入。
                    { path: "video-replication", element: <VideoReplicationAdminPage /> },
                    { path: "pose-library", element: <PoseLibraryAdminPage /> },
                    { path: "lut-library", element: <LUTLibraryAdminPage /> },
                    { path: "skills", element: <AdminSkillsPage /> },
                    { path: "skills/:skillId/edit", element: <AdminSkillWorkbenchPage /> },
                    { path: "skill-curation", element: <SkillCurationPage /> },
                    { path: "payments", element: <AdminPaymentsPage /> },
                    { path: "prompt-templates", element: <StoryboardPromptsPage /> },
                    { path: "storyboard-prompts", element: <Navigate to="/admin/prompt-templates" replace /> },
                    { path: "announcements", element: <AnnouncementsPage /> },
                    { path: "banner-announcements", element: <BannerAnnouncementsPage /> },
                    { path: "agent-lessons", element: <AgentLessonsPage /> },
                    { path: "resources", element: <StorageResourcesPage /> },
                    { path: "credit-operations", element: <CreditOperationsPage /> },
                    { path: "redemption-codes", element: <RedemptionCodesPage /> },
                    { path: "referral", element: <AdminReferralPage /> },
                    { path: "logs", element: <LogsPage /> },
                    { path: "settings", element: <Navigate to="runtime-policy" replace /> },
                    { path: "settings/appearance", element: <AppearanceSettingsPage /> },
                    { path: "settings/agent-styles", element: <AgentPetsSettingsPage /> },
                    { path: "settings/drawing-engine", element: <DrawingEngineSettingsPage /> },
                    { path: "settings/ecommerce", element: <EcommerceSettingsPage /> },
                    { path: "settings/studio-models", element: <StudioModelsPage /> },
                    { path: "settings/concurrency", element: <Navigate to="/admin/settings/runtime-policy" replace /> },
                    { path: "settings/runtime-policy", element: <RuntimePolicySettingsPage /> },
                    { path: "settings/features", element: <FeatureAvailabilityPage /> },
                    { path: "settings/access", element: <AccessSettingsPage /> },
                    { path: "settings/email", element: <EmailSettingsPage /> },
                    { path: "settings/storage", element: <StorageSettingsPage /> },
                    { path: "settings/ark-private-assets", element: <ArkPrivateAssetsSettingsPage /> },
                    { path: "settings/response-interception", element: <ResponseInterceptionSettingsPage /> },
                    { path: "settings/third-party", element: <ThirdPartySettingsPage /> },
                    { path: "settings/system-update", element: <SystemUpdatePage /> },
                    { path: "settings/system-performance", element: <SystemPerformancePage /> },
                    { path: "settings/libtv", element: <Navigate to="/admin/settings/third-party" replace /> },
                ],
            },
        ],
    },
    { path: "*", element: fullScreenDeferred(<NotFound />) },
]);
