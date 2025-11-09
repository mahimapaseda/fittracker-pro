let pose = null;
let hands = null;
let camera = null;
let videoElement = null;
let canvasElement = null;
let canvasCtx = null;
let currentGesture = 'none';

let totalReps = 0;
let isCounting = false;
let voiceEnabled = false;
let activeHand = 'none';

const armTracking = {
    right: {
        state: 'down',
        angleHistory: [],
        minAngle: 180,
        maxAngle: 180,
        lastRepTime: 0,
        hasReachedUp: false,
        hasReachedDown: false,
        velocity: 0,
        lastAngle: 180,
        activityScore: 0
    },
    left: {
        state: 'down',
        angleHistory: [],
        minAngle: 180,
        maxAngle: 180,
        lastRepTime: 0,
        hasReachedUp: false,
        hasReachedDown: false,
        velocity: 0,
        lastAngle: 180,
        activityScore: 0
    }
};

const CONFIG = {
    SMOOTHING_WINDOW: 3,
    MIN_CURL_ANGLE: 60,
    MAX_EXTEND_ANGLE: 150,
    REP_COOLDOWN_MS: 400,
    MIN_RANGE_OF_MOTION: 60
};

const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const voiceBtn = document.getElementById('voiceBtn');
const handBtn = document.getElementById('handBtn');
const statusEl = document.getElementById('status');
const totalRepsEl = document.getElementById('totalReps');
const armAngleEl = document.getElementById('armAngle');
const armStatusEl = document.getElementById('armStatus');

function initializePose() {
    pose = new Pose({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
        }
    });

    pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        smoothSegmentation: false,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6
    });

    hands = new Hands({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
    });

    hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.5
    });

    pose.onResults(onPoseResults);
    hands.onResults(onHandsResults);
}

function calculateAngle(point1, point2, point3) {
    const radians = Math.atan2(point3.y - point2.y, point3.x - point2.x) - 
                    Math.atan2(point1.y - point2.y, point1.x - point2.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180.0) {
        angle = 360 - angle;
    }
    return angle;
}

function smoothAngle(angleHistory, newAngle) {
    angleHistory.push(newAngle);
    if (angleHistory.length > CONFIG.SMOOTHING_WINDOW) {
        angleHistory.shift();
    }
    
    if (angleHistory.length === 1) return newAngle;
    
    let sum = 0;
    let weightSum = 0;
    for (let i = 0; i < angleHistory.length; i++) {
        const weight = i + 1;
        sum += angleHistory[i] * weight;
        weightSum += weight;
    }
    return sum / weightSum;
}

function isHandAboveShoulder(shoulder, wrist) {
    return wrist.y < shoulder.y;
}

function isHandBelowElbow(elbow, wrist) {
    return wrist.y > elbow.y;
}

