import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

import {
  PoseLandmarker,
  FilesetResolver
} from "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.0";

const video = document.getElementById("video");
const canvas = document.getElementById("output");
const container = document.getElementById("container");
const fileInput = document.getElementById("fileInput");
const cameraBtn = document.getElementById("cameraBtn");
const videoBtn = document.getElementById("videoBtn");
const debug = document.getElementById("debug");

const playPauseBtn = document.getElementById("playPauseBtn");
const seekBar = document.getElementById("seekBar");
const speedBar = document.getElementById("speedBar");
const speedLabel = document.getElementById("speedLabel");

const statusElement = document.getElementById('loading-status');

let persons = [];
const MAX_PERSONS = 5;

let poseLandmarker;
let currentNumPoses = 1;  // 初期値
let scene, renderer, controls;
let orthoCamera;
let perspectiveCamera;
let activeCamera;

let isPoseRotating3D = false;
let currentMode = "video";

// パフォーマンス最適化用
let isIOS = false;
let isMobile = false;
let cachedDisplayW = 0;
let cachedDisplayH = 0;
let cachedOfseth = 0;
let lastDebugUpdate = 0;
const DEBUG_UPDATE_INTERVAL = 100; // デバッグ表示は200msごとに更新

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

class Person {
  constructor(scene, id) {
    this.scene = scene;
    this.id = id;
    this.skeletonLines = [];
    this.filteredLm1 = null;
    this.filteredLm2 = null;
    this.demalm = null;

    // 世界座標（速度計算用）
    this.worldFilteredLm1 = null;
    this.worldFilteredLm2 = null;
    this.worldDemalm = null;

    // 足の速度計用
    this.lastLeftPos = null;
    this.lastRightPos = null;
    this.t1 = null;
    this.t2 = null;
    this.prevT = null;
    this.speedVal = 0;
    this.footSpeedMax = 0;

    // 軌跡用
    this.leftTrailPoints = [];
    this.rightTrailPoints = [];
    this.leftTrailLine = null;
    this.rightTrailLine = null;

    this.positionsArray = new Float32Array(connections.length * 6);
    this.initThreeObjects();
  }

  initThreeObjects() {
    const left = [13, 15, 19, 25, 27, 29, 31];
    const right = [14, 16, 20, 26, 28, 30, 32];

    connections.forEach((pair) => {
      const [a, b] = pair;
      let color = 0xffff00; // 胴体

      if (left.includes(a) || left.includes(b)) color = 0xffaa00;
      if (right.includes(a) || right.includes(b)) color = 0x00ffff;

      const material = new LineMaterial({
        color: color,
        linewidth: 3.0,
        resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
      });

      const geometry = new LineGeometry();
      const line = new Line2(geometry, material);
      line.visible = false;

      this.scene.add(line);
      this.skeletonLines.push(line);
    });

    // 左足の軌跡
    const leftTrailGeometry = new THREE.BufferGeometry();
    this.leftTrailLine = new THREE.Line(
      leftTrailGeometry,
      new THREE.LineBasicMaterial({ color: 0xff0000 })
    );
    this.leftTrailLine.visible = false;
    this.scene.add(this.leftTrailLine);

    // 右足の軌跡
    const rightTrailGeometry = new THREE.BufferGeometry();
    this.rightTrailLine = new THREE.Line(
      rightTrailGeometry,
      new THREE.LineBasicMaterial({ color: 0x0000ff })
    );
    this.rightTrailLine.visible = false;
    this.scene.add(this.rightTrailLine);
  }

  updatePoseLandmarks(lm, alpha, prefix = "") {
    const f1 = prefix ? prefix + "FilteredLm1" : "filteredLm1";
    const f2 = prefix ? prefix + "FilteredLm2" : "filteredLm2";
    const dm = prefix ? prefix + "Demalm" : "demalm";

    if (!this[f1]) {
      this[f1] = lm.map(p => ({ x: p.x, y: p.y, z: p.z }));
      this[f2] = lm.map(p => ({ x: p.x, y: p.y, z: p.z }));
      this[dm] = lm.map(p => ({ x: p.x, y: p.y, z: p.z }));
      return;
    }

    for (let i = 0; i < lm.length; i++) {
      const { ema1, ema2, dema } = demaVec(this[f1][i], this[f2][i], lm[i], alpha);
      this[f1][i] = ema1;
      this[f2][i] = ema2;
      this[dm][i] = dema;
    }
  }

