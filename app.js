import {
  PoseLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js";

let video = document.getElementById("video");
let canvas = document.getElementById("output");
let renderer, scene, camera, skeletonLines = [];
let landmarker;

// -----------------------------
// 1. Three.js の初期化
// -----------------------------
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
  camera.position.set(0, 0, 3);

  // 骨格ライン（33点 → 32本）
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
}

// -----------------------------
// 2. MediaPipe Pose の初期化
// -----------------------------
async function initPose() {
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
}

// -----------------------------
// 3. カメラ起動
// -----------------------------
async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" }
  });
  video.srcObject = stream;

  return new Promise(resolve => {
    video.onloadedmetadata = () => resolve();
  });
}

// -----------------------------
// 4. 骨格ラインの接続定義（MediaPipeの33点）
// -----------------------------
const connections = [
  [11, 13], [13, 15], // 左腕
  [12, 14], [14, 16], // 右腕
  [11, 12],           // 肩
  [23, 24],           // 腰
  [11, 23], [12, 24], // 体幹
  [23, 25], [25, 27], [27, 29], // 左脚
  [24, 26], [26, 28], [28, 30]  // 右脚
];

// -----------------------------
// 5. メインループ（推論＋描画）
// -----------------------------
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
        const positions = line.geometry.attributes.position.array;

        positions[0] = p1.x - 0.5;
        positions[1] = -p1.y + 0.5;
        positions[2] = -p1.z;

        positions[3] = p2.x - 0.5;
        positions[4] = -p2.y + 0.5;
        positions[5] = -p2.z;

        line.geometry.attributes.position.needsUpdate = true;
      });
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(renderLoop);
}

// -----------------------------
// 6. 実行
// -----------------------------
(async () => {
  await initCamera();
  await initPose();
  initThree();
  renderLoop();
})();