function detectBicepCurl(landmarks) {
    const rightShoulder = landmarks[12];
    const rightElbow = landmarks[14];
    const rightWrist = landmarks[16];
    
    const leftShoulder = landmarks[11];
    const leftElbow = landmarks[13];
    const leftWrist = landmarks[15];

    let rightAngle = null;
    let leftAngle = null;
    let repDetected = false;
    const currentTime = Date.now();

    if (rightShoulder && rightElbow && rightWrist) {
        const rawAngle = calculateAngle(rightShoulder, rightElbow, rightWrist);
        rightAngle = smoothAngle(armTracking.right.angleHistory, rawAngle);
        
        if (rightAngle < armTracking.right.minAngle) {
            armTracking.right.minAngle = rightAngle;
        }
        if (rightAngle > armTracking.right.maxAngle) {
            armTracking.right.maxAngle = rightAngle;
        }
        
        const handAboveShoulder = isHandAboveShoulder(rightShoulder, rightWrist);
        
        if (armTracking.right.state === 'down') {
            if (rightAngle < CONFIG.MIN_CURL_ANGLE) {
                if (handAboveShoulder || rightAngle < CONFIG.MIN_CURL_ANGLE - 10) {
                    armTracking.right.hasReachedUp = true;
                    armTracking.right.state = 'up';
                }
            }
        } else if (armTracking.right.state === 'up') {
            if (rightAngle > CONFIG.MAX_EXTEND_ANGLE) {
                armTracking.right.hasReachedDown = true;
                
                const rangeOfMotion = armTracking.right.maxAngle - armTracking.right.minAngle;
                const timeSinceLastRep = currentTime - armTracking.right.lastRepTime;
                
                if (armTracking.right.hasReachedUp && 
                    armTracking.right.hasReachedDown && 
                    rangeOfMotion >= CONFIG.MIN_RANGE_OF_MOTION &&
                    timeSinceLastRep >= CONFIG.REP_COOLDOWN_MS) {
                    
                    repDetected = true;
                    armTracking.right.lastRepTime = currentTime;
                    
                    armTracking.right.state = 'down';
                    armTracking.right.hasReachedUp = false;
                    armTracking.right.hasReachedDown = false;
                    armTracking.right.minAngle = 180;
                    armTracking.right.maxAngle = 180;
                } else if (rightAngle > CONFIG.MAX_EXTEND_ANGLE + 15) {
                    armTracking.right.state = 'down';
                    armTracking.right.hasReachedUp = false;
                    armTracking.right.hasReachedDown = false;
                }
            }
        }
    }

    if (leftShoulder && leftElbow && leftWrist) {
        const rawAngle = calculateAngle(leftShoulder, leftElbow, leftWrist);
        leftAngle = smoothAngle(armTracking.left.angleHistory, rawAngle);
        
        if (leftAngle < armTracking.left.minAngle) {
            armTracking.left.minAngle = leftAngle;
        }
        if (leftAngle > armTracking.left.maxAngle) {
            armTracking.left.maxAngle = leftAngle;
        }
        
        const handAboveShoulder = isHandAboveShoulder(leftShoulder, leftWrist);
        
        if (armTracking.left.state === 'down') {
            if (leftAngle < CONFIG.MIN_CURL_ANGLE) {
                if (handAboveShoulder || leftAngle < CONFIG.MIN_CURL_ANGLE - 10) {
                    armTracking.left.hasReachedUp = true;
                    armTracking.left.state = 'up';
                }
            }
        } else if (armTracking.left.state === 'up') {
            if (leftAngle > CONFIG.MAX_EXTEND_ANGLE) {
                armTracking.left.hasReachedDown = true;
                
                const rangeOfMotion = armTracking.left.maxAngle - armTracking.left.minAngle;
                const timeSinceLastRep = currentTime - armTracking.left.lastRepTime;
                
                if (armTracking.left.hasReachedUp && 
                    armTracking.left.hasReachedDown && 
                    rangeOfMotion >= CONFIG.MIN_RANGE_OF_MOTION &&
                    timeSinceLastRep >= CONFIG.REP_COOLDOWN_MS) {
                    
                    repDetected = true;
                    armTracking.left.lastRepTime = currentTime;
                    
                    armTracking.left.state = 'down';
                    armTracking.left.hasReachedUp = false;
                    armTracking.left.hasReachedDown = false;
                    armTracking.left.minAngle = 180;
                    armTracking.left.maxAngle = 180;
                } else if (leftAngle > CONFIG.MAX_EXTEND_ANGLE + 15) {
                    armTracking.left.state = 'down';
                    armTracking.left.hasReachedUp = false;
                    armTracking.left.hasReachedDown = false;
                }
            }
        }
    }

    if (rightAngle !== null) {
        const rightVel = Math.abs(rightAngle - armTracking.right.lastAngle);
        const rightRange = armTracking.right.maxAngle - armTracking.right.minAngle;
        const rightConfidence = rightShoulder.visibility * rightElbow.visibility * rightWrist.visibility;
        
        armTracking.right.velocity = rightVel;
        armTracking.right.activityScore = (rightVel * 0.4 + rightRange * 0.3 + rightConfidence * 10) * 0.2 + armTracking.right.activityScore * 0.8;
        armTracking.right.lastAngle = rightAngle;
    } else {
        armTracking.right.activityScore *= 0.85;
    }
    
    if (leftAngle !== null) {
        const leftVel = Math.abs(leftAngle - armTracking.left.lastAngle);
        const leftRange = armTracking.left.maxAngle - armTracking.left.minAngle;
        const leftConfidence = leftShoulder.visibility * leftElbow.visibility * leftWrist.visibility;
        
        armTracking.left.velocity = leftVel;
        armTracking.left.activityScore = (leftVel * 0.4 + leftRange * 0.3 + leftConfidence * 10) * 0.2 + armTracking.left.activityScore * 0.8;
        armTracking.left.lastAngle = leftAngle;
    } else {
        armTracking.left.activityScore *= 0.85;
    }
    
    const rightActive = armTracking.right.activityScore > 3 && (armTracking.right.state !== 'down' || armTracking.right.velocity > 1);
    const leftActive = armTracking.left.activityScore > 3 && (armTracking.left.state !== 'down' || armTracking.left.velocity > 1);
    
    if (rightActive && leftActive) {
        const scoreDiff = Math.abs(armTracking.right.activityScore - armTracking.left.activityScore);
        if (scoreDiff > 2) {
            activeHand = armTracking.right.activityScore > armTracking.left.activityScore ? 'right' : 'left';
        } else {
            activeHand = 'both';
        }
    } else if (rightActive) {
        activeHand = 'right';
    } else if (leftActive) {
        activeHand = 'left';
    } else {
        activeHand = 'none';
    }
    
    const displayAngle = rightAngle !== null ? rightAngle : (leftAngle !== null ? leftAngle : null);
    if (displayAngle !== null) {
        armAngleEl.textContent = Math.round(displayAngle) + '°';
        
        const activeArm = rightAngle !== null ? armTracking.right : armTracking.left;
        const handLabel = activeHand === 'both' ? 'Both' : activeHand === 'right' ? 'Right' : 'Left';
        
        if (activeArm.state === 'up') {
            armStatusEl.textContent = `${handLabel} Curl Up ✓`;
            armStatusEl.style.color = '#FFFF00';
        } else if (activeArm.hasReachedUp && activeArm.state === 'down') {
            armStatusEl.textContent = `${handLabel} Extend`;
            armStatusEl.style.color = '#00FFFF';
        } else {
            armStatusEl.textContent = `${handLabel} Ready`;
            armStatusEl.style.color = '#FFFFFF';
        }
    } else {
        armAngleEl.textContent = '--';
        armStatusEl.textContent = currentGesture !== 'none' ? `Gesture: ${currentGesture}` : 'No Detection';
        armStatusEl.style.color = currentGesture !== 'none' ? '#00FFFF' : '#FFAAAA';
        activeHand = 'none';
    }

    if (repDetected) {
        totalReps++;
        totalRepsEl.textContent = totalReps;
        
        if (voiceEnabled) {
            speakCount(totalReps);
        }
        
        totalRepsEl.style.transform = 'scale(1.3)';
        totalRepsEl.style.color = '#00FF00';
        totalRepsEl.style.transition = 'all 0.1s ease-out';
        
        setTimeout(() => {
            totalRepsEl.style.transform = 'scale(1)';
            totalRepsEl.style.color = '';
        }, 200);
        
        armStatusEl.textContent = 'Rep Counted! ✓';
        armStatusEl.style.color = '#00FF00';
        setTimeout(() => {
            armStatusEl.textContent = 'Ready';
            armStatusEl.style.color = '#FFFFFF';
        }, 500);
        
        return true;
    }

    return false;
}

