let scene, camera, renderer, ball;
let isDragging = false;
let mouseStart = { x: 0, y: 0 };
let originalScale = 1;
let currentScale = { x: 1, y: 1, z: 1 };

init();
animate();

function init() {
    // Scene setup
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Create ball
    const geometry = new THREE.SphereGeometry(1, 32, 32);
    const material = new THREE.MeshStandardMaterial({
        color: 0xff0000,
        metalness: 0.3,
        roughness: 0.4,
    });
    ball = new THREE.Mesh(geometry, material);
    scene.add(ball);

    // Add lights
    const light = new THREE.PointLight(0xffffff, 1);
    light.position.set(5, 5, 5);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x404040));

    camera.position.z = 5;

    // Event listeners
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

function onMouseDown(event) {
    isDragging = true;
    mouseStart.x = event.clientX;
    mouseStart.y = event.clientY;
}

function onMouseMove(event) {
    if (!isDragging) return;

    const deltaX = event.clientX - mouseStart.x;
    const deltaY = event.clientY - mouseStart.y;

    // Calculate stretch factors (clamped to reasonable values)
    currentScale.x = Math.min(Math.max(1 + deltaX * 0.01, 0.5), 2);
    currentScale.y = Math.min(Math.max(1 - deltaY * 0.01, 0.5), 2);
}

function onMouseUp() {
    isDragging = false;
    // Reset scale gradually
    currentScale.x = 1;
    currentScale.y = 1;
}

function animate() {
    requestAnimationFrame(animate);

    // Smooth scale transitions
    const springFactor = 0.15;
    ball.scale.x += (currentScale.x - ball.scale.x) * springFactor;
    ball.scale.y += (currentScale.y - ball.scale.y) * springFactor;
    ball.scale.z += (1 - ball.scale.z) * springFactor;

    // Add slight rotation
    if (!isDragging) {
        ball.rotation.x += 0.01;
        ball.rotation.y += 0.01;
    }

    renderer.render(scene, camera);
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});