  update(landmarks, worldLandmarks, is3D, displayW, displayH, ofseth, center, scale, currentTime, xofset = 0.5) {
    this.setVisible(true);

    const playbackRate = video.playbackRate;
    const baseTau = 0.005;
    const tau = baseTau / playbackRate;
    const dt_mp = 1 / 30;
    let alpha = dt_mp / tau;
    const xshift = currentNumPoses > 1 ? (xofset - 0.5) * 500 : 0;
    if (alpha > 1) alpha = 1;

    // 表示用データのフィルタリング
    if (is3D && worldLandmarks) {
      this.updatePoseLandmarks(worldLandmarks, alpha);
      this.worldFilteredLm1 = this.filteredLm1;
      this.worldFilteredLm2 = this.filteredLm2;
      this.worldDemalm = this.demalm;
    } else {
      this.updatePoseLandmarks(landmarks, alpha);
      // 速度計算用（世界座標）のフィルタリング - 常に実行
      if (worldLandmarks) {
        this.updatePoseLandmarks(worldLandmarks, alpha, "world");
      }
    }

    if (!this.demalm) return;

    // 線データの作成
    connections.forEach((pair, i) => {
      const [a, b] = pair;
      const lmA = this.demalm[a];
      const lmB = this.demalm[b];
      if (!lmA || !lmB) return;

      const baseIdx = i * 6;
      if (is3D) {
        this.positionsArray[baseIdx + 0] = (lmA.x - center) * scale + xshift;
        this.positionsArray[baseIdx + 1] = (-lmA.y + center) * scale;
        this.positionsArray[baseIdx + 2] = -lmA.z * scale;
        this.positionsArray[baseIdx + 3] = (lmB.x - center) * scale + xshift;
        this.positionsArray[baseIdx + 4] = (-lmB.y + center) * scale;
        this.positionsArray[baseIdx + 5] = -lmB.z * scale;
      } else {
        this.positionsArray[baseIdx + 0] = lmA.x * displayW;
        this.positionsArray[baseIdx + 1] = (1 - lmA.y) * displayH + ofseth;
        this.positionsArray[baseIdx + 2] = 0;
        this.positionsArray[baseIdx + 3] = lmB.x * displayW;
        this.positionsArray[baseIdx + 4] = (1 - lmB.y) * displayH + ofseth;
        this.positionsArray[baseIdx + 5] = 0;
      }
    });

    // 線の更新
    this.skeletonLines.forEach((line, i) => {
      const start = i * 6;
      line.geometry.setPositions(this.positionsArray.subarray(start, start + 6));
      line.geometry.attributes.position.needsUpdate = true;
    });

    // 足の速度計算 (常に世界座標を使用)
    if (this.worldDemalm) {
      const leftFoot = this.worldDemalm[31];
      const rightFoot = this.worldDemalm[32];
      const WORLD_CENTER = 0.0; // 世界座標の中心は 0

      const leftPos = new THREE.Vector3((leftFoot.x - WORLD_CENTER), (-leftFoot.y + WORLD_CENTER), -leftFoot.z);
      const rightPos = new THREE.Vector3((rightFoot.x - WORLD_CENTER), (-rightFoot.y + WORLD_CENTER), -rightFoot.z);

      const { y1, y2 } = lowpass2s(this.t1, this.t2, currentTime, 0.03);
      this.t1 = y1; this.t2 = y2;

      let dt = 0;
      if (this.prevT != null) {
        if (y2 < this.prevT - 0.1) {
          this.prevT = y2;
        } else {
          dt = y2 - this.prevT;
          this.prevT = y2;
        }
      } else {
        this.prevT = y2;
      }

      if (this.lastLeftPos && dt > 1e-3) {
        const speedvalprev = this.speedVal;
        const currentSpeed = Math.max(leftPos.distanceTo(this.lastLeftPos), rightPos.distanceTo(this.lastRightPos)) / dt;
        this.speedVal = ema(speedvalprev, currentSpeed, 0.5);
      }
      if (worldLandmarks && currentTime > 0.05) {
        this.footSpeedMax = Math.max(this.footSpeedMax, this.speedVal);
      }
      this.lastLeftPos = leftPos.clone();
      this.lastRightPos = rightPos.clone();

      // 軌跡の更新
      let trailLeft, trailRight;
      if (is3D) {
        trailLeft = leftPos.clone().multiplyScalar(scale);
        trailLeft.x += xshift;
        trailRight = rightPos.clone().multiplyScalar(scale);
        trailRight.x += xshift;
      } else {
        trailLeft = new THREE.Vector3(this.demalm[31].x * displayW, ofseth + (1 - this.demalm[31].y) * displayH, 0);
        trailRight = new THREE.Vector3(this.demalm[32].x * displayW, ofseth + (1 - this.demalm[32].y) * displayH, 0);
      }

      this.leftTrailPoints.push(trailLeft);
      this.rightTrailPoints.push(trailRight);
      if (this.leftTrailPoints.length > 60) this.leftTrailPoints.shift();
      if (this.rightTrailPoints.length > 60) this.rightTrailPoints.shift();

      const leftArray = [];
      this.leftTrailPoints.forEach(p => leftArray.push(p.x, p.y, p.z));
      this.leftTrailLine.geometry.setAttribute("position", new THREE.Float32BufferAttribute(leftArray, 3));
      this.leftTrailLine.geometry.attributes.position.needsUpdate = true;

      const rightArray = [];
      this.rightTrailPoints.forEach(p => rightArray.push(p.x, p.y, p.z));
      this.rightTrailLine.geometry.setAttribute("position", new THREE.Float32BufferAttribute(rightArray, 3));
      this.rightTrailLine.geometry.attributes.position.needsUpdate = true;
    }
  }

