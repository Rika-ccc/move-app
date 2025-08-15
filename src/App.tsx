// src/App.tsx
import React, { useRef, useState, useEffect } from 'react';
import './Style.css';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [animating, setAnimating] = useState(false);
  const [color, setColor] = useState('black');
  const [lineWidth, setLineWidth] = useState(2);
  const [mode, setMode] = useState<'pen' | 'fill' | 'eraser'>('pen');

  // undo/redo用キャンバス履歴（画像データ）
  const historyRef = useRef<ImageData[]>([]);
  const historyIndexRef = useRef<number>(-1);

  // 画像の位置・角度状態をrefで管理（useRefで値を保持）
  const imgPosRef = useRef({ x: 0, y: 0, rotation: 0 });

  // 速度と回転速度もrefで管理（★速度を底上げ）
  const velocityRef = useRef({
    vx: 4 + Math.random() * 8, // 以前: 2 + Math.random() * 3
    vy: 4 + Math.random() * 8,
    vr: (Math.random() * 0.2 + 0.05) * (Math.random() > 0.5 ? 1 : -1), // 以前: 0.1 + 0.02
  });

  const CANVAS_WIDTH = 600;
  const CANVAS_HEIGHT = 400;

  // 色コード（#rrggbb）からRGBA配列に変換
  function hexToRgba(hex: string): [number, number, number, number] {
    let r = 0, g = 0, b = 0;
    if (hex.length === 7) {
      r = parseInt(hex.substr(1, 2), 16);
      g = parseInt(hex.substr(3, 2), 16);
      b = parseInt(hex.substr(5, 2), 16);
    }
    return [r, g, b, 255];
  }

  // バケツ塗り（Flood Fill）
  function fillFlood(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    fillColor: [number, number, number, number]
  ) {
    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;
    const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    const data = imageData.data;

    // 指定位置の色を取得
    const getPixelColor = (px: number, py: number) => {
      const idx = (py * canvasWidth + px) * 4;
      return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]] as [number, number, number, number];
    };

    // 色が同じか比較（RGBA全て）
    const colorsMatch = (c1: number[], c2: number[]) => {
      return c1[0] === c2[0] && c1[1] === c2[1] && c1[2] === c2[2] && c1[3] === c2[3];
    };

    const targetColor = getPixelColor(x, y);
    if (colorsMatch(targetColor, fillColor)) return; // 塗りつぶし色と同じなら何もしない

    const queue: [number, number][] = [];
    queue.push([x, y]);

    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      if (cx < 0 || cx >= canvasWidth || cy < 0 || cy >= canvasHeight) continue;

      const idx = (cy * canvasWidth + cx) * 4;
      const currentColor = [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];

      if (colorsMatch(currentColor, targetColor)) {
        // 塗りつぶし色に変更
        data[idx] = fillColor[0];
        data[idx + 1] = fillColor[1];
        data[idx + 2] = fillColor[2];
        data[idx + 3] = fillColor[3];

        // 上下左右を調べる
        queue.push([cx - 1, cy]);
        queue.push([cx + 1, cy]);
        queue.push([cx, cy - 1]);
        queue.push([cx, cy + 1]);
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  // キャンバス状態を履歴に保存（undo用）
  const saveHistory = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // undo用履歴は今の位置以降を切る（redo履歴を消す）
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    }

    historyRef.current.push(imageData);
    if (historyRef.current.length > 20) {
      historyRef.current.shift();
    } else {
      historyIndexRef.current++;
    }
  };

  // undo処理（履歴を一つ戻す）
  const undo = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (historyIndexRef.current <= 0) {
      // 最初の履歴かそれ以下ならクリアに戻す
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      historyIndexRef.current = -1;
      return;
    }

    historyIndexRef.current--;
    const imageData = historyRef.current[historyIndexRef.current];
    if (imageData) {
      ctx.putImageData(imageData, 0, 0);
    }
  };

  // redo処理（undoしたものを戻す）
  const redo = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    historyIndexRef.current++;
    const imageData = historyRef.current[historyIndexRef.current];
    if (imageData) {
      ctx.putImageData(imageData, 0, 0);
    }
  };

  // キャンバス座標補正関数
  function getCanvasRelativePosition(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    let clientX: number, clientY: number;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    // キャンバスの描画サイズと表示サイズの比率で補正
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  // マウス・タッチ描画開始
  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (animating) return; // アニメ中は描けない

    const canvas = canvasRef.current;
    if (!canvas) return;

    const { x, y } = getCanvasRelativePosition(e);

    if (mode === 'fill') {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      saveHistory();

      const fillColor = hexToRgba(color);
      fillFlood(ctx, Math.floor(x), Math.floor(y), fillColor);
    } else {
      saveHistory();
      setPosition({ x, y });
      setIsDrawing(true);
    }
  };

  // マウス・タッチ描画中
  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    if (animating) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCanvasRelativePosition(e);

    if (mode === 'eraser') {
      ctx.strokeStyle = 'white';
      ctx.lineWidth = lineWidth * 3; // 消しゴムは太め
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
    }
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(position.x, position.y);
    ctx.lineTo(x, y);
    ctx.stroke();

    setPosition({ x, y });
  };

  // 描画終了
  const stopDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDrawing(false);
  };

  // 描画部分のバウンディングボックスを取得
  function getDrawingBoundingBox(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const imageData = ctx.getImageData(0, 0, width, height);
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const b = imageData.data[idx + 2];
        const a = imageData.data[idx + 3];
        // 白以外のピクセルを検出
        if (!(r === 255 && g === 255 && b === 255 && a === 255)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    // 描画がなければnull
    if (minX > maxX || minY > maxY) return null;
    return { minX, minY, maxX, maxY };
  }

  // アニメーション開始
  const startAnimation = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 描画部分のバウンディングボックス取得
    const bbox = getDrawingBoundingBox(ctx, canvas.width, canvas.height);
    if (!bbox) return; // 描画がなければ何もしない

    const { minX, minY, maxX, maxY } = bbox;
    const drawWidth = maxX - minX + 1;
    const drawHeight = maxY - minY + 1;

    // 描画部分だけ切り抜いたオフスクリーンキャンバス作成
    const offCanvas = document.createElement('canvas');
    offCanvas.width = drawWidth;
    offCanvas.height = drawHeight;
    const offCtx = offCanvas.getContext('2d');
    if (!offCtx) return;

    // 切り抜き
    const imageData = ctx.getImageData(minX, minY, drawWidth, drawHeight);
    offCtx.putImageData(imageData, 0, 0);

    offscreenCanvasRef.current = offCanvas;

    // 初期位置を中央、回転0にセット
    imgPosRef.current = {
      x: canvas.width / 2,
      y: canvas.height / 2,
      rotation: 0,
    };

    velocityRef.current = {
      vx: (Math.random() * 12 - 6), // 以前: 6
      vy: (Math.random() * 12 - 6),
      vr: (Math.random() * 0.2 + 0.05) * (Math.random() > 0.5 ? 1 : -1), // 以前: 0.1 + 0.02
    };

    setAnimating(true);

    speakRandom();
  };

  // 「もっと！」ボタン用ランダム音声＋ランダム速度変更
  const speakRandom = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;

    const phrases = [
      '可愛く書いてくれてありがとね！',
      'みんなは今日は何をして遊んだのかな？',
      'どんどんカラフルにしてみよう！',
      'もっとボタンを押すともっと早くなったり遅くなったりするよ',
      '少しでも楽しんでくれると嬉しいな',
      'ああああ目が回るうううううよおおおおお',
      'お絵かきすると楽しいね',
      'ぼよんぼよん、くるくるくる、びゅうんびゅうん',
    ];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    const utter = new SpeechSynthesisUtterance(phrase);
    synth.speak(utter);

    // 動きもランダム変更
    velocityRef.current = {
      vx: (Math.random() * 12 - 6), // 以前: 6
      vy: (Math.random() * 12 - 6),
      vr: (Math.random() * 0.2 + 0.05) * (Math.random() > 0.5 ? 1 : -1), // 以前: 0.1 + 0.02
    };
  };

  // アニメーション中に新規描画に戻るボタン
  const stopAnimation = () => {
    setAnimating(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 履歴も初期化して新規描画可能に
    historyRef.current = [];
    historyIndexRef.current = -1;
  };

  // アニメーション処理
  useEffect(() => {
    if (!animating) return;

    const canvas = canvasRef.current;
    const offCanvas = offscreenCanvasRef.current;
    if (!canvas || !offCanvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId: number;

    const imgWidth = offCanvas.width;
    const imgHeight = offCanvas.height;

    const animate = () => {
      let { x, y, rotation } = imgPosRef.current;
      let { vx, vy, vr } = velocityRef.current;

      // 位置更新
      x += vx;
      y += vy;
      rotation += vr;

      // 跳ね返り判定（画像中央基準）
      if (x - imgWidth / 2 < 0) {
        x = imgWidth / 2;
        vx = -vx;
      } else if (x + imgWidth / 2 > canvas.width) {
        x = canvas.width - imgWidth / 2;
        vx = -vx;
      }
      if (y - imgHeight / 2 < 0) {
        y = imgHeight / 2;
        vy = -vy;
      } else if (y + imgHeight / 2 > canvas.height) {
        y = canvas.height - imgHeight / 2;
        vy = -vy;
      }

      imgPosRef.current = { x, y, rotation };
      velocityRef.current = { vx, vy, vr };

      // 背景は白で塗りつぶし
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.drawImage(offCanvas, -imgWidth / 2, -imgHeight / 2);
      ctx.restore();

      frameId = requestAnimationFrame(animate);
    };

    animate();

    return () => cancelAnimationFrame(frameId);
  }, [animating]);

  // 初期Canvasセットアップ
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // 初期履歴（白紙）
    historyRef.current = [ctx.getImageData(0, 0, canvas.width, canvas.height)];
    historyIndexRef.current = 0;
  }, []);

  // 描画があるかどうか判定（キャンバスが真っ白かどうかの簡易判定）
  const hasDrawing = () => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < imageData.data.length; i += 4) {
    const r = imageData.data[i];
    const g = imageData.data[i + 1];
    const b = imageData.data[i + 2];
    const a = imageData.data[i + 3];
    if (!(r === 255 && g === 255 && b === 255 && a === 255)) {
      return true; // 白以外があれば描画あり
      }
    }
    return false;
  };
  
  return (
    <>
      {/* 雲を複数配置（z-index: 0で後ろに） */}
      <div style={{ position: 'relative', width: '100%', height: 0 }}>
        <div className="cloud" style={{
          position: 'absolute',
          top: '10%',
          left: '10%',
          width: '120px',
          height: '70px',
          animation: 'moveCloud 60s linear infinite',
          zIndex: 0,
          pointerEvents: 'none'
        }}></div>
        <div className="cloud" style={{
          position: 'absolute',
          top: '30%',
          left: '40%',
          width: '180px',
          height: '90px',
          animation: 'moveCloud 80s linear infinite',
          zIndex: 0,
          pointerEvents: 'none'
        }}></div>
        <div className="cloud" style={{
          position: 'absolute',
          top: '50%',
          left: '70%',
          width: '100px',
          height: '60px',
          animation: 'moveCloud 50s linear infinite',
          zIndex: 0,
          pointerEvents: 'none'
        }}></div>
      </div>

      {/* メインコンテナ（z-index: 1で前面に） */}
      <div className="main-container" style={{ position: 'relative', zIndex: 1 }}>
        <h2>絵を描いて「完成」ボタンを押すと回るし喋ります</h2>

        {/* 色・線・モード選択（2行に分割） */}
        <div style={{ marginBottom: 10 }}>
          {/* 1行目：色・太さ */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 4 }}>
            <label>
              ペンの色:{' '}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                disabled={animating || mode === 'eraser'}
              />
            </label>
            <label>
              線の太さ:{' '}
              <input
                type="range"
                min={1}
                max={10}
                value={lineWidth}
                onChange={(e) => setLineWidth(Number(e.target.value))}
                disabled={animating}
              />
            </label>
          </div>
          {/* 2行目：モード選択 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <label>
              <input
                type="radio"
                name="mode"
                value="pen"
                checked={mode === 'pen'}
                onChange={() => setMode('pen')}
                disabled={animating}
              />
              ペン
            </label>
            <label>
              <input
                type="radio"
                name="mode"
                value="fill"
                checked={mode === 'fill'}
                onChange={() => setMode('fill')}
                disabled={animating}
              />
              塗りつぶし
            </label>
            <label>
              <input
                type="radio"
                name="mode"
                value="eraser"
                checked={mode === 'eraser'}
                onChange={() => setMode('eraser')}
                disabled={animating}
              />
              消しゴム
            </label>
          </div>
        </div>

        {/* キャンバス */}
        <canvas
          ref={canvasRef}
          style={{
            border: '1px solid black',
            cursor: animating ? 'default' : mode === 'pen' ? 'crosshair' : 'pointer',
            width: '100%',
            height: 'auto',
            maxWidth: '600px',
            touchAction: 'none',
            userSelect: 'none',
          }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          onTouchCancel={stopDrawing}
        />
        <br />

        {/* 操作ボタン（レスポンシブ2段配置） */}
        <div className="button-area">
          <div className="button-row">
            <button className="action-btn" onClick={undo} disabled={animating || historyIndexRef.current <= 0}>
              一つ前に戻る
            </button>
            <button className="action-btn"
              onClick={redo}
              disabled={animating || historyIndexRef.current >= historyRef.current.length - 1}
            >
              一つ先に進む
            </button>
          </div>
          <div className="button-row">
            {!animating ? (
              <button className="action-btn" onClick={startAnimation} disabled={!hasDrawing()}>
                完成！
              </button>
            ) : (
              <>
                <button className="action-btn special-btn" onClick={stopAnimation}>
                  新規描画に戻る
                </button>
                <button className="action-btn" onClick={speakRandom}>
                  もっと！
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

