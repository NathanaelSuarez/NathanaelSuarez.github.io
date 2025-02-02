// const imageCanvas = document.getElementById('imageCanvas'); // Get canvas from global scope - Removed redundant declaration
const saveButton = document.getElementById('saveButton');

function setupSaving() {
    saveButton.addEventListener('click', saveImage);
}

function saveImage() {
    const imageDataURL = imageCanvas.toDataURL('image/png');
    const downloadLink = document.createElement('a');
    downloadLink.href = imageDataURL;
    downloadLink.download = 'edited_image.png';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}

// Export functions or variables if needed