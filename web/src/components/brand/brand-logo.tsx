import { useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { appearanceLogoURL, useAppearanceStore } from "@/stores/use-appearance-store";
import type { ThemeName } from "@/stores/use-theme-store";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

type BrandLogoProps = {
    className?: string;
    fallback: ReactNode;
    alt?: string;
    theme?: ThemeName | "auto";
};

type BrandWordmarkProps = {
    className?: string;
    builtinClassName?: string;
};

export function BrandLogo({ className, alt = "", theme = "auto" }: BrandLogoProps) {
    const appearance = useAppearanceStore((state) => state.appearance);
    const currentTheme = useActiveTheme();
    const source = appearanceLogoURL(appearance, theme === "auto" ? currentTheme : theme);
    const [failedSource, setFailedSource] = useState<string | null>(null);
    if (!appearance.logoConfigured) return <BuiltinBrandMark className={className} alt={alt} />;
    // A configured custom logo must never fall through to the built-in brand
    // when its file becomes unavailable. Keep its footprint neutral instead.
    if (failedSource === source) return <span className={cn("block", className)} aria-hidden="true" />;
    return (
        <img
            src={source}
            alt={alt}
            className={cn("block object-contain", className)}
            draggable={false}
            onError={(event) => {
                event.currentTarget.style.visibility = "hidden";
                setFailedSource(source);
            }}
        />
    );
}

function BuiltinBrandMark({ className, alt }: { className?: string; alt: string }) {
    return (
        <span className={className} style={{ position: "relative", display: "inline-block", overflow: "visible" }} role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>
            <span style={{ position: "absolute", inset: 0, backgroundColor: "currentColor", mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />
            <span style={{ position: "absolute", width: "7%", aspectRatio: 1, right: "7.5%", bottom: "9.25%", borderRadius: "var(--brand-cue-radius)", backgroundColor: "var(--brand-cue)" }} />
        </span>
    );
}

export function BrandLogoFrame({ className, logoClassName, fallback, alt = "", theme = "auto" }: BrandLogoProps & { logoClassName?: string }) {
    const frameEnabled = useAppearanceStore((state) => state.appearance.logoFrameEnabled);
    const unframedStyle: CSSProperties | undefined = frameEnabled
        ? undefined
        : {
              background: "transparent",
              borderColor: "transparent",
              borderRadius: 0,
              boxShadow: "none",
              color: "inherit",
          };
    return (
        <span className={cn("brand-logo-frame", className)} data-logo-frame-enabled={frameEnabled} style={unframedStyle}>
            <BrandLogo className={logoClassName} fallback={fallback} alt={alt} theme={theme} />
        </span>
    );
}

export function BrandWordmark({ className, builtinClassName }: BrandWordmarkProps) {
    const appearance = useAppearanceStore((state) => state.appearance);
    if (appearance.logoConfigured || appearance.brandName !== "STAGE") return <span className={className}>{appearance.brandName}</span>;
    return (
        <span className={builtinClassName} style={{ position: "relative", display: "inline-block", flexShrink: 0, overflow: "visible" }} role="img" aria-label="STAGE">
            <span style={{ position: "absolute", inset: 0, backgroundColor: "currentColor", mask: "url(/wordmark.svg) left center / contain no-repeat", WebkitMask: "url(/wordmark.svg) left center / contain no-repeat" }} />
            <span
                style={{
                    position: "absolute",
                    width: "1.8%",
                    minWidth: "var(--brand-cue-min-size)",
                    minHeight: "var(--brand-cue-min-size)",
                    aspectRatio: 1,
                    right: "1.7%",
                    top: "8.5%",
                    borderRadius: "var(--brand-cue-radius)",
                    backgroundColor: "var(--brand-cue)",
                }}
            />
        </span>
    );
}
