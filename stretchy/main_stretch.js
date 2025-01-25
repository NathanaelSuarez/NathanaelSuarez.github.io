// main_stretch.js
let scene, camera, renderer, sphereMesh, sphereBody;
let mouseDown = false, lastMouseX = 0, lastMouseY = 0;
let clock = new THREE.Clock();
// let world; // Removed Cannon.js
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let intersectedPoint = new THREE.Vector3();
let originalVertices = []; // Store original vertex positions
let grabbedVertexIndex = -1; // Index of the vertex being grabbed


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
    originalVertices = geometry.attributes.position.array.slice(); // Copy the array


    // Cannon.js Physics Setup (removed)
    // world = new CANNON.World();
    // world.gravity.set(0, 0, 0);
    // world.solver.iterations = 20;
    // sphereBody = new CANNON.Body({
    //     mass: 1,
    //     shape: new CANNON.Sphere(1),
    //     material: new CANNON.Material({ restitution: 0.5 }),
    //     linearDamping: 0.2,
    //     angularDamping: 0.2
    // });
    // world.addBody(sphereBody);

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
                grabbedVertexIndex = i / 3; // Store vertex index
            }
        }
    }
}

function onMouseMove(event) {
    if (!mouseDown || grabbedVertexIndex === -1) return; // Only move if mouse down and vertex grabbed

    mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
    mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;

    raycaster.setFromCamera( mouse, camera );
    const planeNormal = new THREE.Vector3(0, 0, 1).transformDirection(camera.matrixWorld); // Plane normal facing camera
    const plane = new THREE.Plane(planeNormal, 0); // Plane at distance 0 from camera origin

    const intersectPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersectPoint);


    const positions = sphereMesh.geometry.attributes.position.array;
    const index = grabbedVertexIndex * 3;

    // Get original vertex position
    const originalVertex = new THREE.Vector3(originalVertices[index], originalVertices[index + 1], originalVertices[index + 2]);
    const worldOriginalVertex = originalVertex.clone().applyMatrix4(sphereMesh.matrixWorld);

    // Calculate the displacement based on mouse movement in world space
    const displacement = intersectPoint.clone().sub(intersectedPoint);


    // Apply displacement to the grabbed vertex (in local space)
    const modifiedVertex = worldOriginalVertex.clone().add(displacement).applyMatrix4(sphereMesh.matrixWorld.invert()); // Transform back to local space


    positions[index] = modifiedVertex.x;
    positions[index + 1] = modifiedVertex.y;
    positions[index + 2] = modifiedVertex.z;

    sphereMesh.geometry.attributes.position.needsUpdate = true; // Important: Update the vertex buffer
    sphereMesh.geometry.computeVertexNormals(); // Recompute normals for lighting
}

function onMouseUp() {
    mouseDown = false;
    grabbedVertexIndex = -1; // Reset grabbed vertex

    // In a more advanced version, you would smoothly return the sphere to its original shape here.
    // For now, it will just snap back when you click again.
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

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