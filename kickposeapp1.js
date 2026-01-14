import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  PoseLandmarker,
  FilesetResolver
} from "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.0";

const video = document.getElementById("video");
const canvas = document.getElementById("output");
const container = document.getElementById("container");
const slider = document.getElementById("slider");
const fileInput = document.getElementById("fileInput");
const cameraBtn = document.getElementById("cameraBtn");
const videoBtn = document.getElementById("videoBtn");
const debug = document.getElementById("debug");

let poseLandmarker;
let scene, camera, renderer, controls;
let orthoCamera;
let perspectiveCamera;
let activeCamera;

let skeletonLines = [];
let trailPoints = [];
let trailLine;
let lastFootPos = null;
let lastTime = null;

let leftTrailPoints = [];
let rightTrailPoints = [];

let leftTrailLine;
let rightTrailLine;

let isPoseRotating3D = false;
let currentMode = "video";

function videoDimensions(video) {
  var videoRatio = video.videoWidth / video.videoHeight;
  var width = video.offsetWidth, height = video.offsetHeight;
  var elementRatio = width/height;
  // If the video element is short and wide
  if(elementRatio > videoRatio) width = height * videoRatio;
  // It must be tall and thin, or exactly equal to the original ratio
  else height = width / videoRatio;
  return {
    width: width,
    height: height
  };
}


/* -----------------------------
   レイアウト切り替え
------------------------------ */
function updateLayout() {
  const screenIsPortrait = window.innerHeight > window.innerWidth;
  const videoIsPortrait = video.videoHeight > video.videoWidth;

  if (screenIsPortrait === videoIsPortrait) {
    if (isPoseRotating3D) {
      container.className = "small-video";
      return;
    } else {
      container.className = "overlay";
    }
  } else {
    container.className = screenIsPortrait
      ? "vertical-split"
      : "horizontal-split";
  }
}

window.addEventListener("resize", updateLayout);

/* -----------------------------
   Three.js 初期化
------------------------------ */
function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene = new THREE.Scene();
  perspectiveCamera  = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
  ); /* */
  perspectiveCamera.position.set(0, 0, 300);
  activeCamera = perspectiveCamera; // 初期はどちらでもOK

  controls = new OrbitControls(activeCamera, renderer.domElement);
  controls.enableDamping = true;

  controls.addEventListener("start", () => {
    isPoseRotating3D = true;
    activeCamera = perspectiveCamera;
    updateLayout();
  });

  /* controls.addEventListener("end", () => {
    isPoseRotating3D = false;
    updateLayout();
  }); */ // 終了時は何もしない 

  /* 骨格ライン生成 */
  const connections = [
    [7, 0], [0, 8],
    [11, 13], [13, 15],[15.19],
    [12, 14], [14, 16],[16,20],
    [11, 12],
    [23, 24],
    [11, 23], [12, 24],
    [23, 25], [25, 27], [27, 29], [29.31],
    [24, 26], [26, 28], [28, 30], [30,32],
  ];

  connections.forEach(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)
    );
    const material = new THREE.LineBasicMaterial({ color: 0xffff00 });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    skeletonLines.push(line);
  });

  /* 足の軌跡ライン */
  const trailGeometry = new THREE.BufferGeometry();
  trailLine = new THREE.Line(
    trailGeometry,
    new THREE.LineBasicMaterial({ color: 0xff0000 })
  );
  scene.add(trailLine);
  // 左足の軌跡（赤）
  const leftTrailGeometry = new THREE.BufferGeometry();
  leftTrailLine = new THREE.Line(
    leftTrailGeometry,
    new THREE.LineBasicMaterial({ color: 0xff0000 })
  );
  scene.add(leftTrailLine);

  // 右足の軌跡（青）
  const rightTrailGeometry = new THREE.BufferGeometry();
  rightTrailLine = new THREE.Line(
    rightTrailGeometry,
    new THREE.LineBasicMaterial({ color: 0x0000ff })
  );
  scene.add(rightTrailLine);
}
/* */
function setupCameraForVideo() {
  const w = video.videoWidth;
  const h = video.videoHeight;
  orthoCamera = new THREE.OrthographicCamera(
    0, w,
    h, 0,
    -1000, 1000
  );
  activeCamera = orthoCamera;
}