  setVisible(visible) {
    this.skeletonLines.forEach(l => l.visible = visible);
    this.leftTrailLine.visible = visible;
    this.rightTrailLine.visible = visible;
  }

  reset() {
    this.filteredLm1 = null;
    this.filteredLm2 = null;
    this.demalm = null;
    this.worldFilteredLm1 = null;
    this.worldFilteredLm2 = null;
    this.worldDemalm = null;
    this.lastLeftPos = null;
    this.lastRightPos = null;
    this.t1 = null;
    this.t2 = null;
    this.prevT = null;
    this.speedVal = 0;
    this.footSpeedMax = 0;
    this.leftTrailPoints = [];
    this.rightTrailPoints = [];
    // 軌跡をクリアするためにダミーの空属性をセット
    this.leftTrailLine.geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
    this.rightTrailLine.geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
    this.setVisible(false);
  }
}
/* 
   utility functions 
*/
function setStatus(msg) {
  if (statusElement) {
    statusElement.textContent = msg;
  }
  console.log("[STATUS]", msg);
}

function lowpass2(prev1, prev2, next, alpha = 0.25) {
  const y1 = {
    x: prev1 ? prev1.x * (1 - alpha) + next.x * alpha : next.x,
    y: prev1 ? prev1.y * (1 - alpha) + next.y * alpha : next.y,
    z: prev1 ? prev1.z * (1 - alpha) + next.z * alpha : next.z,
  };
  const y2 = {
    x: prev2 ? prev2.x * (1 - alpha) + y1.x * alpha : y1.x,
    y: prev2 ? prev2.y * (1 - alpha) + y1.y * alpha : y1.y,
    z: prev2 ? prev2.z * (1 - alpha) + y1.z * alpha : y1.z,
  };
  return { y1, y2 };
}

function lowpass2s(prev1, prev2, next, tau = 0.015) {
  const tauplayback = tau / video.playbackRate;
  const dt = 1 / 30;
  let alpha = dt / tauplayback;
  if (alpha > 1) alpha = 1;
  const y1 = prev1 != null ? prev1 * (1 - alpha) + next * alpha : next;
  const y2 = prev2 != null ? prev2 * (1 - alpha) + y1 * alpha : y1;
  return { y1, y2 };
}

function ema(prev, x, alpha = 0.3) {
  return prev != null ? prev * (1 - alpha) + x * alpha : x;
}

