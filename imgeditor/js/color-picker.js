// js/color-picker.js

const colorPicker = document.getElementById('colorPicker');
const colorPreview = document.getElementById('colorPreview');

function setupColorPicker() {
    updateColorPreview(); // Initial color preview setup
    colorPicker.addEventListener('input', updateColorPreview);
}

function updateColorPreview() {
    colorPreview.style.backgroundColor = colorPicker.value;
}

// Export functions or variables if needed