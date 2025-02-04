const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const DOTS_COUNT = 200;
const DOT_RADIUS = 5;
const ACTIVATION_SPEED = 3;
const MOUSE_FORCE_RADIUS = 50;
const MOUSE_FORCE_STRENGTH = 0.5;
const CLICK_FORCE_RADIUS_MULTIPLIER = 4;
const CLICK_FORCE_STRENGTH_MULTIPLIER = 8;
const CLICK_DURATION = 500;
const CLICK_FORCE_RADIUS = MOUSE_FORCE_RADIUS * CLICK_FORCE_RADIUS_MULTIPLIER;
const CLICK_FORCE_STRENGTH = MOUSE_FORCE_STRENGTH * CLICK_FORCE_STRENGTH_MULTIPLIER;
const FRICTION_FACTOR = 0.95;

// Canvas setup
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

class Dot {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.radius = DOT_RADIUS;
        this.isMoving = false;
        this.color = this.getRandomColor();
    }

    getRandomColor() {
        const r = Math.floor(Math.random() * 256);
        const g = Math.floor(Math.random() * 256);
        const b = Math.floor(Math.random() * 256);
        return `rgb(${r},${g},${b})`;
    }

    update() {
        if (!this.isMoving) return;

        // Update position
        this.x += this.vx;
        this.y += this.vy;

        // Wall collisions
        const dampingFactor = 0.98;
        if (this.x < this.radius) {
            this.x = this.radius;
            this.vx *= -dampingFactor;
        }
        if (this.x > canvas.width - this.radius) {
            this.x = canvas.width - this.radius;
            this.vx *= -dampingFactor;
        }
        if (this.y < this.radius) {
            this.y = this.radius;
            this.vy *= -dampingFactor;
        }
        if (this.y > canvas.height - this.radius) {
            this.y = canvas.height - this.radius;
            this.vy *= -dampingFactor;
        }
    }

    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
    }
}

// Create dots grid
const dots = [];
const cols = Math.floor(Math.sqrt(DOTS_COUNT));
const rows = cols;
const spacingX = canvas.width / (cols + 1);
const spacingY = canvas.height / (rows + 1);

for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
        dots.push(new Dot(
            (j + 1) * spacingX,
            (i + 1) * spacingY
        ));
    }
}

// Mouse interaction
let mouseX = 0, mouseY = 0;
canvas.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
});

// Click interaction
let isClicking = false;
let clickMouseX = 0;
let clickMouseY = 0;
let clickEndTime = 0;

canvas.addEventListener('mousedown', (e) => {
    isClicking = true;
    clickMouseX = e.clientX;
    clickMouseY = e.clientY;
    clickEndTime = performance.now() + CLICK_DURATION;
});

// Friction Toggle Logic
const frictionToggle = document.getElementById('frictionToggle');
let isFrictionEnabled = false;

frictionToggle.addEventListener('change', () => {
    isFrictionEnabled = frictionToggle.checked;
});

// Animation loop
function animate() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (isFrictionEnabled) {
        dots.forEach(dot => {
            if (dot.isMoving) {
                dot.vx *= FRICTION_FACTOR;
                dot.vy *= FRICTION_FACTOR;
            }
        });
    }

    dots.forEach(dot => {
        const dxMouse = mouseX - dot.x;
        const dyMouse = mouseY - dot.y;
        const distMouseSq = dxMouse * dxMouse + dyMouse * dyMouse;

        if (!dot.isMoving && distMouseSq < dot.radius * dot.radius) {
            const angle = Math.random() * Math.PI * 2;
            dot.vx = Math.cos(angle) * ACTIVATION_SPEED;
            dot.vy = Math.sin(angle) * ACTIVATION_SPEED;
            dot.isMoving = true;
        }

        if (distMouseSq < MOUSE_FORCE_RADIUS * MOUSE_FORCE_RADIUS) {
            const distMouse = Math.sqrt(distMouseSq);
            const forceFactor = (MOUSE_FORCE_RADIUS - distMouse) / MOUSE_FORCE_RADIUS;
            const nxMouse = dxMouse / distMouse;
            const nyMouse = dyMouse / distMouse;

            dot.vx -= nxMouse * MOUSE_FORCE_STRENGTH * forceFactor;
            dot.vy -= nyMouse * MOUSE_FORCE_STRENGTH * forceFactor;
            dot.isMoving = true;
        }

        if (isClicking && performance.now() < clickEndTime) {
            const dxClick = clickMouseX - dot.x;
            const dyClick = clickMouseY - dot.y;
            const distClickSq = dxClick * dxClick + dyClick * dyClick;

            if (distClickSq < CLICK_FORCE_RADIUS * CLICK_FORCE_RADIUS) {
                const distClick = Math.sqrt(distClickSq);
                const forceFactorClick = (CLICK_FORCE_RADIUS - distClick) / CLICK_FORCE_RADIUS;
                const nxClick = dxClick / distClick;
                const nyClick = dyClick / distClick;

                dot.vx -= nxClick * CLICK_FORCE_STRENGTH * forceFactorClick;
                dot.vy -= nyClick * CLICK_FORCE_STRENGTH * forceFactorClick;
                dot.isMoving = true;
            }
        }
    });

    if (isClicking && performance.now() >= clickEndTime) {
        isClicking = false;
    }

    dots.forEach(dot => dot.update());

    // Collision detection and response
    for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
            const d1 = dots[i];
            const d2 = dots[j];

            const dx = d2.x - d1.x;
            const dy = d2.y - d1.y;
            const sqDist = dx * dx + dy * dy;
            const minDist = d1.radius + d2.radius;

            if (sqDist < minDist * minDist) {
                const dist = Math.sqrt(sqDist);
                const nx = dx / dist;
                const ny = dy / dist;

                const rvx = d1.vx - d2.vx;
                const rvy = d1.vy - d2.vy;
                const dotProd = rvx * nx + rvy * ny;

                if (dotProd > 0) {
                    const impulse = dotProd;
                    d1.vx -= impulse * nx;
                    d1.vy -= impulse * ny;
                    d2.vx += impulse * nx;
                    d2.vy += impulse * ny;

                    const overlap = (minDist - dist) / 2;
                    d1.x -= overlap * nx;
                    d1.y -= overlap * ny;
                    d2.x += overlap * nx;
                    d2.y += overlap * ny;

                    d1.isMoving = true;
                    d2.isMoving = true;
                }
            }
        }
    }

    dots.forEach(dot => dot.draw());
    requestAnimationFrame(animate);
}

animate();