function dema(prevEma1, prevEma2, x, alpha) {
  const ema1 = ema(prevEma1, x, alpha);
  const ema2 = ema(prevEma2, ema1, alpha);
  const demaValue = 2 * ema1 - ema2;

  return { ema1, ema2, dema: demaValue };
}

function emaVec(prev, v, alpha) {
  if (!prev) return { x: v.x, y: v.y, z: v.z };

  return {
    x: prev.x * (1 - alpha) + v.x * alpha,
    y: prev.y * (1 - alpha) + v.y * alpha,
    z: prev.z * (1 - alpha) + v.z * alpha,
  };
}

function demaVec(prevEma1, prevEma2, v, alpha = 0.2) {
  // 1段目 EMA
  const ema1 = emaVec(prevEma1, v, alpha);
  // 2段目 EMA（ema1 をもう一度 EMA）
  const ema2 = emaVec(prevEma2, ema1, alpha);
  // DEMA = 2 * EMA1 - EMA2
  const dema = {
    x: 2 * ema1.x - ema2.x,
    y: 2 * ema1.y - ema2.y,
    z: 2 * ema1.z - ema2.z,
  };

  return { ema1, ema2, dema };
}

/* -----------------------------
   レイアウト切り替え
------------------------------ */
/* DEFAULT OVERRAY CAMERA */
function setupCameraForVideo() {
  // iPhone Safari 判定
  //renderer.setSize(window.innerWidth, window.innerHeight);
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const videoRect = video.getBoundingClientRect();
  if (isIOS) {
    var w = videoRect.width;
    var h = videoRect.height;
  } else {
    var w = video.videoWidth;
    var h = video.videoHeight;
  }
  orthoCamera = new THREE.OrthographicCamera(
    0, w,
    h, 0,
    -1000, 1000
  );
  orthoCamera.updateProjectionMatrix();
  activeCamera = orthoCamera;
}

function updateLayout() {
  const screenIsPortrait = window.innerHeight > window.innerWidth;
  const videoIsPortrait = video.videoHeight > video.videoWidth;

  if (screenIsPortrait === videoIsPortrait) {
    if (isPoseRotating3D && currentMode == "video") {
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
  if (!isPoseRotating3D && orthoCamera && video.videoWidth > 0) {
    setupCameraForVideo();
  }

  // 全員の解像度を更新
  persons.forEach(p => {
    p.skeletonLines.forEach(l => {
      l.material.resolution.set(renderer.domElement.width, renderer.domElement.height);
    });
  });
}

window.addEventListener("resize", () => {
  updateLayout();
  updateDisplayCache();
});

// ウィンドウサイズ変更時の処理
window.addEventListener('resize', () => {
  if (currentMode === "camera") {
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
});

// ビデオのメタデータ読み込み時にもキャッシュ更新
video.addEventListener('loadedmetadata', updateDisplayCache);

/* -----------------------------
   Three.js 初期化
------------------------------ */
let camyfromgrid;
let endcontrol = true;

/* -----------------------------
   デバイス検出
------------------------------ */
function detectDevice() {
  isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  isMobile = /Android|iPhone|iPad|iPod/.test(navigator.userAgent);

  console.log(`Device: ${isMobile ? 'Mobile' : 'Desktop'}, iOS: ${isIOS}`);
}

/* -----------------------------
   表示サイズのキャッシュ更新
------------------------------ */
function updateDisplayCache() {
  const videoRect = video.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  cachedOfseth = videoRect.top - containerRect.top;

  if (isIOS) {
    cachedDisplayW = videoRect.width;
    cachedDisplayH = videoRect.height;
  } else {
    cachedDisplayW = video.videoWidth;
    cachedDisplayH = video.videoHeight;
  }
}

/* -----------------------------
   Three.js 初期化
------------------------------ */
function initThree() {
  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: !isMobile, // モバイルではアンチエイリアスを無効化
    powerPreference: isMobile ? 'low-power' : 'high-performance'
  });

  // モバイルではピクセル比を制限してパフォーマンス向上
  const pixelRatio = isMobile ? Math.min(window.devicePixelRatio, 1.5) : window.devicePixelRatio;
  renderer.setPixelRatio(pixelRatio);

  scene = new THREE.Scene();
  perspectiveCamera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.01,
    2000
  ); /* */
  perspectiveCamera.position.set(0, 0, 300);
  perspectiveCamera.updateProjectionMatrix()
  activeCamera = perspectiveCamera; // 初期はどちらでもOK

  controls = new OrbitControls(activeCamera, renderer.domElement);
  controls.enableDamping = true;

  controls.addEventListener("start", () => {
    if (currentMode == 'video') {
      endcontrol = false
      isPoseRotating3D = true;
      controls.target.set(0, 0, 0);
      controls.update();
      //perspectiveCamera.updateProjectionMatrix()
      // lookat(0,0,0);
      activeCamera = perspectiveCamera;
      gridHelper.visible = true;
      axesHelper.visible = true;
      updateLayout();
    }
  });

  controls.addEventListener("end", () => {
    camyfromgrid = perspectiveCamera.position.y - gridHelper.position.y;
    endcontrol = true;
    //console.log(`endcontrol cam.y: ${camyfromgrid} ${perspectiveCamera.position.y} ${gridHelper.position.y}`);
    //isPoseRotating3D = false;
    //updateLayout();
    //console.log(`Left foot Z: ${gridHelper.position}`);
  });

  /* 複数人分のスケルトンを初期化 */
  for (let i = 0; i < MAX_PERSONS; i++) {
    persons.push(new Person(scene, i));
  }

  // === 3D 用の地平面と XYZ 軸 ===
  const grid = new THREE.GridHelper(1000, 20, 0x444444, 0x888888);
  grid.visible = false; // 初期状態は非表示（2D のため）
  scene.add(grid);

  const axes = new THREE.AxesHelper(200);
  axes.visible = false; // 初期状態は非表示
  scene.add(axes);

  // 後で参照できるようにグローバルへ
  window.gridHelper = grid;
  window.axesHelper = axes;
}