function drawCircle(ctx, x, y, radius, color) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
}

function drawLine(ctx, x1, y1, x2, y2, color, lineWidth) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
}

function detectGesture(landmarks) {
    if (!landmarks || landmarks.length < 21) return 'none';
    
    const thumb = landmarks[4];
    const index = landmarks[8];
    const middle = landmarks[12];
    const ring = landmarks[16];
    const pinky = landmarks[20];
    
    if (thumb.y < landmarks[3].y && index.y > landmarks[6].y && 
        middle.y > landmarks[10].y && ring.y > landmarks[14].y && pinky.y > landmarks[18].y) {
        return 'thumbs_up';
    }
    
    if (index.y < landmarks[6].y && middle.y < landmarks[10].y && 
        ring.y > landmarks[14].y && pinky.y > landmarks[18].y) {
        return 'peace';
    }
    
    return 'open';
}

function onHandsResults(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        currentGesture = detectGesture(results.multiHandLandmarks[0]);
        
        if (currentGesture === 'thumbs_up' && !isCounting) {
            startCamera();
        } else if (currentGesture === 'peace') {
            resetCounter();
        }
    }
}

function onPoseResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    if (results.poseLandmarks) {
        const landmarks = results.poseLandmarks;
        
        const rightShoulder = landmarks[12];
        const rightElbow = landmarks[14];
        const rightWrist = landmarks[16];
        
        const leftShoulder = landmarks[11];
        const leftElbow = landmarks[13];
        const leftWrist = landmarks[15];
        
        if (rightShoulder && rightElbow && rightWrist) {
            const shoulderX = rightShoulder.x * canvasElement.width;
            const shoulderY = rightShoulder.y * canvasElement.height;
            const elbowX = rightElbow.x * canvasElement.width;
            const elbowY = rightElbow.y * canvasElement.height;
            const wristX = rightWrist.x * canvasElement.width;
            const wristY = rightWrist.y * canvasElement.height;
            
            let lineColor = '#00FF00';
            if (armTracking.right.state === 'up') {
                lineColor = '#FFFF00';
            } else if (armTracking.right.hasReachedUp && armTracking.right.state === 'down') {
                lineColor = '#00FFFF';
            }
            
            drawLine(canvasCtx, shoulderX, shoulderY, elbowX, elbowY, lineColor, 3);
            drawLine(canvasCtx, elbowX, elbowY, wristX, wristY, lineColor, 3);
            
            drawCircle(canvasCtx, shoulderX, shoulderY, 5, '#FF0000');
            drawCircle(canvasCtx, elbowX, elbowY, 6, '#FFFF00');
            drawCircle(canvasCtx, wristX, wristY, 5, '#FF0000');
        }
        
        if (leftShoulder && leftElbow && leftWrist) {
            const shoulderX = leftShoulder.x * canvasElement.width;
            const shoulderY = leftShoulder.y * canvasElement.height;
            const elbowX = leftElbow.x * canvasElement.width;
            const elbowY = leftElbow.y * canvasElement.height;
            const wristX = leftWrist.x * canvasElement.width;
            const wristY = leftWrist.y * canvasElement.height;
            
            let lineColor = '#00FF00';
            if (armTracking.left.state === 'up') {
                lineColor = '#FFFF00';
            } else if (armTracking.left.hasReachedUp && armTracking.left.state === 'down') {
                lineColor = '#00FFFF';
            }
            
            drawLine(canvasCtx, shoulderX, shoulderY, elbowX, elbowY, lineColor, 3);
            drawLine(canvasCtx, elbowX, elbowY, wristX, wristY, lineColor, 3);
            
            drawCircle(canvasCtx, shoulderX, shoulderY, 5, '#FF0000');
            drawCircle(canvasCtx, elbowX, elbowY, 6, '#FFFF00');
            drawCircle(canvasCtx, wristX, wristY, 5, '#FF0000');
        }
        
        if (typeof drawConnections !== 'undefined' && typeof POSE_CONNECTIONS !== 'undefined') {
            drawConnections(canvasCtx, landmarks, POSE_CONNECTIONS, {
                color: '#00FF00',
                lineWidth: 1
            });
        }
        
        if (typeof drawLandmarks !== 'undefined') {
            drawLandmarks(canvasCtx, landmarks, {
                color: '#FF0000',
                lineWidth: 1,
                radius: 2
            });
        }

        detectBicepCurl(landmarks);
        
        statusEl.textContent = 'Tracking...';
        statusEl.style.background = 'rgba(0, 255, 0, 0.7)';
    } else {
        statusEl.textContent = 'No person detected';
        statusEl.style.background = 'rgba(255, 0, 0, 0.7)';
    }
    
    canvasCtx.restore();
}