/* -----------------------------
   MediaPipe 初期化
------------------------------ */
async function initPose() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
  );

  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
        //"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numPoses: 1
  });

  startVideoFile();
}

/* -----------------------------
   動画ファイルモード
------------------------------ */
function startVideoFile() {
  currentMode = "video";

  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }

  fileInput.onchange = () => {
    const file = fileInput.files[0];
    if (!file) return;
    // ★ 3D 回転状態をリセット
    isPoseRotating3D = false;
    controls.reset();
    updateLayout();

    video.src = URL.createObjectURL(file);

    video.onloadedmetadata = () => {
      setupCameraForVideo();
      renderer.setSize(video.videoWidth, video.videoHeight);
      activeCamera = orthoCamera; 
      //camera.position.set(0, 0, 300);
      //camera.lookAt(0, 0, 0);
      video.play().then(updateLayout);
    };
  };
}

/* -----------------------------
   カメラモード
------------------------------ */
async function startCamera() {
  currentMode = "camera";

  video.src = "";
  video.srcObject = null;

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false
  });

  video.srcObject = stream;

  video.onloadedmetadata = () => {
    video.play().then(updateLayout);
  };
}

/* -----------------------------
   統合 renderLoop
------------------------------ */
function renderLoop() {
  controls.update();

  var videoRatio = video.videoWidth / video.videoHeight;
  var dispwidth = video.offsetWidth, dispheight = video.offsetHeight;
  var elementRatio = dispwidth/dispheight;
  const ofseth = (video.offsetHeight - dispheight) / 2
  // If the video element is short and wide
  if(elementRatio > videoRatio) dispwidth = dispheight * videoRatio;
  // It must be tall and thin, or exactly equal to the original ratio
  else dispheight = dispwidth / videoRatio;

  if (poseLandmarker && video.readyState >= 2) {
    const now = performance.now();
    const result = poseLandmarker.detectForVideo(video, now);

    if (result.landmarks && result.landmarks[0]) {
      const lm = result.landmarks[0];

      const left = [11, 13, 15, 19, 23, 25, 27, 29, 31];
      const right = [12, 14, 16, 20, 24, 26, 28, 30, 32];

      const connections = [
        [7, 0], [0, 8],
        [11, 13], [13, 15], [15, 19],
        [12, 14], [14, 16], [16, 20],
        [11, 12],
        [23, 24],
        [11, 23], [12, 24],
        [23, 25], [25, 27], [27, 29], [29, 31],
        [24, 26], [26, 28], [28, 30], [30, 32]
      ];

      connections.forEach((pair, i) => {
        const [a, b] = pair;
        const p1 = lm[a];
        const p2 = lm[b];

        const line = skeletonLines[i];
        const pos = line.geometry.attributes.position.array;

        if (isPoseRotating3D) {
          // ★ 3D 表示用（PerspectiveCamera）
          const SCALE = 200;

          pos[0] = (p1.x - 0.5) * SCALE;
          pos[1] = (-p1.y + 0.5) * SCALE;
          pos[2] = -p1.z * SCALE;

          pos[3] = (p2.x - 0.5) * SCALE;
          pos[4] = (-p2.y + 0.5) * SCALE;
          pos[5] = -p2.z * SCALE;

        } else {
          // ★ 2D オーバーレイ用（OrthographicCamera）
          const x1 = p1.x * dispwidth;
          const y1 = p1.y * dispheight;
          const x2 = p2.x * dispwidth;
          const y2 = p2.y * dispheight;
          pos[0] = x1;
          pos[1] = ofseth + dispheight - y1;
          pos[2] = 0;

          pos[3] = x2;
          pos[4] = ofseth + dispheight - y2;
          pos[5] = 0;
        }
        
        if (left.includes(a)) line.material.color.set(0xffff00);
        else if (right.includes(a)) line.material.color.set(0x00ffff);

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
      trailPoints.forEach(p => trailArray.push(p.x, p.y, p.z));

      trailLine.geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(trailArray, 3)
      );
      trailLine.geometry.attributes.position.needsUpdate = true;

      // 左右のつま先ランドマーク
      const leftFoot = lm[31];
      const rightFoot = lm[32];

      let leftPos, rightPos;

      if (isPoseRotating3D) {
        // ★ 3D 表示用
        const SCALE = 200;

        leftPos = new THREE.Vector3(
          (leftFoot.x - 0.5) * SCALE,
          (-leftFoot.y + 0.5) * SCALE,
          -leftFoot.z * SCALE
        );

        rightPos = new THREE.Vector3(
          (rightFoot.x - 0.5) * SCALE,
          (-rightFoot.y + 0.5) * SCALE,
          -rightFoot.z * SCALE
        );

      } else {
        // ★ 2D オーバーレイ用
        const lx = leftFoot.x * dispwidth;
        const ly = ofseth + dispheight - leftFoot.y * dispheight;

        const rx = rightFoot.x * dispwidth;
        const ry = ofseth + dispheight - rightFoot.y * dispheight;

        leftPos = new THREE.Vector3(lx, ly, 0);
        rightPos = new THREE.Vector3(rx, ry, 0);
      }

      // ★ 軌跡に追加
      leftTrailPoints.push(leftPos.clone());
      rightTrailPoints.push(rightPos.clone());

      if (leftTrailPoints.length > 200) leftTrailPoints.shift();
      if (rightTrailPoints.length > 200) rightTrailPoints.shift();

      // ★ 左足ライン更新
      const leftArray = [];
      leftTrailPoints.forEach(p => leftArray.push(p.x, p.y, p.z));
      leftTrailLine.geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(leftArray,3)
      );
      leftTrailLine.geometry.attributes.position.needsUpdate = true;

      // ★ 右足ライン更新
      const rightArray = [];
      rightTrailPoints.forEach(p => rightArray.push(p.x, p.y, p.z));
      rightTrailLine.geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(rightArray, 3)
      );
      rightTrailLine.geometry.attributes.position.needsUpdate = true;

      let speedVal = 0;
      if (lastFootPos && lastTime) {
        const dt = (now - lastTime) / 1000;
        speedVal = footPos.distanceTo(lastFootPos) / dt;
      }

      lastFootPos = footPos.clone();
      lastTime = now;

      debug.textContent =
        `FPS: ${Math.round(1000 / (performance.now() - now))}\n` +
        `Foot speed: ${speedVal.toFixed(3)} m/s\n` +
        `Trail points: ${trailPoints.length}\n` +
        `Speed: ${video.playbackRate.toFixed(1)}x\n` +
        `Time: ${video.currentTime.toFixed(2)} / ${video.duration.toFixed(2)}\n`+ 
        `container: ${container.className}\n` + 
        `videooffsize: ${video.offsetWidth} ${video.offsetHeight}\n`+
        `videoinsize: ${dispwidth} ${dispheight}`;
    }
  }

  renderer.render(scene, activeCamera);
  requestAnimationFrame(renderLoop);
}

/* -----------------------------
   UI
------------------------------ */
cameraBtn.onclick = () => startCamera();
videoBtn.onclick = () => {
  isPoseRotating3D = false;   // ★ 3D 回転状態をリセット
  activeCamera = orthoCamera;   // ★ カメラをオーバーレイ用に戻す
  controls.reset();   // ★ OrbitControls を初期化
  updateLayout();   // ★ small-video を解除
  startVideoFile();   // ★ 動画モードに戻す
};

slider.oninput = () => {
  video.playbackRate = slider.value / 50;
};

/* -----------------------------
   起動
------------------------------ */
async function main() {
  initThree();
  await initPose();
  renderLoop();
}

main();