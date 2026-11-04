import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Spin, Tabs } from "antd";
import { useLocation } from "react-router";

import { BrandLogo } from "@/components/brand/brand-logo";
import { SiteComplianceFooter } from "@/components/layout/site-compliance-footer";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { isGuestWorkspacePath } from "@/lib/guest-workspace";
import { AUTH_TABS, authCopy } from "@/pages/auth/auth-scene";
import { brandStudioLabel, useAppearanceStore } from "@/stores/use-appearance-store";
import { useAuthModalStore, type AuthModalTab } from "@/stores/use-auth-modal-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import "./auth-modal.css";

const LoginForm = lazy(() => import("@/pages/auth/login"));
const RegisterForm = lazy(() => import("@/pages/auth/register"));

/** 每个浏览器会话只自动弹出一次；关闭后需要账号的操作仍会再次唤起。 */
const AUTO_OPEN_STORAGE_KEY = "yingce:auth-modal-shown";

function claimAutoOpen() {
    try {
        if (window.sessionStorage.getItem(AUTO_OPEN_STORAGE_KEY)) return false;
        window.sessionStorage.setItem(AUTO_OPEN_STORAGE_KEY, "1");
        return true;
    } catch (error) {
        // 会话存储不可用时无法保证「只弹一次」，宁可不自动弹，避免每次刷新都打断游客。
        console.warn("会话存储不可用，跳过登录弹窗自动弹出", error);
        return false;
    }
}

/** 游客的登录弹窗：挂在工作区布局里，登录后自动卸载。 */
export function GuestAuthModalHost() {
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);
    const { open, tab, openAuthModal, closeAuthModal, setTab } = useAuthModalStore();
    const location = useLocation();
    const pathRef = useRef(location.pathname);

    useEffect(() => {
        if (!hydrated || user || !isGuestWorkspacePath(location.pathname)) return;
        if (claimAutoOpen()) openAuthModal("login");
    }, [hydrated, user, location.pathname, openAuthModal]);

    // 登录成功、或从弹窗里点了「忘记密码」等跳到别的页面时收起弹窗。
    useEffect(() => {
        if (user) closeAuthModal();
    }, [user, closeAuthModal]);
    useEffect(() => {
        if (pathRef.current === location.pathname) return;
        pathRef.current = location.pathname;
        closeAuthModal();
    }, [location.pathname, closeAuthModal]);

    if (user) return null;
    return <AuthModal open={open} tab={tab} next={location.pathname + location.search} onTabChange={setTab} onClose={closeAuthModal} />;
}

export function AuthModal({ open, tab, next, onTabChange, onClose }: { open: boolean; tab: AuthModalTab; next: string; onTabChange: (tab: AuthModalTab) => void; onClose: () => void }) {
    const appearance = useAppearanceStore((state) => state.appearance);
    const theme = useThemeStore((state) => state.theme);
    const [failedPosterURL, setFailedPosterURL] = useState("");
    const copy = authCopy[tab];
    const poster = appearance.authVideoPosterUrl && failedPosterURL !== appearance.authVideoPosterUrl ? appearance.authVideoPosterUrl : "";
    return (
        <AppModal open={open} onCancel={onClose} footer={null} centered flush width="min(1040px, calc(100vw - 32px))" rootClassName="auth-modal" aria-label={copy.title}>
            <div className="auth-modal-shell auth-scene">
                <section className="auth-modal-hero auth-scene-hero" aria-label={`${appearance.brandName}品牌海报`}>
                    {poster ? <img className="auth-modal-poster" src={poster} alt="" decoding="async" onError={() => setFailedPosterURL(poster)} /> : null}
                    <div aria-hidden className="auth-scene-hero-overlay auth-modal-overlay" />
                    <div className="auth-modal-brand">
                        <BrandLogo theme={theme} className="size-7" alt="" fallback={<span className="auth-modal-brand-fallback" />} />
                        {appearance.brandName}
                    </div>
                    <div className="auth-modal-hero-copy">
                        <p className="auth-scene-hero-muted auth-modal-studio">{brandStudioLabel(appearance)}</p>
                        <h2 className="auth-scene-hero-title auth-modal-hero-title">{appearance.authHeroTitle}</h2>
                    </div>
                </section>
                <section className="auth-modal-pane auth-scene-card" aria-label={copy.title}>
                    <header className="auth-modal-header">
                        <p className="auth-scene-eyebrow auth-modal-eyebrow">{copy.eyebrow}</p>
                        <h2 className="auth-modal-title">{copy.title}</h2>
                        <p className="auth-scene-muted auth-modal-description">{copy.description}</p>
                    </header>
                    <Tabs className="auth-card-tabs" activeKey={tab} items={AUTH_TABS} onChange={(key) => onTabChange(key === "register" ? "register" : "login")} />
                    <div className="auth-modal-form">
                        <Suspense
                            fallback={
                                <div className="auth-modal-loading" role="status">
                                    <Spin />
                                </div>
                            }
                        >
                            {tab === "login" ? <LoginForm next={next} onSuccess={onClose} /> : <RegisterForm next={next} onSuccess={onClose} />}
                        </Suspense>
                    </div>
                    <SiteComplianceFooter className="auth-modal-footer" />
                </section>
            </div>
        </AppModal>
    );
}
