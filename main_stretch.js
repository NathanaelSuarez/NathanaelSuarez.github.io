// main_stretch.js
let scene, camera, renderer, sphereMesh;
let mouseDown = false,
    lastMouseX = 0,
    lastMouseY = 0;
let clock = new THREE.Clock();
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let intersectedPoint = new THREE.Vector3();
let originalVertices = [];
let grabbedVertexIndex = -1;

// New physics parameters
const VERTEX_MASS = 1.0;
const SPRING_CONSTANT = 80;
const DAMPING_CONSTANT = 2;

class VertexState {
    constructor() {
        this.velocity = new THREE.Vector3();
        this.displacement = new THREE.Vector3();
        this.force = new THREE.Vector3();
        this.neighbors = [];
        this.distanceFromSource = Infinity;
        this.lastUpdateTime = 0;
    }
}

let vertexStates = [];

// Set up gradient background
document.body.style.background = "linear-gradient(135deg, #FFB6C1 0%, #87CEEB 50%, #98FB98 100%)";
document.body.style.margin = "0";
document.body.style.overflow = "hidden";

init();
animate();

function init() {
    // Three.js Setup
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Lighting
    const light = new THREE.PointLight(0xffffff, 1, 100);
    light.position.set(10, 10, 10);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x404040));

    // Sphere geometry with UV-mapped texture
    const geometry = new THREE.SphereGeometry(1, 48, 48); // Reduced resolution for performance
    const material = new THREE.MeshPhongMaterial({
        shininess: 100,
        onBeforeCompile: (shader) => {
            shader.vertexShader = `
                varying vec2 vUv;
                uniform float time;
                ${shader.vertexShader}
            `.replace(
                `#include <begin_vertex>`,
                `
                #include <begin_vertex>
                vUv = uv;
                `
            );

            shader.fragmentShader = `
                varying vec2 vUv;
                uniform float time;
                
                vec3 hsv2rgb(vec3 c) {
                    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
                    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
                }
                
                ${shader.fragmentShader}
            `.replace(
                `vec4 diffuseColor = vec4( diffuse, opacity );`,
                `
                float hue = fract(vUv.x * 15.0 + vUv.y * 10.0 + time * 0.5);
                vec3 hsvColor = vec3(hue, 0.9, 1.0);
                vec3 rgbColor = hsv2rgb(hsvColor);
                vec4 diffuseColor = vec4(rgbColor, opacity);
                `
            );

            material.userData.shader = shader;
            shader.uniforms.time = {
                value: 0
            };
        }
    });

    sphereMesh = new THREE.Mesh(geometry, material);
    scene.add(sphereMesh);

    // Store original vertices and initialize vertex states
    originalVertices = geometry.attributes.position.array.slice();
    initializeVertexStates(geometry);

    camera.position.z = 5;

    // Event Listeners
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

function initializeVertexStates(geometry) {
    vertexStates = [];
    const positionAttribute = geometry.attributes.position;
    const indexArray = geometry.index.array;

    // Build neighbor map using triangle relationships
    const neighborMap = new Array(positionAttribute.count).fill().map(() => new Set());

    // Process each triangle to establish vertex neighbors
    for (let i = 0; i < indexArray.length; i += 3) {
        const a = indexArray[i];
        const b = indexArray[i + 1];
        const c = indexArray[i + 2];

        neighborMap[a].add(b);
        neighborMap[a].add(c);
        neighborMap[b].add(a);
        neighborMap[b].add(c);
        neighborMap[c].add(a);
        neighborMap[c].add(b);
    }

    // Initialize vertex states with proper neighbors
    for (let i = 0; i < positionAttribute.count; i++) {
        const state = new VertexState();
        state.neighbors = Array.from(neighborMap[i]);
        vertexStates.push(state);
    }
}

function onMouseDown(event) {
    mouseDown = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(sphereMesh);

    if (intersects.length > 0) {
        intersectedPoint.copy(intersects[0].point);
        let minDistanceSq = Infinity;
        const positions = sphereMesh.geometry.attributes.position.array;
        for (let i = 0; i < positions.length; i += 3) {
            const vertex = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
            const worldVertex = vertex.clone().applyMatrix4(sphereMesh.matrixWorld);
            const distanceSq = intersectedPoint.distanceToSquared(worldVertex);
            if (distanceSq < minDistanceSq) {
                minDistanceSq = distanceSq;
                grabbedVertexIndex = i / 3;
            }
        }

        // Initialize wave propagation
        vertexStates.forEach(state => {
            state.distanceFromSource = Infinity;
            state.lastUpdateTime = 0;
        });
        vertexStates[grabbedVertexIndex].distanceFromSource = 0;
        vertexStates[grabbedVertexIndex].lastUpdateTime = performance.now();
    }
}

function onMouseMove(event) {
    if (!mouseDown || grabbedVertexIndex === -1) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const planeNormal = new THREE.Vector3(0, 0, 1).transformDirection(camera.matrixWorld);
    const plane = new THREE.Plane(planeNormal, 0);
    const intersectPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersectPoint);

    const mouseDisplacement = intersectPoint.clone().sub(intersectedPoint);
    const worldDisplacement = mouseDisplacement.applyMatrix4(sphereMesh.matrixWorld.invert());

    // Apply displacement to grabbed vertex
    vertexStates[grabbedVertexIndex].displacement.copy(worldDisplacement);
}

function onMouseUp() {
    mouseDown = false;
    grabbedVertexIndex = -1;
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    const currentTime = performance.now();

    // Physics simulation
    vertexStates.forEach((state, i) => {
        if (i === grabbedVertexIndex && mouseDown) return;

        // Spring force from original position
        const springForce = state.displacement.clone().multiplyScalar(-SPRING_CONSTANT);

        // Damping force
        const dampingForce = state.velocity.clone().multiplyScalar(-DAMPING_CONSTANT);

        // Neighbor forces
        let neighborForce = new THREE.Vector3();
        state.neighbors.forEach(neighborIndex => {
            const neighborState = vertexStates[neighborIndex];
            const displacementDiff = neighborState.displacement.clone().sub(state.displacement);
            neighborForce.add(displacementDiff.multiplyScalar(SPRING_CONSTANT * 0.2));
        });

        // Total force
        state.force.copy(springForce.add(dampingForce).add(neighborForce));

        // Verlet integration
        const acceleration = state.force.clone().divideScalar(VERTEX_MASS);
        state.velocity.add(acceleration.multiplyScalar(delta));
        state.displacement.add(state.velocity.clone().multiplyScalar(delta));
    });

    // Update vertex positions
    const positions = sphereMesh.geometry.attributes.position.array;
    const originalPositions = originalVertices;

    vertexStates.forEach((state, i) => {
        const index = i * 3;
        positions[index] = originalPositions[index] + state.displacement.x;
        positions[index + 1] = originalPositions[index + 1] + state.displacement.y;
        positions[index + 2] = originalPositions[index + 2] + state.displacement.z;
    });

    sphereMesh.geometry.attributes.position.needsUpdate = true;
    sphereMesh.geometry.computeVertexNormals();

    // Update shader time uniform
    if (sphereMesh.material.userData.shader) {
        sphereMesh.material.userData.shader.uniforms.time.value = performance.now() / 1000;
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});