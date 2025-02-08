// app.js
let segmenter, isSegmenting, animationFrameId;
let backgroundCanvas, backgroundCtx;
const DILATION_RADIUS = 20; // Reduced for less aggressive dilation. Adjust as needed.
const SEGMENTATION_THRESHOLD = 0.6; // Adjustable threshold.  Start here and tweak.

const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');

async function setupWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        videoElement.srcObject = stream;
        await new Promise(resolve => videoElement.onloadedmetadata = resolve);
        videoElement.width = videoElement.videoWidth;
        videoElement.height = videoElement.videoHeight;
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
    } catch (error) {
        console.error('Error accessing webcam:', error);
    }
}

async function loadSegmentationModel() {
    await tf.setBackend('webgl');
    await tf.ready();

    segmenter = await bodySegmentation.createSegmenter(
        bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation,
        {
            runtime: 'mediapipe',
            modelType: 'full', // Use 'full' for higher accuracy.
            solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation'
        }
    );
}

function dilateMask(maskCtx) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = maskCtx.canvas.width;
    tempCanvas.height = maskCtx.canvas.height;
    const tempCtx = tempCanvas.getContext('2d');

    tempCtx.drawImage(maskCtx.canvas, 0, 0);
    tempCtx.globalCompositeOperation = 'lighten';

    // Create dilation effect
    for (let dx = -DILATION_RADIUS; dx <= DILATION_RADIUS; dx++) {
        for (let dy = -DILATION_RADIUS; dy <= DILATION_RADIUS; dy++) {
             // Check if the displacement is within the dilation radius
            if (dx * dx + dy * dy <= DILATION_RADIUS * DILATION_RADIUS) {
                tempCtx.drawImage(maskCtx.canvas, dx, dy);
            }
        }
    }
    maskCtx.clearRect(0, 0, maskCtx.canvas.width, maskCtx.canvas.height); //Clear original
    maskCtx.drawImage(tempCanvas, 0, 0); //Draw dilated image.

}

async function processFrame() {
    if (!isSegmenting) return;

    const people = await segmenter.segmentPeople(videoElement);
    const mask = await bodySegmentation.toBinaryMask(
        people,
        { r: 0, g: 0, b: 0, a: 255 }, // Foreground (person) color: opaque black
        { r: 0, g: 0, b: 0, a: 0 },   // Background color: transparent black
        false,                         // Don't flip the mask horizontally
        SEGMENTATION_THRESHOLD          // Use the adjustable threshold
    );


    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = videoElement.videoWidth;
    maskCanvas.height = videoElement.videoHeight;
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.putImageData(mask, 0, 0);
    dilateMask(maskCtx);

    // Update output canvas
    const outputCtx = canvasElement.getContext('2d');

    // 1. Draw the background where the mask *is* present (person is masked out).
    outputCtx.drawImage(backgroundCanvas, 0, 0);          // Draw the initial background
    outputCtx.globalCompositeOperation = 'destination-in'; // Keep only pixels where *both* the background and the mask are present.
    outputCtx.drawImage(maskCanvas, 0, 0);                // Apply the mask.

    // 2. Draw the video on top, *filling in* the areas not covered by the mask.
    outputCtx.globalCompositeOperation = 'destination-over'; // Draw the video *behind* what's already on the canvas.
    outputCtx.drawImage(videoElement, 0, 0);               // Draw the current video frame.

    // --- Update background buffer ---

    // Create a temporary canvas to composite the background update.
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = videoElement.videoWidth;
    tempCanvas.height = videoElement.videoHeight;
    const tempCtx = tempCanvas.getContext('2d');

    // 1. Draw the current video frame.
    tempCtx.drawImage(videoElement, 0, 0);

    // 2. Use 'destination-out' to *remove* the areas where the mask is present (the person).
    tempCtx.globalCompositeOperation = 'destination-out';
    tempCtx.drawImage(maskCanvas, 0, 0);  // Remove the person from the video frame using the mask.

    // 3. Reset the composite operation to 'source-over' (normal drawing).
    tempCtx.globalCompositeOperation = 'source-over';

    // 4. Draw the updated background (only the non-person parts) onto the background canvas.
    backgroundCtx.drawImage(tempCanvas, 0, 0);

    animationFrameId = requestAnimationFrame(processFrame);
}



startButton.addEventListener('click', async () => {
    if (!segmenter) {
        await setupWebcam();
        await loadSegmentationModel();
        backgroundCanvas = document.createElement('canvas');
        backgroundCanvas.width = videoElement.videoWidth;
        backgroundCanvas.height = videoElement.videoHeight;
        backgroundCtx = backgroundCanvas.getContext('2d');
        // Capture the very first frame as the initial background.
        backgroundCtx.drawImage(videoElement, 0, 0);
    }

    startButton.disabled = true;
    stopButton.disabled = false;
    isSegmenting = true;
    processFrame();
});

stopButton.addEventListener('click', () => {
    isSegmenting = false;
    startButton.disabled = false;
    stopButton.disabled = true;
    cancelAnimationFrame(animationFrameId);
    // Clear the output canvas.
    canvasElement.getContext('2d').clearRect(0, 0, canvasElement.width, canvasElement.height);
});

stopButton.disabled = true;