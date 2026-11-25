import type { StudioDetailPlan } from "@/lib/ecommerce-studio/types";

export function StudioPlanDirectionCard({ plan }: { plan: StudioDetailPlan }) {
    const { artDirection: direction } = plan;
    const title = plan.concept?.trim();
    const notes = [...new Set([direction?.visualWorld?.trim() || "", direction?.screenVariationPlan?.trim() || ""])].filter((value) => value && value !== title);
    if (!title && !notes.length) return null;

    return (
        <section className="es-plan-direction" aria-label="整套美术方向">
            {title ? <h3>{title}</h3> : null}
            {notes.map((value) => (
                <p key={value}>{value}</p>
            ))}
        </section>
    );
}