/* -----------------------------
   MediaPipe 初期化
------------------------------ */
async function initPose(numPoses = 1) {
  currentNumPoses = numPoses;
  const vision = await FilesetResolver.forVisionTasks(
    //"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
  );

  var modelurl = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"
  if (numPoses == 1) {
    modelurl = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"
    // modelurl = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task"
  } else {
    modelurl = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
    console.log(`numPoses: ${numPoses}`);
  }
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: modelurl,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: numPoses
  })
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

  // もし既に video.src がある場合は再生を試みる（Resetボタン対応）
  if (video.src) {
    video.play().then(updateLayout).catch(e => console.error("Auto-play failed:", e));
    persons.forEach(p => p.reset());
    playPauseBtn.textContent = "⏸";
  }

  fileInput.onchange = () => {
    setStatus("Loading Movie file...");
    const file = fileInput.files[0];
    if (!file) return;

    // カメラが動いていたら停止
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }

    currentMode = "video";
    isPoseRotating3D = false;
    controls.reset();
    updateLayout();

    video.src = URL.createObjectURL(file);

    video.onloadedmetadata = () => {
      renderer.setSize(video.videoWidth, video.videoHeight, false);
      setupCameraForVideo();
      activeCamera = orthoCamera;
      updateDisplayCache(); // キャッシュを更新
      video.play().then(updateLayout).catch(e => console.error("Play error:", e));
      persons.forEach(p => p.reset());
      playPauseBtn.textContent = "⏸";
      speedBar.value = 1.0;
      video.playbackRate = 1.0;
    };
  };
}

