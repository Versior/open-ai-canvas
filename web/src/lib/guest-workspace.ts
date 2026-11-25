const guestWorkspacePaths = new Set([
    "/",
    "/create",
    "/assets",
    "/canvas",
    "/projects",
    "/video-replication",
    "/studio",
    "/ecommerce-studio",
    "/ecommerce",
    "/interior",
    "/packaging",
    "/toolbox/image",
    "/toolbox/video",
    "/skills",
    "/plugins",
    "/plugins/eagle",
    "/inspiration",
    "/inspirations",
    "/product-video",
    "/ecommerce/canvas",
    "/tasks",
]);

export function isGuestWorkspacePath(pathname: string) {
    return guestWorkspacePaths.has(pathname);
}
