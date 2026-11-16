import * as THREE from "three";

export const packet = { width: 2.48, height: 3.3, frontZ: 0.3, backZ: -0.3, cardGap: 0.055 };

export function packetFrontGeometry() {
    const geometry = new THREE.PlaneGeometry(packet.width, packet.height, 16, 20);
    const vertices = geometry.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
        const x = vertices.getX(i),
            y = vertices.getY(i);
        vertices.setZ(i, packet.frontZ + 0.075 * Math.sin((x / packet.width + 0.5) * Math.PI) * Math.sin((y / packet.height + 0.5) * Math.PI));
    }
    geometry.computeVertexNormals();
    return geometry;
}

export function cardGeometry() {
    const width = 2.02,
        height = 3.04,
        r = 0.085;
    const x = -width / 2,
        y = -height / 2;
    const shape = new THREE.Shape();
    shape.moveTo(x + r, y);
    shape.lineTo(x + width - r, y);
    shape.quadraticCurveTo(x + width, y, x + width, y + r);
    shape.lineTo(x + width, y + height - r);
    shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    shape.lineTo(x + r, y + height);
    shape.quadraticCurveTo(x, y + height, x, y + height - r);
    shape.lineTo(x, y + r);
    shape.quadraticCurveTo(x, y, x + r, y);
    const edge = new THREE.ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.005, bevelThickness: 0.006, steps: 1 });
    edge.translate(0, 0, -0.026);
    const face = new THREE.ShapeGeometry(shape);
    const uv = face.attributes.uv,
        positions = face.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, positions.getX(i) / width + 0.5, positions.getY(i) / height + 0.5);
    return { edge, face };
}
