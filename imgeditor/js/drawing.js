// js/drawing.js

let isDrawing = false;
let lastX = 0;
let lastY = 0;

function setupDrawing() {
    imageCanvas.addEventListener('mousedown', startDrawing);
    imageCanvas.addEventListener('mousemove', draw);
    imageCanvas.addEventListener('mouseup', stopDrawing);
    imageCanvas.addEventListener('mouseout', stopDrawing);
}

function startDrawing(e) {
    isDrawing = true;
    lastX = e.offsetX;
    lastY = e.offsetY;
}

function draw(e) {
    if (!isDrawing) return;
    const x = e.offsetX;
    const y = e.offsetY;

    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();

    lastX = x;
    lastY = y;
}

function stopDrawing() {
    isDrawing = false;
}

// Export functions or variables if needed