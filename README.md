# Drosophila Connectome Neural Simulation & Space Invaders Arcade Engine
果蠅神經連接組驅動神經模擬系統與小蜜蜂 (Space Invaders) 演化訓練引擎

基於美國 Janelia Research Campus 官方 neuPrint 圖譜資料庫 (`male-cns:v1.0`)，整合 **22,875 條真實突觸連接**（總突觸權重達 222,047）與神經遞質動態，實現從生物視覺輸入 (32x32 複眼陣列)、神經電位計算 ($V_{\text{net}}$)、實時遙測示波器，到瀏覽器端小蜜蜂 (Space Invaders) 基因演化訓練控制的完整系統。

---

## 📊 目前開發進度 (Current Progress Status)

目前本專案 4 大核心模組及網頁端小蜜蜂訓練引擎已 **100% 完成開發與實測驗證**：

| 模組名稱 | 開發狀態 | 主要功能與實現細節 |
| :--- | :---: | :--- |
| **Module 1: 自動化矩陣獲取** | ✅ 完成 | 支援 neuPrint REST API，已成功下載並持久化 **22,875 條真實 LC4 突觸數據** (`lc4_connectome_matrix.csv`)。內建仿生合成 fallback 模式。 |
| **Module 2: 視覺輸入預處理** | ✅ 完成 | 支援 Webcam、影片檔與動態合成視覺刺激。將畫面轉換為灰階並降採樣至 **32x32 小眼陣列**，計算絕對動作差分 ($|I_{\text{curr}} - I_{\text{prev}}|$)。 |
| **Module 3: 神經矩陣計算引擎** | ✅ 完成 | 實現乙醯膽鹼 (ACh: $+1.0$) 興奮性與 GABA/谷氨酸 (GABA/Glu: $-1.0$) 抑制性極性映射。使用 `numpy` 進行向量化點積與 Leaky 時序整合膜電位計算。 |
| **Module 4: 實時視覺化與遙測** | ✅ 完成 | 終端機動態進度條 (`█` 密度映射) 及 OpenCV 3 面板 GUI 視窗（32x32 網膜視圖、運動熱圖 `COLORMAP_JET`、膜電位動態示波器）。 |
| **Web Arcade: 果蠅大腦小蜜蜂** | ✅ 完成 | HTML5 Canvas 街機小蜜蜂遊戲，整合 **T4/T5 相互抑制與質心追蹤**、**LC4 子彈動態避讓** 與 **基因演化訓練器 (Genetic Algorithm)**，果蠅大腦可自動流暢操作飛船。 |

---

## 🎮 果蠅大腦小蜜蜂網頁訓練器 (Web Arcade Game)

本專案將果蠅大腦視網膜運動感測與神經迴路移植至 JavaScript，讓果蠅大腦以 $32 \times 32$ 視覺感受野直接遊玩 Space Invaders 街機遊戲。

### 啟動方式

1. 執行本地伺服器：
   ```bash
   python server.py
   # 或 python -m http.server 8000
   ```
2. 在瀏覽器開啟：**[http://localhost:8000](http://localhost:8000)**

### 神經控制機制亮點
1. **外星人群體質心動態追蹤 (Centroid Tracking)**：計算外星人群體動態質心 ($\bar{X}_{\text{alien}}$)，實現全視野欄位 ($0 \dots 31$) 平滑導航追蹤。
2. **高靈敏度 LC4 子彈動態閃避 (LC4 Threat Dodging)**：針對敵方 4px 細小子彈下落軌跡，觸發 4.0x 高優先度 LC4 側向甩尾避讓迴路。
3. **生物學 T4/T5 相互抑制與牆角防卡死 (Reciprocal Inhibition & Wall-Stuck Evasion)**：
   - 實現果蠅視覺方向神經元的對側抑制 ($v_{\text{left}} \leftarrow \max(0, v_{\text{left}} - 0.4 \cdot v_{\text{right}})$)，提高轉向反應速度。
   - 貼牆時自動放電洩壓，確保飛船可在左右兩端間靈活轉向攻擊。
4. **Auto-Train Brain (基因演化訓練)**：按下按鈕開啟多世代演化。系統根據得分與存活時間進行精英選擇 (Elite Selection) 與基因突變 (Mutation)，自動提升大腦遊戲表現。

---

## 🚀 快速開始 (Quick Start)

### 1. 安裝環境依賴

需求 Python 3.10+，執行以下指令安裝依賴：

```bash
pip install -r requirements.txt
```

### 2. 執行 Python 神經模擬器 (終端機 + OpenCV 視窗)

```bash
# 使用合成運動刺激進行測試 (無需攝影機)
python main.py --source synthetic

# 使用本地攝影機 (索引 0)
python main.py --source 0
```

### 3. 真實下載 neuPrint 數據庫

設定您的 neuPrint API Token 並加上 `--fetch` 參數：

**PowerShell 設定環境變數：**
```powershell
$env:NEUPRINT_APPLICATION_TOKEN="您的_NEUPRINT_TOKEN_字串"
python main.py --fetch --source 0
```

**命令行帶入：**
```bash
python main.py --token "您的_NEUPRINT_TOKEN_字串" --fetch --source 0
```

---

## 📁 專案檔案結構 (Project Structure)

```text
maleCNS/
├── connectome_fetcher.py   # Module 1: neuPrint API 連接與 CSV 矩陣儲存
├── visual_input.py         # Module 2: 攝影機/影片 capture、32x32 降採樣與運動差分
├── neural_engine.py        # Module 3: 神經極性映射、矩陣點積與 Leaky 膜電位計算
├── telemetry_visualizer.py # Module 4: 終端機進度條與 OpenCV 三面板視覺化視窗
├── main.py                 # CLI 整合主程式 (帶有 --fetch, --token, --source 等參數)
├── test_simulation.py      # 自動化單元測試套件 (100% 通過)
├── index.html              # 小蜜蜂網頁遊戲應用程式 Shell
├── style.css               # 霓虹街機與玻璃擬物 (Glassmorphism) UI 樣式
├── connectome_brain.js     # JS 視網膜運動感測、T4/T5/LC4/LC11 神經迴路與基因演化引擎
├── game.js                 # HTML5 Canvas 小蜜蜂遊戲引擎與 Auto-Pilot 控制環路
├── server.py               # 本地 HTTP 伺服器啟動腳本 (Port 8000)
├── lc4_connectome_matrix.csv # 持久化儲存之 22,875 條真實 neuPrint 突觸矩陣
├── README.md               # 專案完整中文說明文件
└── requirements.txt        # Python 依賴套件包
```

---

## 🔬 神經科學原理 (Neuroscience Background)

本專案採用的 **LC4 (Lobula Columnar type 4)** 神經元是果蠅視葉（Lobula）的核心視覺投影神經元：
- **中央感受野 (Center, ACh 乙醯膽鹼)**：興奮性突觸（$+1.0$），檢測中央擴大的視覺變化。
- **周圍感受野 (Surround, GABA / Glutamate)**：抑制性突觸（$-1.0$），提供側向抑制過濾背景移動。
- **下遊連線**：LC4 連結至巨纖維系統 (Giant Fiber)，當累積膜電位 $V_{\text{net}}$ 突破門檻時，爆發動作電位並觸發起飛逃逸反應。

---

## 🧪 自動化測試 (Testing)

執行單元測試套件：

```bash
python -m unittest test_simulation.py
```