async function startCamera() {
    try {
        if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
            throw new Error('Camera requires HTTPS or localhost');
        }

        videoElement = document.getElementById('video');
        canvasElement = document.getElementById('canvas');
        canvasCtx = canvasElement.getContext('2d');

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Camera not supported by browser');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { 
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            }
        });
        
        videoElement.srcObject = stream;
        
        videoElement.addEventListener('loadedmetadata', () => {
            canvasElement.width = videoElement.videoWidth;
            canvasElement.height = videoElement.videoHeight;
        });

        camera = new Camera(videoElement, {
            onFrame: async () => {
                await pose.send({ image: videoElement });
                await hands.send({ image: videoElement });
            },
            width: 640,
            height: 480
        });
        
        if (videoElement.srcObject) {
            const track = videoElement.srcObject.getVideoTracks()[0];
            if (track && track.getSettings) {
                const settings = track.getSettings();
                track.applyConstraints({
                    frameRate: { ideal: 30, max: 30 }
                }).catch(() => {
                });
            }
        }
        
        camera.start();
        
        startBtn.textContent = 'Camera Running';
        startBtn.disabled = true;
        statusEl.textContent = 'Camera active - Position yourself in frame';
        statusEl.style.background = 'rgba(0, 150, 255, 0.7)';
        isCounting = true;
        
    } catch (error) {
        console.error('Error accessing camera:', error);
        let errorMsg = 'Camera access failed. ';
        
        if (error.name === 'NotAllowedError') {
            errorMsg += 'Please allow camera permissions and refresh the page.';
        } else if (error.name === 'NotFoundError') {
            errorMsg += 'No camera found. Please connect a camera.';
        } else if (error.name === 'NotSupportedError') {
            errorMsg += 'Camera not supported by browser.';
        } else if (error.message.includes('HTTPS')) {
            errorMsg += 'Camera requires HTTPS. Try: https://mahimapaseda.github.io/fittracker-pro';
        } else {
            errorMsg += 'Please check permissions and try again.';
        }
        
        statusEl.textContent = errorMsg;
        statusEl.style.background = 'rgba(255, 0, 0, 0.7)';
        alert(errorMsg);
    }
}

