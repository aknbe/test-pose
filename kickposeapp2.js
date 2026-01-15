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

let poseLandmarker;
let scene, renderer, controls;
let orthoCamera;
let perspectiveCamera;
let activeCamera;

let filteredLm1 = null; // 一次フィルタ
let filteredLm2 = null; // 二次フィルタ（最終出力）

let skeletonLines = [];
let trailPoints = [];
let lastTime = null;
let lastLeftPos = null;
let lastRightPos = null;
let footspeedmax = 0.0;

let leftTrailPoints = [];
let rightTrailPoints = [];

let leftTrailLine;
let rightTrailLine;

let isPoseRotating3D = false;
let currentMode = "video";

function setStatus(msg) {
  if (statusElement) {
    statusElement.textContent = msg;
  }
  console.log("[STATUS]", msg);  // デバッグ用にも
}

function lowpass2(prev1, prev2, next, alpha = 0.25) {
  // prev1: 一次フィルタの前回値
  // prev2: 二次フィルタの前回値
  // next: 新しい入力値（x,y,z）
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

function updatePoseLandmarks(lm) {
  const playbackRate = video.playbackRate;

  const baseTau = 0.015; // 20ms
  const tau = baseTau / playbackRate; // 再生速度に応じて時定数をスケール

  const dt = 1 / 30; // MediaPipe のフレーム周期
  let alpha = dt / tau;

  // α が 1 を超えないように制限
  if (alpha > 1) alpha = 1;

  if (!filteredLm1) {
    filteredLm1 = lm.map(p => ({ x: p.x, y: p.y, z: p.z }));
    filteredLm2 = lm.map(p => ({ x: p.x, y: p.y, z: p.z }));
    return;
  }

  for (let i = 0; i < lm.length; i++) {
    const { y1, y2 } = lowpass2(filteredLm1[i], filteredLm2[i], lm[i], alpha);
    filteredLm1[i] = y1;
    filteredLm2[i] = y2;
  }
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
    if (isPoseRotating3D &&   currentMode == "video") {
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
}

window.addEventListener("resize", updateLayout);

/* -----------------------------
   Three.js 初期化
------------------------------ */
function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
  //renderer.setSize(window.innerWidth, window.innerHeight);

  scene = new THREE.Scene();
  perspectiveCamera  = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
  ); /* */
  perspectiveCamera.position.set(0, 0, 300);
  perspectiveCamera.updateProjectionMatrix()
  activeCamera = perspectiveCamera; // 初期はどちらでもOK

  controls = new OrbitControls(activeCamera, renderer.domElement);
  controls.enableDamping = true;

  controls.addEventListener("start", () => {
    isPoseRotating3D = true;
    controls.target.set(0, 0, 0);
    controls.update();
    //perspectiveCamera.updateProjectionMatrix()
    // lookat(0,0,0);
    activeCamera = perspectiveCamera;
    gridHelper.visible = true;
    axesHelper.visible = true;
    updateLayout();
  });

  controls.addEventListener("end", () => {
    //isPoseRotating3D = false;
    //updateLayout();
    console.log(`Left foot Z: ${gridHelper.position}`);
  }); // 終了時は何もしない 

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

  const left = [13, 15, 19, 25, 27, 29, 31];
  const right = [14, 16, 20, 26, 28, 30, 32];

  connections.forEach((pair, i) => {
    const [a, b] = pair;
    // ★ 左右の部位で色を決める
    let color = 0xffff00; // デフォルト（胴体）

    if (left.includes(a)) color = 0xffaa00;     // 左側（例：オレンジ）
    if (left.includes(b)) color = 0xffaa00;     // 左側（例：オレンジ）
    if (right.includes(a)) color = 0x00ffff;    // 右側（例：水色）
    if (right.includes(b)) color = 0x00ffff;    // 右側（例：水色）

    // ★ LineMaterial をラインごとに作る
    const material = new LineMaterial({
        color: color,
        linewidth: 3.0,
        resolution: new THREE.Vector2(renderer.domElement.width, renderer.domElement.height)
    });

    const geometry = new LineGeometry();
    const line = new Line2(geometry, material);

    scene.add(line);
    skeletonLines.push(line);
  });

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

  // === 3D 用の地平面と XYZ 軸 ===
    const grid = new THREE.GridHelper(400, 20, 0x444444, 0x888888);
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
async function initPose() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
  );

  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
        //"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 2
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
    setStatus("Loading Movie file...");
    const file = fileInput.files[0];
    if (!file) return;
    // ★ 3D 回転状態をリセット
    isPoseRotating3D = false;
    controls.reset();
    updateLayout();

    video.src = URL.createObjectURL(file);

    video.onloadedmetadata = () => {
      renderer.setSize(video.videoWidth, video.videoHeight, false);
      setupCameraForVideo();
      activeCamera = orthoCamera; 
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
  //var ofseth = (video.offsetHeight - dispheight) / 2
  // If the video element is short and wide
  if(elementRatio > videoRatio) dispwidth = dispheight * videoRatio;
  // It must be tall and thin, or exactly equal to the original ratio
  else dispheight = dispwidth / videoRatio;

  // iPhone Safari 判定
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const videoRect = video.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const ofseth = videoRect.top - containerRect.top;
  if (isIOS) {
    var displayW = videoRect.width;
    var displayH = videoRect.height;
  } else {
    var displayW = video.videoWidth;
    var displayH = video.videoHeight;
  }

  if (poseLandmarker && video.readyState >= 2) {
    setStatus("");  // 空にしてもOK
    if (statusElement) {
      statusElement.style.display = 'none';  // または statusElement.remove();
    }
    const now = performance.now();
    const result = poseLandmarker.detectForVideo(video, now);

    if (result.landmarks && result.landmarks[0]) {

      const worldLm = result.worldLandmarks?.[0] ?? null;  // or result.worldLandmarks?.[0]
      if (isPoseRotating3D && worldLm) {
        // Use worldLm for 3D / filteredLm2 etc.
        updatePoseLandmarks(worldLm);
        var SCALE = 100;
        var CENTER = 0.0; // 腰部
        console.log("use worldlandmarks:", result.worldlandmarks);
      } else {
        var SCALE = 200;
        var CENTER = 0.5; //画面
        // console.log("not worldlandmarks:", result.worldlandmarks);
        updatePoseLandmarks(result.landmarks[0]);  // fallback
      }

      // const left = [11, 13, 15, 19, 23, 25, 27, 29, 31];
      // const right = [12, 14, 16, 20, 24, 26, 28, 30, 32];

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
        const p1 = filteredLm2[a];
        const p2 = filteredLm2[b];
        const line = skeletonLines[i];
        const posArray = [];

        if (isPoseRotating3D) {
            posArray[0] = (p1.x - CENTER) * SCALE;
            posArray[1] = (-p1.y + CENTER) * SCALE;
            posArray[2] = -p1.z * SCALE;

            posArray[3] = (p2.x - CENTER) * SCALE;
            posArray[4] = (-p2.y + CENTER) * SCALE;
            posArray[5] = -p2.z * SCALE;

        } else {
            posArray[0] = p1.x * displayW;;
            posArray[1] = ofseth + ( 1- p1.y ) * displayH;
            posArray[2] = 0;
            posArray[3] = p2.x * displayW;;
            posArray[4] = ofseth + ( 1 - p2.y ) * displayH;
            posArray[5] = 0;
        }

        // ★ Line2 用の更新
        line.geometry.setPositions(posArray);
        line.computeLineDistances();
        line.material.resolution.set(renderer.domElement.width, renderer.domElement.height);
        line.material.needsUpdate = true;
      });

      const foot = filteredLm2[28];
      const footPos = new THREE.Vector3(
        foot.x - 0.5,
        -foot.y + 0.5,
        -foot.z
      );

      trailPoints.push(footPos.clone());
      if (trailPoints.length > 60) trailPoints.shift();

      const trailArray = [];
      trailPoints.forEach(p => trailArray.push(p.x, p.y, p.z));

      // 左右のつま先ランドマーク
      const leftFoot = filteredLm2[31];
      const rightFoot = filteredLm2[32];

      if (leftFoot && rightFoot) {
        const miny = Math.min(-leftFoot.y, -rightFoot.y);
        const gridy = (miny+CENTER) * SCALE ;//+ 50;  // +50 is an offset to ensure visibility
        gridHelper.position.set(0, gridy, 0);
        //console.log(`Left foot Z: ${-leftFoot.z}, Right foot Z: ${-rightFoot.z}, Min Z: ${minZ}`);
      }

      let leftPos, rightPos;
      leftPos = new THREE.Vector3(
        (leftFoot.x - CENTER) ,
        (-leftFoot.y + CENTER) ,
        -leftFoot.z 
      );
      rightPos = new THREE.Vector3(
        (rightFoot.x - CENTER) ,
        (-rightFoot.y + CENTER) ,
        -rightFoot.z
      );

      let speedVal = 0; // 足先の速度推定
      if (lastLeftPos && lastTime) {
        const dt = (now - lastTime) / 1000;
        speedVal = Math.max(leftPos.distanceTo(lastLeftPos),rightPos.distanceTo(lastRightPos)) / dt;
      }
      footspeedmax = Math.max(footspeedmax,speedVal)
      lastLeftPos = leftPos.clone();
      lastRightPos = rightPos.clone();
      lastTime = now;

      if (isPoseRotating3D) {
        // ★ 3D 表示用
        leftPos.multiplyScalar(SCALE);
        rightPos.multiplyScalar(SCALE); 
      } else {
        // ★ 2D オーバーレイ用
        const lx = leftFoot.x * displayW;
        const ly = ofseth + (1 - leftFoot.y) * displayH;

        const rx = rightFoot.x * displayW;
        const ry = ofseth + (1 - rightFoot.y) * displayH;

        leftPos = new THREE.Vector3(lx, ly, 0);
        rightPos = new THREE.Vector3(rx, ry, 0);
      }

      // ★ 軌跡に追加
      leftTrailPoints.push(leftPos.clone());
      rightTrailPoints.push(rightPos.clone());

      if (leftTrailPoints.length > 60) leftTrailPoints.shift();
      if (rightTrailPoints.length > 60) rightTrailPoints.shift();

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

      debug.textContent =
        `FPS: ${Math.round(1000 / (performance.now() - now))}\n` +
        `Foot speed: ${speedVal.toFixed(2)} max: ${footspeedmax.toFixed(2)} m/s\n` +
        `Speed: ${video.playbackRate.toFixed(1)}x\n` +
        `Time: ${video.currentTime.toFixed(2)} / ${video.duration.toFixed(2)}\n` +
        //`container: ${container.className}\n` +
        `vide WH ofs: ${displayW.toFixed(1)} ${displayH.toFixed(1)} ${ofseth.toFixed(1)}`;
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
  gridHelper.visible = false;
  axesHelper.visible = false;

  updateLayout();   // ★ small-video を解除
  startVideoFile();   // ★ 動画モードに戻す
};

playPauseBtn.onclick = () => {
  if (video.paused) {
    video.play();
    playPauseBtn.textContent = "⏸";
  } else {
    video.pause();
    playPauseBtn.textContent = "▶︎";
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
  if (video.paused) {
    const t = (seekBar.value / 100) * video.duration;
    video.currentTime = t;
  }
};
speedBar.oninput = () => {
  const rate = parseFloat(speedBar.value);
  video.playbackRate = rate;
  speedLabel.textContent = rate.toFixed(1) + "x";
};

/*slider.oninput = () => {
  video.playbackRate = slider.value / 50;
};*/

/* -----------------------------
   起動
------------------------------ */
async function main() {
  setStatus("Initialise 3D Three.js...");
  initThree();  // これが速いので最初に
  setStatus("Loading MediaPipe libs.. (初回は時間がかかります)");
  await initPose();
  setStatus("Select Movie file...");
  
  // startVideoFile();  // またはカメラ起動部分

  // 最初のフレーム処理が始まるまで少し待ってから消す（任意）
  /*setTimeout(() => {
    if (statusElement) {
      statusElement.style.display = 'none';  // または statusElement.remove();
    }
  }, 1500);  // 1.5秒後くらいに消す（調整可）*/

  renderLoop();
}

main();
