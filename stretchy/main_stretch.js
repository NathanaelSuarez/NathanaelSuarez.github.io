// main_stretch.js
let scene, camera, renderer, sphereMesh, sphereBody;
let mouseDown = false, lastMouseX = 0, lastMouseY = 0;
let clock = new THREE.Clock();
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let intersectedPoint = new THREE.Vector3();
let originalVertices = [];
let grabbedVertexIndex = -1;
let isReturningToOriginal = false;
let returnSpeed = 0.05; // Adjust for return speed


init();
animate();

function init() {
    // Three.js Setup
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Lighting
    const light = new THREE.PointLight(0xffffff, 1, 100);
    light.position.set(10, 10, 10);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x404040));

    // High-poly sphere with custom shader
    const geometry = new THREE.SphereGeometry(1, 64, 64);
    const material = new THREE.MeshPhongMaterial({
        color: 0xff0000,
        shininess: 100,
        onBeforeCompile: (shader) => {
            shader.vertexShader = `
                uniform float time;
                varying vec3 vPosition;
                ${shader.vertexShader}
            `.replace(
                `#include <begin_vertex>`,
                `
                vec3 transformed = vec3(position);
                float wave = sin(time + position.x * 5.0) * 0.1;
                transformed.y += wave;
                vPosition = transformed;
                `
            );
            material.userData.shader = shader;
        }
    });

    sphereMesh = new THREE.Mesh(geometry, material);
    scene.add(sphereMesh);

    // Store original vertices
    originalVertices = geometry.attributes.position.array.slice();

    camera.position.z = 5;

    // Event Listeners
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

function onMouseDown(event) {
    mouseDown = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    isReturningToOriginal = false; // Stop any ongoing return animation

    mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
    mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;

    raycaster.setFromCamera( mouse, camera );

    const intersects = raycaster.intersectObject( sphereMesh );

    if (intersects.length > 0) {
        intersectedPoint.copy(intersects[0].point);

        // Find the closest vertex to the intersection point
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
    }
}

function onMouseMove(event) {
    if (!mouseDown || grabbedVertexIndex === -1) return;

    mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
    mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;

    raycaster.setFromCamera( mouse, camera );
    const planeNormal = new THREE.Vector3(0, 0, 1).transformDirection(camera.matrixWorld);
    const plane = new THREE.Plane(planeNormal, 0);
    const intersectPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersectPoint);

    const positions = sphereMesh.geometry.attributes.position.array;
    const originalPositions = originalVertices; // Use originalVertices for calculations
    const vertexCount = sphereMesh.geometry.attributes.position.count;

    // Get original grabbed vertex position (world space)
    const originalGrabbedVertex = new THREE.Vector3(originalPositions[grabbedVertexIndex * 3], originalPositions[grabbedVertexIndex * 3 + 1], originalPositions[grabbedVertexIndex * 3 + 2]);
    const worldOriginalGrabbedVertex = originalGrabbedVertex.clone().applyMatrix4(sphereMesh.matrixWorld);

    // Calculate displacement based on mouse movement in world space, relative to the *original grabbed vertex position*
    const displacement = intersectPoint.clone().sub(intersectedPoint);


    const influenceRadius = 1.5; // Radius of influence for stretching
    const falloffPower = 2.0;     // Controls how quickly the influence falls off

    for (let i = 0; i < vertexCount; i++) {
        const index = i * 3;
        const originalVertex = new THREE.Vector3(originalPositions[index], originalPositions[index + 1], originalPositions[index + 2]);
        const worldOriginalVertex = originalVertex.clone().applyMatrix4(sphereMesh.matrixWorld);

        const distanceToClickSq = intersectedPoint.distanceToSquared(worldOriginalVertex); // Distance to the *click point*

        let falloff = 0;
        if (distanceToClickSq < influenceRadius * influenceRadius) {
            falloff = Math.exp(-distanceToClickSq / (2 * (influenceRadius/3) * (influenceRadius/3))); // Gaussian falloff
        }


        // Apply displacement with falloff
        const modifiedVertex = worldOriginalVertex.clone();
        modifiedVertex.add(displacement.clone().multiplyScalar(falloff));

        const localModifiedVertex = modifiedVertex.applyMatrix4(sphereMesh.matrixWorld.invert()); // Back to local space

        positions[index] = localModifiedVertex.x;
        positions[index + 1] = localModifiedVertex.y;
        positions[index + 2] = localModifiedVertex.z;
    }

    sphereMesh.geometry.attributes.position.needsUpdate = true;
    sphereMesh.geometry.computeVertexNormals();
}

function onMouseUp() {
    mouseDown = false;
    grabbedVertexIndex = -1;
    isReturningToOriginal = true; // Start returning to original shape
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (isReturningToOriginal) {
        const positions = sphereMesh.geometry.attributes.position.array;
        const originalPositions = originalVertices;
        let stillReturning = false; // Flag to check if any vertex is still moving

        for (let i = 0; i < sphereMesh.geometry.attributes.position.count; i++) {
            const index = i * 3;
            const currentVertex = new THREE.Vector3(positions[index], positions[index + 1], positions[index + 2]);
            const targetVertex = new THREE.Vector3(originalPositions[index], originalPositions[index + 1], originalPositions[index + 2]);

            if (currentVertex.distanceToSquared(targetVertex) > 0.0001) { // Check if vertex is far enough from target
                currentVertex.lerp(targetVertex, returnSpeed); // Move towards original position
                positions[index] = currentVertex.x;
                positions[index + 1] = currentVertex.y;
                positions[index + 2] = currentVertex.z;
                stillReturning = true; // Indicate that vertices are still moving
            } else {
                // Vertex is close enough to original, snap to original to avoid tiny movements forever
                positions[index] = targetVertex.x;
                positions[index + 1] = targetVertex.y;
                positions[index + 2] = targetVertex.z;
            }
        }

        sphereMesh.geometry.attributes.position.needsUpdate = true;
        sphereMesh.geometry.computeVertexNormals();

        if (!stillReturning) {
            isReturningToOriginal = false; // Stop returning when all vertices are close to original
        }
    }


    // Update shader uniform
    if (sphereMesh.material.userData.shader) {
        sphereMesh.material.userData.shader.uniforms.time = {
            value: performance.now() / 1000
        };
    }

    renderer.render(scene, camera);
}

// Window resize handler
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});