/* -----------------------------
   カメラモード
------------------------------ */
let stream = null;
let mediaRecorder;
let recordedChunks = [];
async function startCamera() {
  currentMode = "camera";
  video.src = "";
  video.srcObject = null;

  const newStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      frameRate: { ideal: 60, max: 60 },
    },
    audio: false
  });

  persons.forEach(p => p.reset());

  isPoseRotating3D = false;
  controls.reset();

  stream = newStream;
  video.srcObject = stream;

  // カメラモードで全画面表示にするための設定
  video.style.width = "100%";
  video.style.height = "100%";
  video.style.objectFit = "cover";
  if (!poseLandmarker) {
    setStatus("Loading MediaPipe libs..");
    await initPose(currentNumPoses);
  }

  video.onloadedmetadata = () => {
    // レンダラーのサイズを画面全体に設定
    renderer.setSize(window.innerWidth, window.innerHeight);
    setupCameraForVideo();
    activeCamera = orthoCamera;
    updateDisplayCache();
    video.play().then(() => {
      updateLayout()
      renderLoop();
    });
  };

  if (stream) {
    playPauseBtn.textContent = "🔴";
  }
}
/* 録画開始停止 */
function startRecording() {
  if (!stream) {
    setStatus("録画はカメラモードでのみ可能です");
    return;
  }

  const types = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4' // Safariなどで有効な場合がある
  ];

  recordedChunks = [];
  let selectedType = '';
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      selectedType = type;
      break;
    }
  }
  if (selectedType) {
    mediaRecorder = new MediaRecorder(stream, { mimeType: selectedType });
  } else {
    console.error("対応している形式が見つかりません");
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.start();
  playPauseBtn.textContent = "⏹";
  console.log("録画開始");
}

function stopRecording() {
  if (!mediaRecorder) {
    setStatus("録画は開始されていません");
    return;
  }
  mediaRecorder.stop();
  playPauseBtn.textContent = "🔴";
  console.log("録画終了");

  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "recorded_" + new Date().toISOString().replace(/[:.]/g, '-') + ".webm";
    a.click();
    URL.revokeObjectURL(url);
    mediaRecorder = null;
    recordedChunks = [];
  };
}

/* -----------------------------
   統合 renderLoop
------------------------------ */
function renderLoop(timestamp) {
  controls.update();

  // キャッシュされた表示サイズを使用（パフォーマンス向上）
  const displayW = cachedDisplayW || video.videoWidth;
  const displayH = cachedDisplayH || video.videoHeight;
  const ofseth = cachedOfseth;

  if (poseLandmarker && video.readyState >= 2) {
    if (statusElement && statusElement.style.display != 'none') {
      setStatus("");
      statusElement.style.display = 'none';
    }
    const now = performance.now();
    const result = poseLandmarker.detectForVideo(video, now);

    // 全員を一旦非表示にする
    persons.forEach(p => p.setVisible(false));

    if (result.landmarks && result.landmarks.length > 0) {
      // デバッグ表示の更新頻度を制限（パフォーマンス向上）
      const shouldUpdateDebug = (timestamp - lastDebugUpdate) > DEBUG_UPDATE_INTERVAL;
      let debugText = '';
      if (shouldUpdateDebug) {
        lastDebugUpdate = timestamp;
        const inferenceTime = performance.now() - now;
        const effectiveFPS = Math.round(1000 / inferenceTime);
        debugText = `FPS: ${effectiveFPS}\n`;
      }

      result.landmarks.forEach((landmarks, idx) => {
        if (idx >= MAX_PERSONS) return;
        const worldLandmarks = result.worldLandmarks?.[idx] ?? null;
        const person = persons[idx];

        const SCALE = worldLandmarks ? 100 : 200;
        const CENTER = worldLandmarks ? 0.0 : 0.5;
        const xofset = currentNumPoses > 1 ? landmarks[0].x : 0.5;
        // console.log(`xofset: ${xofset} ${currentNumPoses}`);

        person.update(
          landmarks,
          worldLandmarks,
          isPoseRotating3D,
          displayW,
          displayH,
          ofseth,
          CENTER,
          SCALE,
          video.currentTime,
          xofset
        );

        if (idx === 0) {
          // 1人目の足元に合わせてグリッドを動かす
          const leftFoot = person.filteredLm2?.[31];
          const rightFoot = person.filteredLm2?.[32];
          if (leftFoot && rightFoot) {
            const miny = Math.min(-leftFoot.y, -rightFoot.y);
            const gridy = (miny + CENTER) * SCALE;
            gridHelper.position.set(0, gridy, 0);
            if (endcontrol && typeof camyfromgrid === 'number') {
              perspectiveCamera.position.y = Math.min(1500, camyfromgrid + gridy);
            }
          }
        }

        if (shouldUpdateDebug) {
          debugText += `[P${idx}]Speed: ${person.speedVal.toFixed(2)} max: ${person.footSpeedMax.toFixed(2)} m / s\n`;
        }
      });

      if (shouldUpdateDebug) {
        debugText += `Speed: ${video.playbackRate.toFixed(1)}x\n` +
          `Time: ${video.currentTime.toFixed(2)} / ${video.duration.toFixed(2)}\n` +
          `WH ofs: ${displayW.toFixed(1)} ${displayH.toFixed(1)} ${ofseth.toFixed(1)}`;
        debug.textContent = debugText;
      }
    }
  }

  // レンダリングは毎フレーム実行（滑らかな表示のため）
  renderer.render(scene, activeCamera);
  requestAnimationFrame(renderLoop);
}

