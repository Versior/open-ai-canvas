import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, ConfigProvider, Tabs } from "antd";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { BrandWordmark } from "@/components/brand/brand-logo";
import { BrandFilm } from "@/components/brand/brand-film";
import { IconButton } from "@/components/ui/base/buttons";
import { getAntThemeConfig } from "@/lib/app-theme";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { chapters, shuffleWelcomeLooks, showcases } from "./story";
// 独立欢迎入口也需要按钮 token。
import "@/styles/button-tokens.css";
import "./welcome.css";

const StoryReel = lazy(() => import("./story-reel"));

export default function WelcomePage() {
    const appearance = useAppearanceStore((state) => state.appearance);
    return (
        <ConfigProvider theme={getAntThemeConfig(true, appearance.activeSkin)} button={{ autoInsertSpace: false }}>
            <WelcomeExperience brandName={appearance.brandName} />
        </ConfigProvider>
    );
}

function WelcomeExperience({ brandName }: { brandName: string }) {
    const { t } = useTranslation();
    const [remainingLooks, setRemainingLooks] = useState(() => shuffleWelcomeLooks());
    const look = remainingLooks[0];
    const pageRef = useRef<HTMLDivElement>(null);
    const storyRef = useRef<HTMLElement>(null);
    const progressRef = useRef(0);
    const [chapter, setChapter] = useState(0);
    const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const [failedLook, setFailedLook] = useState("");
    const [readyLook, setReadyLook] = useState("");
    const [reelStarted, setReelStarted] = useState(false);
    const [menu, setMenu] = useState(false);
    const [showcase, setShowcase] = useState(0);
    const [hidden, setHidden] = useState(() => document.hidden);
    const [storyVisible, setStoryVisible] = useState(true);

    useEffect(() => {
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const onMotion = () => setReduced(media.matches);
        const onVisibility = () => setHidden(document.hidden);
        media.addEventListener("change", onMotion);
        document.addEventListener("visibilitychange", onVisibility);
        const page = pageRef.current;
        const onScroll = () => {
            if (!storyRef.current) return;
            const rect = storyRef.current.getBoundingClientRect();
            setStoryVisible(rect.top > -rect.height + window.innerHeight);
            const progress = Math.max(0, Math.min(1, -rect.top / (rect.height - window.innerHeight)));
            progressRef.current = progress;
            if (progress > 1 / 12) setReelStarted(true);
            setChapter(Math.min(5, Math.floor(progress * 6)));
        };
        page?.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        onScroll();
        return () => {
            media.removeEventListener("change", onMotion);
            document.removeEventListener("visibilitychange", onVisibility);
            page?.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
        };
    }, []);

    const staticScene = reduced || failedLook === look.id;
    const paused = hidden || !storyVisible || chapter === 0;
    useEffect(() => {
        if (staticScene || paused) return;
        const timer = window.setInterval(() => setRemainingLooks((current) => (current.length > 1 ? current.slice(1) : shuffleWelcomeLooks(current[0].id))), 12_000);
        return () => window.clearInterval(timer);
    }, [staticScene, paused]);
    const active = showcases[showcase];

    return (
        <div ref={pageRef} className="welcome-page">
            <a className="welcome-skip" href="#workbench">
                {t("account.welcome.skip")}
            </a>
            <header className="welcome-header">
                <a className="welcome-brand" href="/welcome" aria-label={t("shell.brandHome", { brand: brandName })}>
                    <BrandWordmark theme="dark" builtinClassName="welcome-brand-wordmark" />
                </a>
                <nav className={menu ? "welcome-nav is-open" : "welcome-nav"} aria-label={t("account.welcome.nav")}>
                    <a href="#workbench" onClick={() => setMenu(false)}>
                        {t("account.welcome.navWorkbench")}
                    </a>
                </nav>
                <Button className="welcome-header-login" type="text" href="/login?next=%2Fcreate">
                    {t("auth.login.submit")}
                </Button>
                <IconButton className="welcome-icon mobile-menu" variant="ghost" size="lg" icon={menu ? X : Menu} aria-label={menu ? t("account.welcome.closeMenu") : t("account.welcome.openMenu")} aria-expanded={menu} onClick={() => setMenu(!menu)} />
            </header>
            <main>
                <section ref={storyRef} id="story" className="welcome-story" aria-label={t("account.welcome.storyLabel")}>
                    <div className={`welcome-stage chapter-${chapter}${staticScene ? " is-static" : ""}`}>
                        {staticScene && chapter > 0 ? (
                            <div className="welcome-poster" aria-hidden="true">
                                <img src={look.frames[chapter * 2]} alt="" fetchPriority="high" />
                            </div>
                        ) : null}
                        {!staticScene && reelStarted ? (
                            <div className={`welcome-reel${readyLook === look.id ? " is-ready" : ""}`} aria-hidden="true">
                                <SceneBoundary key={look.id} onError={() => setFailedLook(look.id)}>
                                    <Suspense fallback={null}>
                                        <StoryReel look={look} progress={progressRef} paused={paused} onReady={() => setReadyLook(look.id)} onError={() => setFailedLook(look.id)} />
                                    </Suspense>
                                </SceneBoundary>
                            </div>
                        ) : null}
                        {chapter === 0 ? <BrandFilm className="welcome-home-film" /> : null}
                        <div className="welcome-stage-shade" aria-hidden="true" />
                        {chapters.map((item, index) => (
                            <section key={item.id} className={`welcome-chapter ${index === 0 ? "welcome-opening" : ""} ${index === chapter ? "is-active" : ""}`} aria-hidden={index !== chapter}>
                                {index === 0 ? (
                                    <h1>
                                        <BrandWordmark theme="dark" builtinClassName="welcome-hero-wordmark" />
                                    </h1>
                                ) : (
                                    <h2>
                                        {t(item.title)
                                            .split("，")
                                            .map((part, partIndex, parts) => (
                                                <span key={part}>
                                                    {part}
                                                    {partIndex < parts.length - 1 ? "，" : ""}
                                                </span>
                                            ))}
                                    </h2>
                                )}
                                {"subtitle" in item && (
                                    <>
                                        <p className="welcome-subtitle">{t(item.subtitle)}</p>
                                        <div className="welcome-hero-actions">
                                            <Button className="welcome-action" type="primary" href="/create" icon={<ArrowUpRight size={16} />} iconPlacement="end" tabIndex={chapter === 0 ? 0 : -1}>
                                                {t("account.welcome.start")}
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </section>
                        ))}
                    </div>
                </section>

                <section id="workbench" className="welcome-workbench">
                    <div className="welcome-section-heading">
                        <h2>{t("account.welcome.workbenchTitle")}</h2>
                    </div>
                    <div className="welcome-workbench-bar">
                        <Tabs activeKey={String(showcase)} aria-label={t("account.welcome.workbenchPreview")} items={showcases.map((item, index) => ({ key: String(index), label: t(item.name) }))} onChange={(key) => setShowcase(Number(key))} />
                        <Button type="link" href={active.href} icon={<ArrowUpRight size={16} />} iconPlacement="end">
                            {t("account.welcome.enterShowcase", { name: t(active.name) })}
                        </Button>
                    </div>
                    <div id="workbench-preview" role="tabpanel" className="welcome-workbench-preview">
                        <img src={active.image} alt={t("account.welcome.showcaseAlt", { brand: brandName, name: t(active.name) })} loading="lazy" />
                    </div>
                    <div className="welcome-workbench-caption">
                        <p>{t(active.detail)}</p>
                    </div>
                </section>

                <section className="welcome-ending">
                    <h2>
                        {t("account.welcome.endingLine1")}
                        <br />
                        {t("account.welcome.endingLine2")}
                    </h2>
                    <Button className="welcome-action welcome-primary" type="primary" href="/create" icon={<ArrowUpRight size={16} />} iconPlacement="end">
                        {t("account.welcome.start")}
                    </Button>
                </section>
            </main>
            <footer className="welcome-footer">
                <a href="/welcome">
                    <BrandWordmark theme="dark" builtinClassName="welcome-brand-wordmark" />
                </a>
                <span>{t("account.welcome.footer")}</span>
            </footer>
        </div>
    );
}

class SceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch() {
        this.props.onError();
    }
    render() {
        return this.state.failed ? null : this.props.children;
    }
}
