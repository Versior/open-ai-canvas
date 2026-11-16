import type { LucideIcon } from "lucide-react";
import "./image-pack-notice.css";

export function ImagePackNoticeArtwork({ icon: Icon, tone }: { icon: LucideIcon; tone: "error" | "warning" | "neutral" }) {
    return (
        <span className="image-pack-notice-artwork" data-tone={tone} aria-hidden="true">
            <i className="image-pack-notice-shadow" />
            <i className="image-pack-notice-pouch" />
            <i className="image-pack-notice-seal" />
            <span className="image-pack-notice-mark">
                <Icon />
            </span>
        </span>
    );
}
