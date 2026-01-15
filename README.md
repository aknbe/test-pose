# test-pose  
AI Pose Estimation × 3D Visualization Demo

このリポジトリは、MediaPipe Pose と Three.js を組み合わせて  
**2D オーバーレイ表示 / 3D 表示 / 軌跡可視化 / 足速度推定 / フィルタリング**  
を行うデモアプリです。

iPhone Safari / Android / PC ブラウザで動作します。

---

## 🚀 デモページ

https://aknbe.github.io/test-pose/

---

## ✨ 主な機能

### ■ 2D オーバーレイ表示
- MediaPipe Pose のランドマークを動画上に重ねて表示
- iPhone Safari のズレ対策として `getBoundingClientRect()` を使用
- スケルトンの色分け表示

### ■ 3D 表示（Three.js）
- Perspective / Orthographic カメラ切り替え
- OrbitControls による 3D 回転
- GridHelper（地面）と AxesHelper（XYZ 軸）
- スケルトンの 3D ライン描画（Line2 対応）

### ■ 軌跡表示
- 左右の足の 3D 軌跡をリアルタイム描画
- EMA / 二次遅れフィルタでノイズを低減

### ■ 足速度推定
- フレーム間距離から速度を算出
- フィルタリングによりピークを安定化

### ■ 再生コントロール
- 再生 / 一時停止
- シークバー
- 再生速度（0.1x〜2.0x）
- 再生速度に応じてフィルタ時定数を自動調整

---

## 🛠 使用技術

- **MediaPipe Pose**
- **Three.js**
- **Line2 / LineGeometry / LineMaterial**
- **JavaScript ES Modules**
- **HTML5 Video**
- **CSS3**

---

## 📱 対応ブラウザ

- iPhone Safari（iOS 15+）
- Android Chrome
- PC Chrome / Edge / Firefox / Safari

---

## 📝 ライセンス

MIT License  
自由に改変・利用できます。

---

## 👤 作者

ak  
https://github.com/aknbe
