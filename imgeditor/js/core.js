// js/core.js

const imageCanvas = document.getElementById('imageCanvas');
const ctx = imageCanvas.getContext('2d');
const imageUpload = document.getElementById('imageUpload');
let img = new Image(); // Image object to hold uploaded image

function setupCanvas() {
    // You might add more canvas initialization here later
}

function loadImage() {
    imageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                img.onload = () => {
                    imageCanvas.width = img.width;
                    imageCanvas.height = img.height;
                    ctx.drawImage(img, 0, 0, img.width, img.height);
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
}

// Export functions or variables if needed for other modules (in more complex scenarios)
// For this simple example, we'll rely on global scope (for now, not best practice for larger projects)