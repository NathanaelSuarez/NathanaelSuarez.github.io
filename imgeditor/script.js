// script.js

document.addEventListener('DOMContentLoaded', () => {
    setupCanvas(); // From core.js (though currently empty, can add initialization later)
    loadImage();    // From core.js
    setupDrawing(); // From drawing.js
    setupSaving();  // From saving.js
    setupColorPicker(); // From color-picker.js
});