/* -----------------------------
   UI
------------------------------ */
cameraBtn.onclick = () => {
  if (video.srcObject) return; // 既にカメラ起動中なら何もしない

  isPoseRotating3D = false;
  controls.reset();
  gridHelper.visible = false;
  axesHelper.visible = false;
  persons.forEach(p => p.reset());

  // ビデオファイルを停止
  video.pause();
  video.src = "";

  updateLayout();
  startCamera();
  activeCamera = orthoCamera;
}

videoBtn.onclick = () => {
  isPoseRotating3D = false;
  controls.reset();
  gridHelper.visible = false;
  axesHelper.visible = false;
  persons.forEach(p => p.reset());

  updateLayout();
  startVideoFile();
  activeCamera = orthoCamera;
};

playPauseBtn.onclick = () => {
  if (currentMode == "video") {
    if (video.paused) {
      video.play();
      playPauseBtn.textContent = "⏸";
    } else {
      video.pause();
      playPauseBtn.textContent = "▶︎";
    }
  } else {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      stopRecording();
    } else {
      startRecording();
    }
  }
};

// 動画の再生位置に合わせてシークバーを更新
video.ontimeupdate = () => {
  if (!video.paused) {
    seekBar.value = (video.currentTime / video.duration) * 100;
  }
};

// 停止中はスライダーで位置変更
seekBar.oninput = () => {
  //if (video.paused) {
  const t = (seekBar.value / 100) * video.duration;
  video.currentTime = t;
  //}
};
speedBar.oninput = () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    setStatus("録画中は再生速度の変更は無視されます");
    return;
  }
  const rate = parseFloat(speedBar.value);
  if (video) {
    video.playbackRate = rate;
  }
  speedLabel.textContent = rate.toFixed(1) + "x";
};

// 変更を監視するイベントリスナー（セレクトの場合）
const numPosesSelect = document.getElementById('numPosesSelect');
if (numPosesSelect) {
  numPosesSelect.addEventListener('change', async (e) => {
    const newNumPoses = parseInt(e.target.value, 10);
    if (newNumPoses === currentNumPoses) return;

    // 古いインスタンスを解放（メモリリーク防止）
    if (poseLandmarker) {
      poseLandmarker.close();  // MediaPipeのcloseメソッド（推奨）
      poseLandmarker = null;
    }

    setStatus(`検出人数を ${newNumPoses} に変更中...少々お待ちください`);
    // 再作成
    await initPose(newNumPoses);

    // 必要ならビデオ/カメラを再スタート（モードによる）
    if (video.srcObject) {
      // カメラモードの場合
      startCamera();
    } else if (video.src) {
      // ファイルモードの場合
      video.play().catch(e => console.error(e));
    }
    setStatus(`Select Movie File`);
  });
}

/* -----------------------------
   起動
------------------------------ */
async function main() {
  setStatus("Initialise device detection...");
  detectDevice(); // デバイス検出を最初に実行

  setStatus("Initialise 3D Three.js...");
  initThree();  // これが速いので最初に

  setStatus("Loading MediaPipe libs.. (初回は時間がかかります)");
  await initPose(currentNumPoses);

  // 初期化完了時に既にカメラが選ばれていなければ、ビデオファイルモードの待機状態にする
  if (currentMode !== "camera") {
    startVideoFile();
    setStatus("Select Movie file...");
  } else {
    setStatus("Camera Ready");
  }

  renderLoop();
}

main();
