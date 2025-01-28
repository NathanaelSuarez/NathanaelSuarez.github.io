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
const DAMPING_CONSTANT = 1.5;

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
    let geometry = new THREE.BoxGeometry( 2, 2, 2, 10, 10, 10 ); // Reduced resolution for performance
    geometry = mergeVertices(geometry); // Call mergeVertices here
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
                float hue = fract(vUv.x * 10.0 + vUv.y * 1.0 + time * 0.5);
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

    camera.position.set(3, 3, 3);  // x, y, z coordinates
    camera.lookAt(scene.position); // Ensure camera points to scene center

    // Event Listeners for Mouse
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Event Listeners for Touch
    document.addEventListener('touchstart', onTouchStart);
    document.addEventListener('touchmove', onTouchMove);
    document.addEventListener('touchend', onTouchEnd);
}


function mergeVertices(geometry, tolerance = 1e-6) {
    tolerance = Math.max(tolerance, Number.EPSILON);

    const positions = geometry.attributes.position.array;
    const uvs = geometry.attributes.uv ? geometry.attributes.uv.array : null; // Get UVs if they exist
    const vertexMap = {}; // Hashmap for position to index and UVs
    const uniqueVertices = [];
    let newIndices = []; // No need to initialize as const if re-assigned
    const indexArray = geometry.index ? geometry.index.array : null;

    const indices = indexArray ? indexArray : Array.from({ length: positions.length / 3 }, (_, i) => i);

    for (let i = 0; i < indices.length; i++) {
        const index = indices[i];
        const vx = positions[index * 3];
        const vy = positions[index * 3 + 1];
        const vz = positions[index * 3 + 2];

        const key = `${vx.toFixed(6)}_${vy.toFixed(6)}_${vz.toFixed(6)}`; // Use toFixed for precision

        if (vertexMap[key] === undefined) {
            vertexMap[key] = {
                index: uniqueVertices.length,
                uvs: [] // Store UVs for averaging
            };
            uniqueVertices.push(new THREE.Vector3(vx, vy, vz));
            if (uvs) {
                vertexMap[key].uvs.push({ u: uvs[index * 2], v: uvs[index * 2 + 1] }); // Store initial UV
            }
            newIndices.push(vertexMap[key].index);
        } else {
            newIndices.push(vertexMap[key].index);
            if (uvs) {
                vertexMap[key].uvs.push({ u: uvs[index * 2], v: uvs[index * 2 + 1] }); // Collect UVs to average
            }
        }
    }

    const positionAttribute = new THREE.Float32BufferAttribute(uniqueVertices.length * 3, 3);
    for (let i = 0; i < uniqueVertices.length; i++) {
        positionAttribute.setXYZ(i, uniqueVertices[i].x, uniqueVertices[i].y, uniqueVertices[i].z);
    }
    geometry.setAttribute('position', positionAttribute);

    if (uvs) {
        const averagedUvs = [];
        for (const key in vertexMap) {
            if (vertexMap.hasOwnProperty(key)) {
                const uvData = vertexMap[key].uvs;
                let totalU = 0;
                let totalV = 0;
                for (const uv of uvData) {
                    totalU += uv.u;
                    totalV += uv.v;
                }
                const averageU = totalU / uvData.length;
                const averageV = totalV / uvData.length;
                averagedUvs[vertexMap[key].index] = new THREE.Vector2(averageU, averageV);
            }
        }

        const uvAttribute = new THREE.Float32BufferAttribute(uniqueVertices.length * 2, 2);
        for (let i = 0; i < uniqueVertices.length; i++) {
            uvAttribute.setXY(i, averagedUvs[i].x, averagedUvs[i].y);
        }
        geometry.setAttribute('uv', uvAttribute);
    }


    geometry.setIndex(newIndices); // Set new index buffer
    // geometry.index = new THREE.BufferAttribute(new Uint32Array(newIndices), 1); // Redundant line removed

    geometry.computeVertexNormals(); // Recompute normals based on merged vertices
    geometry.computeBoundingSphere();
    return geometry;
}


function initializeVertexStates(geometry) {
    vertexStates = [];
    const positionAttribute = geometry.attributes.position;
    const indexArray = geometry.index.array;
    const uniqueVertexCount = positionAttribute.count; // Use the count of unique vertices

    // Build neighbor map using triangle relationships based on the new index
    const neighborMap = new Array(uniqueVertexCount).fill().map(() => new Set());

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
    for (let i = 0; i < uniqueVertexCount; i++) {
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

// Touch event handlers
function onTouchStart(event) {
    event.preventDefault(); // Prevent page scroll on touch
    if (event.touches.length > 0) {
        const touch = event.touches[0];
        const simulatedEvent = {
            clientX: touch.clientX,
            clientY: touch.clientY
        };
        onMouseDown(simulatedEvent);
    }
}

function onTouchMove(event) {
    event.preventDefault(); // Prevent page scroll on touch
    if (event.touches.length > 0) {
        const touch = event.touches[0];
        const simulatedEvent = {
            clientX: touch.clientX,
            clientY: touch.clientY
        };
        onMouseMove(simulatedEvent);
    }
}

function onTouchEnd(event) {
    event.preventDefault();
    onMouseUp();
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
