import {
  PoseLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js";

const debug = document.getElementById("debug");
function log(msg) {
  debug.textContent = msg;
  console.log(msg);
}

let video = document.getElementById("video");
let canvas = document.getElementById("output");
let renderer, scene, camera, skeletonLines = [];
let landmarker;

// --------------------------------------------------
// Three.js 初期化
// --------------------------------------------------
function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas });
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 0, 1.2);

  const material = new THREE.LineBasicMaterial({ color: 0x00ffcc });

  for (let i = 0; i < 32; i++) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3()
    ]);
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    skeletonLines.push(line);
  }

  log("Three.js initialized");
}

// --------------------------------------------------
// MediaPipe Pose 初期化
// --------------------------------------------------
async function initPose() {
  log("Loading MediaPipe model...");

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );

  landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/pose_landmarker_lite.task"
    },
    runningMode: "VIDEO",
    numPoses: 1
  });

  log("MediaPipe Pose loaded");
}

// --------------------------------------------------
// カメラ起動
// --------------------------------------------------
async function initCamera() {
  log("Requesting camera access...");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } }
    });

    video.srcObject = stream;

    return new Promise(resolve => {
      video.onloadedmetadata = () => {
        log("Camera ready");
        resolve();
      };
    });
  } catch (e) {
    log("Camera error: " + e.message);
  }
}

// --------------------------------------------------
// MediaPipe の骨格接続
// --------------------------------------------------
const connections = [
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [11, 12],
  [23, 24],
  [11, 23], [12, 24],
  [23, 25], [25, 27], [27, 29],
  [24, 26], [26, 28], [28, 30]
];

// --------------------------------------------------
// メインループ
// --------------------------------------------------
function renderLoop() {
  if (landmarker && video.readyState >= 2) {
    const result = landmarker.detectForVideo(video, performance.now());

    if (result.landmarks && result.landmarks[0]) {
      const lm = result.landmarks[0];

      connections.forEach((pair, i) => {
        const [a, b] = pair;
        const p1 = lm[a];
        const p2 = lm[b];

        const line = skeletonLines[i];
        const pos = line.geometry.attributes.position.array;

        pos[0] = p1.x - 0.5;
        pos[1] = -p1.y + 0.5;
        pos[2] = -p1.z;

        pos[3] = p2.x - 0.5;
        pos[4] = -p2.y + 0.5;
        pos[5] = -p2.z;

        line.geometry.attributes.position.needsUpdate = true;
      });

      debug.textContent =
        `FPS: ${Math.round(1000 / (performance.now() - lastTime))}\n` +
        `Landmarks detected: YES`;
    } else {
      debug.textContent = "Landmarks detected: NO";
    }
  }

  renderer.render(scene, camera);
  lastTime = performance.now();
  requestAnimationFrame(renderLoop);
}

let lastTime = performance.now();

// --------------------------------------------------
// 実行
// --------------------------------------------------
(async () => {
  log("Starting...");
  await initCamera();
  await initPose();
  initThree();
  renderLoop();
})();