function resetCounter() {
    totalReps = 0;
    
    armTracking.right = {
        state: 'down',
        angleHistory: [],
        minAngle: 180,
        maxAngle: 180,
        lastRepTime: 0,
        hasReachedUp: false,
        hasReachedDown: false
    };
    
    armTracking.left = {
        state: 'down',
        angleHistory: [],
        minAngle: 180,
        maxAngle: 180,
        lastRepTime: 0,
        hasReachedUp: false,
        hasReachedDown: false
    };
    
    totalRepsEl.textContent = '0';
    armAngleEl.textContent = '--';
    armStatusEl.textContent = 'Ready';
    armStatusEl.style.color = '#FFFFFF';
}

function speakCount(count) {
    if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(count.toString());
        
        const voices = speechSynthesis.getVoices();
        const preferredVoice = voices.find(voice => 
            voice.lang.startsWith('en') && voice.localService
        ) || voices[0];
        
        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }
        
        utterance.rate = 0.9;
        utterance.volume = 1.0;
        utterance.pitch = 1.1;
        utterance.lang = 'en-US';
        
        speechSynthesis.speak(utterance);
    }
}

function toggleVoice() {
    voiceEnabled = !voiceEnabled;
    voiceBtn.textContent = voiceEnabled ? 'Voice: ON' : 'Voice: OFF';
    voiceBtn.style.background = voiceEnabled ? 'rgba(0, 255, 0, 0.8)' : '';
}

startBtn.addEventListener('click', startCamera);
resetBtn.addEventListener('click', resetCounter);
voiceBtn.addEventListener('click', toggleVoice);

setInterval(() => {
    if (handBtn) {
        const labels = { none: 'No Hand', right: 'Right Hand', left: 'Left Hand', both: 'Both Hands' };
        handBtn.textContent = labels[activeHand] || 'Auto Detect';
    }
}, 100);

window.addEventListener('load', () => {
    initializePose();
    statusEl.textContent = 'Ready - Click "Start Camera" to begin';
    statusEl.style.background = 'rgba(0, 150, 255, 0.7)';
    
    const modal = document.getElementById('instructionModal');
    const closeBtn = document.querySelector('.close');
    
    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
});