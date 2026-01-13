console.log("app.js is running!");
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.0";

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.160/examples/jsm/controls/OrbitControls.js";

const debug = document.getElementById("debug");
function log(msg) {
  debug.textContent = msg;
  console.log(msg);
}

let video = document.getElementById("video");
let canvas = document.getElementById("output");
let renderer, scene, camera, controls;
let skeletonLines = [];
let landmarker;

let lastFootPos = null;
let lastTime = null;
let trailPoints = [];
let trailLine;

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
  camera.position.set(0, 0, 1.5);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

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

  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([], 3)
  );
  trailLine = new THREE.Line(
    trailGeometry,
    new THREE.LineBasicMaterial({ color: 0xff0000 })
  );
  scene.add(trailLine);

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
// 動画ファイル読み込み
// --------------------------------------------------
document.getElementById("fileInput").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  video.src = url;

  log("Video loaded: " + file.name);

  video.onloadeddata = () => {
    log("Video ready. Tap screen to start.");

    document.body.addEventListener("click", () => {
      video.play();
      log("Video playing");
    }, { once: true });
  };
});

video.addEventListener("loadeddata", () => {
  log("Video ready. Tap screen to start.");
  // タップイベントを強制的にトリガーするための補助関数を追加
  const startVideo = () => {
    video.play().catch(e => {
      console.error("Error playing video:", e);
      log("Error playing video. Please try again.");
    });
    log("Video playing");
  };

  // タップイベントを登録
  document.body.addEventListener("click", startVideo, { once: true });

  // タップイベントが動作しない場合、自動再生を試みる
  setTimeout(() => {
    startVideo();
  }, 1000);
});

// --------------------------------------------------
// 骨格接続
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
  controls.update();

  if (landmarker && video.readyState >= 2) {
    const now = performance.now();
    const result = landmarker.detectForVideo(video, now);

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

      const foot = lm[28];
      const footPos = new THREE.Vector3(
        foot.x - 0.5,
        -foot.y + 0.5,
        -foot.z
      );

      trailPoints.push(footPos.clone());
      if (trailPoints.length > 200) trailPoints.shift();

      const trailArray = [];
      trailPoints.forEach(p => {
        trailArray.push(p.x, p.y, p.z);
      });

      trailLine.geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(trailArray, 3)
      );
      trailLine.geometry.attributes.position.needsUpdate = true;

      let speed = 0;
      if (lastFootPos && lastTime) {
        const dt = (now - lastTime) / 1000;
        speed = footPos.distanceTo(lastFootPos) / dt;
      }

      lastFootPos = footPos.clone();
      lastTime = now;

      debug.textContent =
        `FPS: ${Math.round(1000 / (performance.now() - now))}\n` +
        `Foot speed: ${speed.toFixed(3)} m/s\n` +
        `Trail points: ${trailPoints.length}\n` +
        `readyState: ${video.readyState}\n` +
        `currentTime: ${video.currentTime.toFixed(3)}\n` +
        `paused: ${video.paused}\n` +
        `video.ended: ${video.ended}\n` +
        `video.error: ${video.error}`;
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(renderLoop);
}

// --------------------------------------------------
// 実行
// --------------------------------------------------
(async () => {
  log("Starting...");
  await initPose();
  initThree();

  // メインループを開始する前に、ビデオの準備を待つ
  video.addEventListener("loadeddata", () => {
    log("Video loaded. Starting render loop...");
    renderLoop();
  });
})();


