// main_stretch.js
let scene, camera, renderer, sphereMesh, sphereBody;
let mouseDown = false, lastMouseX = 0, lastMouseY = 0;
let clock = new THREE.Clock();
let world;

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

    // Cannon.js Physics Setup
    world = new CANNON.World();
    world.gravity.set(0, 0, 0);
    world.solver.iterations = 20;

    // Physics body with damping
    sphereBody = new CANNON.Body({
        mass: 1,
        shape: new CANNON.Sphere(1),
        material: new CANNON.Material({ restitution: 0.5 }),
        linearDamping: 0.2,
        angularDamping: 0.2
    });
    world.addBody(sphereBody);

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
}

function onMouseMove(event) {
    if (!mouseDown) return;
    
    const deltaX = event.clientX - lastMouseX;
    const deltaY = event.clientY - lastMouseY;

    // Apply force with proper point parameter
    const force = new CANNON.Vec3(deltaX * 0.01, -deltaY * 0.01, 0);
    const localPoint = new CANNON.Vec3(0, 0, 0); // Force application point
    sphereBody.applyLocalForce(force, localPoint);

    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
}

function onMouseUp() {
    mouseDown = false;
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    // Update physics world
    world.step(1/60, delta);

    // Sync Three.js mesh with physics body
    sphereMesh.position.copy(sphereBody.position);
    sphereMesh.quaternion.copy(sphereBody.quaternion);

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