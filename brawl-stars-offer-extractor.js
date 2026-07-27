/*
 * Логика вырезания акций Brawl Stars и замены цены.
 * Вынесено из основного файла Snapi без изменения алгоритма.
 *
 * Основные функции:
 *   runMagicLogic(img)              — находит и вырезает акции со скриншота;
 *   autoReplacePrice(ctx, w, h)     — стирает исходную цену и определяет её позицию;
 *   drawPriceText(ctx, w, h, price, info) — накладывает новую цену.
 *
 * Файл рассчитан на подключение к исходному проекту Snapi и использует его
 * layerState, allGeneratedCards и checkBatchCompletion.
 */

function autoReplacePrice(ctx, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

let seedCandidates = [];
let scanCols = [0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85];
for (let frac of scanCols) {
  let sx = Math.floor(w * frac);
  let sy = h - Math.max(3, Math.floor(h * 0.02));
  while (sy > h * 0.55) {
    let i = (sy * w + sx) * 4;
    let sr = d[i], sg = d[i+1], sb = d[i+2];
    let sMax = Math.max(sr, sg, sb);
    let sMin = Math.min(sr, sg, sb);
    if (d[i+3] > 200 && sMax > 160 && (sMax - sMin) > 60) {
      seedCandidates.push({ x: sx, y: Math.max(0, sy - 15) });
      break;
    }
    sy--;
  }
}
if (seedCandidates.length === 0) return;

seedCandidates.sort((a, b) => a.x - b.x);
let seedGroups = [];
seedCandidates.forEach(sc => {
    let g = seedGroups[seedGroups.length - 1];
    if (g && (sc.x - g[g.length - 1].x) < w * 0.12) g.push(sc);
    else seedGroups.push([sc]);
});

  const processPlate = (seedX, seedY) => {
  let colors = {};
  for(let y = seedY - 20; y <= seedY + 20; y++) {
    for(let x = seedX - 20; x <= seedX + 20; x++) {
      if (x>=0 && x<w && y>=0 && y<h) {
        let i = (y*w + x)*4;
        if (d[i+3] > 100) {
          let cr=d[i], cg=d[i+1], cb=d[i+2];
          if (cr > 60 || cg > 60 || cb > 60) {
            let key = Math.round(cr/10)*10 + ',' + Math.round(cg/10)*10 + ',' + Math.round(cb/10)*10;
            colors[key] = (colors[key] || 0) + 1;
          }
        }
      }
    }
  }
  
  let maxCount = 0; let bgKey = "";
  for (let k in colors) { if (colors[k] > maxCount) { maxCount = colors[k]; bgKey = k; } }
  if (!bgKey) return null; 

  let [qR, qG, qB] = bgKey.split(',').map(Number);
  let sumR=0, sumG=0, sumB=0, sumC=0;
  for(let y = seedY - 20; y <= seedY + 20; y++) {
    for(let x = seedX - 20; x <= seedX + 20; x++) {
      if (x>=0 && x<w && y>=0 && y<h) {
        let i = (y*w + x)*4;
        if (d[i+3] > 100) {
          let cr=d[i], cg=d[i+1], cb=d[i+2];
          if (Math.abs(cr-qR)<15 && Math.abs(cg-qG)<15 && Math.abs(cb-qB)<15) { sumR += cr; sumG += cg; sumB += cb; sumC++; }
        }
      }
    }
  }
  let bgR = Math.round(sumR/sumC), bgG = Math.round(sumG/sumC), bgB = Math.round(sumB/sumC);

function isBg(x, y) {
    if (x<0 || x>=w || y<0 || y>=h) return false;
    
    if (seedY - y > h * 0.45) return false; 
    
    let i = (y*w + x)*4;
    if (d[i+3] < 128) return false;
    if (d[i] < 70 && d[i+1] < 70 && d[i+2] < 70) return false;
    
    return Math.abs(d[i]-bgR) < 25 && Math.abs(d[i+1]-bgG) < 25 && Math.abs(d[i+2]-bgB) < 25;
  }

  let isBgMask = new Uint8Array(w * h);
  let stackX = [seedX], stackY = [seedY];
  
  if (!isBg(seedX, seedY)) {
    let found = false;
    for(let r=1; r<=25 && !found; r++) {
      for(let dy=-r; dy<=r && !found; dy++) {
        for(let dx=-r; dx<=r && !found; dx++) {
          if(isBg(seedX+dx, seedY+dy)) { stackX=[seedX+dx]; stackY=[seedY+dy]; found = true; }
        }
      }
    }
  }

  let head = 0;
  while (head < stackX.length) {
    let x = stackX[head]; let y = stackY[head]; head++;
    let idx = y*w + x;
    if (isBgMask[idx]) continue;
    isBgMask[idx] = 1;
    if (x+1 < w && !isBgMask[idx+1] && isBg(x+1, y)) { stackX.push(x+1); stackY.push(y); }
    if (x-1 >= 0 && !isBgMask[idx-1] && isBg(x-1, y)) { stackX.push(x-1); stackY.push(y); }
    if (y+1 < h && !isBgMask[idx+w] && isBg(x, y+1)) { stackX.push(x); stackY.push(y+1); }
    if (y-1 >= 0 && !isBgMask[idx-w] && isBg(x, y-1)) { stackX.push(x); stackY.push(y-1); }
  }

  let minBoxX = w, maxBoxX = 0, minBoxY = h, maxBoxY = 0;
  for(let y=0; y<h; y++) {
    for(let x=0; x<w; x++) {
      if (isBgMask[y*w + x]) {
        if (x < minBoxX) minBoxX = x; if (x > maxBoxX) maxBoxX = x;
        if (y < minBoxY) minBoxY = y; if (y > maxBoxY) maxBoxY = y;
      }
    }
  }
  if (minBoxX === w) return null; 

  let _detW = maxBoxX - minBoxX;
  let _detH = maxBoxY - minBoxY;
  if (_detW < w * 0.25 || _detH < h * 0.04) return null 

  let outsideMask = new Uint8Array(w * h);
  let outStackX = []; let outStackY = [];

    const expand = 5;
    for(let x = Math.max(0, minBoxX - expand); x <= Math.min(w-1, maxBoxX + expand); x++) {
        let y1 = Math.max(0, minBoxY - expand), y2 = Math.min(h-1, maxBoxY + expand);
        if (!isBgMask[y1*w + x] && !outsideMask[y1*w + x]) { outStackX.push(x); outStackY.push(y1); outsideMask[y1*w + x] = 1; }
        if (!isBgMask[y2*w + x] && !outsideMask[y2*w + x]) { outStackX.push(x); outStackY.push(y2); outsideMask[y2*w + x] = 1; }
    }
    for(let y = Math.max(0, minBoxY - expand); y <= Math.min(h-1, maxBoxY + expand); y++) {
        let x1 = Math.max(0, minBoxX - expand), x2 = Math.min(w-1, maxBoxX + expand);
        if (!isBgMask[y*w + x1] && !outsideMask[y*w + x1]) { outStackX.push(x1); outStackY.push(y); outsideMask[y*w + x1] = 1; }
        if (!isBgMask[y*w + x2] && !outsideMask[y*w + x2]) { outStackX.push(x2); outStackY.push(y); outsideMask[y*w + x2] = 1; }
    }

  let outHead = 0;
  while (outHead < outStackX.length) {
    let cx = outStackX[outHead]; let cy = outStackY[outHead]; outHead++;
    if (cx+1 <= maxBoxX+expand && !outsideMask[cy*w + cx+1] && !isBgMask[cy*w + cx+1]) {outsideMask[cy*w + cx+1] = 1; outStackX.push(cx+1); outStackY.push(cy); }
    if (cx-1 >= minBoxX-expand && !outsideMask[cy*w + cx-1] && !isBgMask[cy*w + cx-1]) {outsideMask[cy*w + cx-1] = 1; outStackX.push(cx-1); outStackY.push(cy); }
    if (cy+1 <= maxBoxY+expand && !outsideMask[(cy+1)*w + cx] && !isBgMask[(cy+1)*w + cx]) {outsideMask[(cy+1)*w + cx] = 1; outStackX.push(cx); outStackY.push(cy+1); }
    if (cy-1 >= minBoxY-expand && !outsideMask[(cy-1)*w + cx] && !isBgMask[(cy-1)*w + cx]) {outsideMask[(cy-1)*w + cx] = 1; outStackX.push(cx); outStackY.push(cy-1); }
  }

let boxW = maxBoxX - minBoxX + 1;
let boxH = maxBoxY - minBoxY + 1;
let R = Math.max(4, Math.round(boxH * 0.18)); 

let fillMask = new Uint8Array(boxW * boxH);
for (let y = 0; y < boxH; y++)
  for (let x = 0; x < boxW; x++)
    if (!outsideMask[(minBoxY+y)*w + (minBoxX+x)]) fillMask[y*boxW+x] = 1;

const dilate = (src) => {
  let o = new Uint8Array(boxW*boxH);
  for (let y=0;y<boxH;y++) for (let x=0;x<boxW;x++) {
    let hit=0;
    for (let dy=-R;dy<=R&&!hit;dy++) for (let dx=-R;dx<=R;dx++) {
      let ny=y+dy,nx=x+dx;
      if (ny>=0&&ny<boxH&&nx>=0&&nx<boxW&&src[ny*boxW+nx]){hit=1;break;}
    }
    o[y*boxW+x]=hit;
  }
  return o;
};
const erode = (src) => {
  let o = new Uint8Array(boxW*boxH);
  for (let y=0;y<boxH;y++) for (let x=0;x<boxW;x++) {
    let all=1;
    for (let dy=-R;dy<=R&&all;dy++) for (let dx=-R;dx<=R;dx++) {
      let ny=y+dy,nx=x+dx;
      if (ny<0||ny>=boxH||nx<0||nx>=boxW||!src[ny*boxW+nx]){all=0;break;}
    }
    o[y*boxW+x]=all;
  }
  return o;
};

let closed = erode(dilate(fillMask));
for (let i=0;i<closed.length;i++) if (fillMask[i]) closed[i]=1; 

for (let y=0;y<boxH;y++) for (let x=0;x<boxW;x++)
  if (closed[y*boxW+x]) {
    let i = ((minBoxY+y)*w + (minBoxX+x)) * 4;
    d[i]=bgR; d[i+1]=bgG; d[i+2]=bgB; d[i+3]=255;
  }

let boxHeight = maxBoxY - minBoxY;
  let textY = minBoxY + boxHeight * 0.45; 
  let sumX = 0; let validRows = 0; let scanRange = Math.floor(boxHeight * 0.2);
  
  for(let y = Math.floor(textY - scanRange); y <= Math.floor(textY + scanRange); y++) {
    let firstX = -1, lastX = -1;
    if(y >= 0 && y < h) {
      for(let x = minBoxX; x <= maxBoxX; x++) {
        if(!outsideMask[y*w + x]) { if(firstX === -1) firstX = x; lastX = x; }
      }
      if(firstX !== -1) { sumX += (firstX + lastX) / 2; validRows++; }
    }
  }

  let textX = validRows > 0 ? (sumX / validRows) : ((minBoxX + maxBoxX) / 2);
  return { textX, textY, boxHeight, plateWidth: maxBoxX - minBoxX };
  }; 

  let plates = [];
  seedGroups.forEach(g => {
      let sc = g[Math.floor(g.length / 2)];
      let res = processPlate(sc.x, sc.y);
      if (res) plates.push(res);
  });

  if (plates.length === 0) return;

  plates.sort((a, b) => b.plateWidth - a.plateWidth);
  let main = plates[0];

  ctx.putImageData(imgData, 0, 0);
  let blankedImgData = ctx.getImageData(0, 0, w, h);

  return { blankedImgData, textX: main.textX, textY: main.textY, boxHeight: main.boxHeight };
}

function drawPriceText(ctx, w, h, textStr, info) {
  if (!textStr || textStr.trim() === "") return;
  let { textX, textY, boxHeight } = info;
  
  let priceScale = window.layerState.globalPriceScale !== undefined ? window.layerState.globalPriceScale : 1;
  let fontSize = Math.floor((boxHeight * 0.60) * priceScale); 
  if (fontSize < Math.floor(22 * priceScale)) fontSize = Math.floor(22 * priceScale);

  let isFree = textStr.trim().toUpperCase() === 'FREE';
  let isNumber = !isNaN(textStr.trim()) && textStr.trim() !== '';
  let numStr = textStr.trim(); 
  let symStr = isNumber ? " ₽" : ""; 
  let inOffers = !window.layerState.isBrawlPassMode;
  let priceFontFamily = inOffers ? (window.layerState.offerPriceFont || 'LilitaOneRus') : 'LilitaOneRus';
  let mainColor = isFree ? "#3bf83b" : (inOffers ? (window.layerState.offerPriceColor || "#ffffff") : "#fff");
  let fontNum = `normal ${fontSize}px '${priceFontFamily}', 'Arial Black', Impact, sans-serif`;
  let fontSym = `normal ${Math.max(fontSize - 4, 16)}px 'Rockwell', serif`;

  ctx.font = fontNum; let wNum = ctx.measureText(numStr).width;
  ctx.font = fontSym; let wSym = ctx.measureText(symStr).width;
  let totalW = wNum + wSym;
  let startX = Math.round(textX - totalW / 2); 
  let symStartX = Math.round(startX + wNum);

  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; 
  ctx.lineWidth = Math.max(2, Math.floor(fontSize * 0.075)); 
  ctx.strokeStyle = '#000000'; ctx.lineJoin = 'round';

  let textBaseY = Math.round(textY + fontSize * 0.33);
  let shadowOffset = Math.max(3, Math.floor(fontSize * 0.075) + 1);

  const drawTextParts = (offsetX, offsetY, isFill, color) => {
    ctx.font = fontNum;
    if(isFill) { ctx.fillStyle = color; ctx.fillText(numStr, startX + offsetX, textBaseY + offsetY); }
    else { ctx.strokeText(numStr, startX + offsetX, textBaseY + offsetY); }
    ctx.font = fontSym;
    if(isFill) { ctx.fillStyle = color; ctx.fillText(symStr, symStartX + offsetX, textBaseY + offsetY); }
    else { ctx.strokeText(symStr, symStartX + offsetX, textBaseY + offsetY); }
  };

  drawTextParts(0, shadowOffset, false, ''); drawTextParts(0, shadowOffset, true, '#000000');
  drawTextParts(0, 0, false, ''); drawTextParts(0, 0, true, mainColor);
}

function runMagicLogic(img) {
    const w = img.width; 
    const h = img.height;
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = w; 
    tmpCanvas.height = h;
    const tCtx = tmpCanvas.getContext('2d', { willReadFrequently: true });
    tCtx.drawImage(img, 0, 0);
    
    const imgData = tCtx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const totalPixels = w * h;

    const edges = new Uint8Array(totalPixels);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let idx = y * w + x;
            let i4 = idx * 4;
            
            let r = data[i4], g = data[i4+1], b = data[i4+2];
            let rx = data[i4+4], gx = data[i4+5], bx = data[i4+6];
            let ry = data[i4 + w*4], gy = data[i4 + w*4 + 1], by = data[i4 + w*4 + 2];

            let diffX = Math.max(Math.abs(r-rx), Math.abs(g-gx), Math.abs(b-bx));
            let diffY = Math.max(Math.abs(r-ry), Math.abs(g-gy), Math.abs(b-by));

            let isSharpEdge = Math.max(diffX, diffY) > 40; 
            let maxC = Math.max(r, g, b);
            let minC = Math.min(r, g, b);

            let isBlackBorder = maxC < 95 && (maxC - minC) < 40; 
            let isWhiteBorder = minC > 200 && (maxC - minC) < 20;

            if (isSharpEdge || isBlackBorder || isWhiteBorder) { 
                edges[idx] = 1;
            }
        }
    }

    const solidEdges = new Uint8Array(totalPixels);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let idx = y * w + x;
            if (edges[idx] || 
                edges[idx-1] || edges[idx+1] || 
                edges[idx-w] || edges[idx+w] ||
                edges[idx-w-1] || edges[idx-w+1] || 
                edges[idx+w-1] || edges[idx+w+1]) {
                solidEdges[idx] = 1;
            }
        }
    }

    const bgMask = new Uint8Array(totalPixels);
    const stack = new Int32Array(totalPixels);
    let stackPtr = 0;

    for (let x = 0; x < w; x++) {
        if (!solidEdges[x]) { bgMask[x] = 1; stack[stackPtr++] = x; }
        let bIdx = (h - 1) * w + x;
        if (!solidEdges[bIdx]) { bgMask[bIdx] = 1; stack[stackPtr++] = bIdx; }
    }
    for (let y = 0; y < h; y++) {
        let lIdx = y * w;
        if (!solidEdges[lIdx] && !bgMask[lIdx]) { bgMask[lIdx] = 1; stack[stackPtr++] = lIdx; }
        let rIdx = y * w + w - 1;
        if (!solidEdges[rIdx] && !bgMask[rIdx]) { bgMask[rIdx] = 1; stack[stackPtr++] = rIdx; }
    }

    while (stackPtr > 0) {
        let curr = stack[--stackPtr];
        let cx = curr % w, cy = Math.floor(curr / w);
        if (cx > 0) { let n = curr - 1; if (!solidEdges[n] && !bgMask[n]) { bgMask[n] = 1; stack[stackPtr++] = n; } }
        if (cx < w - 1) { let n = curr + 1; if (!solidEdges[n] && !bgMask[n]) { bgMask[n] = 1; stack[stackPtr++] = n; } }
        if (cy > 0) { let n = curr - w; if (!solidEdges[n] && !bgMask[n]) { bgMask[n] = 1; stack[stackPtr++] = n; } }
        if (cy < h - 1) { let n = curr + w; if (!solidEdges[n] && !bgMask[n]) { bgMask[n] = 1; stack[stackPtr++] = n; } }
    }

    let fgMask = new Uint8Array(totalPixels);
    const labels = new Int32Array(totalPixels);
    let currentLabel = 1;
    const comps = [];

    for (let i = 0; i < totalPixels; i++) {
        if (!bgMask[i] && !labels[i]) {
            let area = 0;
            let minX = w, minY = h, maxX = 0, maxY = 0;
            stackPtr = 0;
            stack[stackPtr++] = i;
            labels[i] = currentLabel;

            while (stackPtr > 0) {
                const curr = stack[--stackPtr];
                area++;
                const cx = curr % w, cy = Math.floor(curr / w);
                
                if (cx < minX) minX = cx;
                if (cx > maxX) maxX = cx;
                if (cy < minY) minY = cy;
                if (cy > maxY) maxY = cy;

                if (cx > 0) { const n = curr - 1; if (!bgMask[n] && !labels[n]) { labels[n] = currentLabel; stack[stackPtr++] = n; } }
                if (cx < w - 1) { const n = curr + 1; if (!bgMask[n] && !labels[n]) { labels[n] = currentLabel; stack[stackPtr++] = n; } }
                if (cy > 0) { const n = curr - w; if (!bgMask[n] && !labels[n]) { labels[n] = currentLabel; stack[stackPtr++] = n; } }
                if (cy < h - 1) { const n = curr + w; if (!bgMask[n] && !labels[n]) { labels[n] = currentLabel; stack[stackPtr++] = n; } }
            }
            comps.push({ label: currentLabel, area, minX, minY, maxX, maxY });
            currentLabel++;
        }
    }

        const runValidation = (strict) => {
        const vl = new Uint8Array(currentLabel + 1);
        for (let i = 0; i < comps.length; i++) {
            const comp = comps[i];
            const compW = comp.maxX - comp.minX;
            const compH = comp.maxY - comp.minY;
            const bboxArea = compW * compH;
            const fillRatio = comp.area / (bboxArea || 1);

            const centerX = comp.minX + compW / 2;
            const centerY = comp.minY + compH / 2;

            const isLeftUI = strict && (centerX < w * 0.18);
            const isTopUI  = strict && (centerY < h * 0.18);

            const tooWide = compW > w * (strict ? 0.72 : 0.99);
            const tooBig  = comp.area > totalPixels * (strict ? 0.45 : 0.98);

            const touchesRightEdge = strict && (comp.maxX >= w - 3);
            const touchesLeftEdge  = strict && (comp.minX <= 2);

            const minArea = totalPixels * (strict ? 0.015 : 0.05);
            const minH    = h * (strict ? 0.25 : 0.40);
            const minFill = strict ? 0.40 : 0.35;

            if (comp.area > minArea &&
                compH > minH &&
                fillRatio > minFill &&
                !isLeftUI &&
                !isTopUI &&
                !tooWide &&
                !tooBig &&
                !touchesRightEdge &&
                !touchesLeftEdge)
            {
                vl[comp.label] = 1;
            }
        }
        return vl;
    };

    let validLabels = runValidation(true);

    let hasValid = false;
    for (let i = 0; i < totalPixels; i++) {
        if (validLabels[labels[i]]) { hasValid = true; break; }
    }

    if (!hasValid) {
        validLabels = runValidation(false);
    }

    hasValid = false;
    for (let i = 0; i < totalPixels; i++) {
        if (validLabels[labels[i]]) {
            fgMask[i] = 1;
            hasValid = true;
        }
    }

    if (!hasValid) { 
        checkBatchCompletion(); 
        return; 
    }

    const integralMask = new Int32Array(totalPixels);
    for (let y = 0; y < h; y++) {
        let sum = 0;
        let rowOffset = y * w;
        let prevRowOffset = (y - 1) * w;
        for (let x = 0; x < w; x++) {
            sum += fgMask[rowOffset + x];
            integralMask[rowOffset + x] = sum + (y > 0 ? integralMask[prevRowOffset + x] : 0);
        }
    }

    let smoothMask = new Uint8Array(totalPixels);
    const R_SMOOTH = 3; 
    const THRESHOLD = 0.55; 

    for (let y = 0; y < h; y++) {
        let rowOffset = y * w;
        for (let x = 0; x < w; x++) {
            let x1 = Math.max(0, x - R_SMOOTH);
            let y1 = Math.max(0, y - R_SMOOTH);
            let x2 = Math.min(w - 1, x + R_SMOOTH);
            let y2 = Math.min(h - 1, y + R_SMOOTH);

            let A = (x1 > 0 && y1 > 0) ? integralMask[(y1 - 1) * w + (x1 - 1)] : 0;
            let B = (y1 > 0) ? integralMask[(y1 - 1) * w + x2] : 0;
            let C = (x1 > 0) ? integralMask[y2 * w + (x1 - 1)] : 0;
            let D = integralMask[y2 * w + x2];

            let area = (x2 - x1 + 1) * (y2 - y1 + 1);
            let sum = D - B - C + A;

            if (sum > area * THRESHOLD) {
                smoothMask[rowOffset + x] = 1;
            }
        }
    }

    const isBlackPixel = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        if (maxC < 130 && (maxC - minC) < 50) {
            isBlackPixel[i] = 1;
        }
    }

    const erodedMask = new Uint8Array(totalPixels);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const idx = y * w + x;
            if (smoothMask[idx] && smoothMask[idx - 1] && smoothMask[idx + 1] &&
                smoothMask[idx - w] && smoothMask[idx + w]) {
                erodedMask[idx] = 1;
            }
        }
    }

    let restoredBlack = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) restoredBlack[i] = erodedMask[i];

    for (let pass = 0; pass < 5; pass++) {
        const tempMask = new Uint8Array(totalPixels);
        for (let i = 0; i < totalPixels; i++) tempMask[i] = restoredBlack[i];

        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                if (isBlackPixel[idx] && !restoredBlack[idx]) {
                    if (restoredBlack[idx - 1] || restoredBlack[idx + 1] ||
                        restoredBlack[idx - w] || restoredBlack[idx + w]) {
                        tempMask[idx] = 1;
                    }
                }
            }
        }
        restoredBlack = tempMask;
    }

    const integralClean = new Int32Array(totalPixels);
    for (let y = 0; y < h; y++) {
        let sum = 0;
        let rowOffset = y * w;
        let prevRowOffset = (y - 1) * w;
        for (let x = 0; x < w; x++) {
            sum += restoredBlack[rowOffset + x];
            integralClean[rowOffset + x] = sum + (y > 0 ? integralClean[prevRowOffset + x] : 0);
        }
    }

    const finalCleanMask = new Uint8Array(totalPixels);
    const R_SMOOTH_2 = 2; 
    for (let y = 0; y < h; y++) {
        let rowOffset = y * w;
        for (let x = 0; x < w; x++) {
            let x1 = Math.max(0, x - R_SMOOTH_2);
            let y1 = Math.max(0, y - R_SMOOTH_2);
            let x2 = Math.min(w - 1, x + R_SMOOTH_2);
            let y2 = Math.min(h - 1, y + R_SMOOTH_2);

            let A = (x1 > 0 && y1 > 0) ? integralClean[(y1 - 1) * w + (x1 - 1)] : 0;
            let B = (y1 > 0) ? integralClean[(y1 - 1) * w + x2] : 0;
            let C = (x1 > 0) ? integralClean[y2 * w + (x1 - 1)] : 0;
            let D = integralClean[y2 * w + x2];

            let area = (x2 - x1 + 1) * (y2 - y1 + 1);
            let sum = D - B - C + A;

            if (sum > area * 0.5) { 
                finalCleanMask[rowOffset + x] = 1;
            }
        }
    }

    const integralAA = new Int32Array(totalPixels);
    for (let y = 0; y < h; y++) {
        let sum = 0;
        let rowOffset = y * w;
        let prevRowOffset = (y - 1) * w;
        for (let x = 0; x < w; x++) {
            sum += finalCleanMask[rowOffset + x]; 
            integralAA[rowOffset + x] = sum + (y > 0 ? integralAA[prevRowOffset + x] : 0);
        }
    }

    const alpha = new Uint8Array(totalPixels);
    const R_AA = 1; 
    for (let y = 0; y < h; y++) {
        let rowOffset = y * w;
        for (let x = 0; x < w; x++) {
            let x1 = Math.max(0, x - R_AA);
            let y1 = Math.max(0, y - R_AA);
            let x2 = Math.min(w - 1, x + R_AA);
            let y2 = Math.min(h - 1, y + R_AA);

            let A = (x1 > 0 && y1 > 0) ? integralAA[(y1 - 1) * w + (x1 - 1)] : 0;
            let B = (y1 > 0) ? integralAA[(y1 - 1) * w + x2] : 0;
            let C = (x1 > 0) ? integralAA[y2 * w + (x1 - 1)] : 0;
            let D = integralAA[y2 * w + x2];

            let area = (x2 - x1 + 1) * (y2 - y1 + 1);
            let sum = D - B - C + A;
            
            alpha[rowOffset + x] = Math.floor((sum / area) * 255);
        }
    }

    for (let i = 0; i < totalPixels; i++) {
        data[i * 4 + 3] = alpha[i];
    }

    const islandIDs = new Int32Array(totalPixels); 
    let currentID = 1;
    const finalIslands = new Map();
    const stackX = new Int32Array(totalPixels); 
    const stackY = new Int32Array(totalPixels);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let i = y * w + x;
            if (data[i * 4 + 3] > 0 && islandIDs[i] === 0) {
                let minX = x, maxX = x, minY = y, maxY = y;
                let stackLen = 0;
                stackX[stackLen] = x; 
                stackY[stackLen] = y; 
                stackLen++;
                islandIDs[i] = currentID;

                while (stackLen > 0) {
                    stackLen--;
                    let cx = stackX[stackLen], cy = stackY[stackLen];
                    if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
                    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;

                    const check = (nx, ny) => {
                        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                            let ni = ny * w + nx;
                            if (data[ni * 4 + 3] > 0 && islandIDs[ni] === 0) {
                                islandIDs[ni] = currentID; 
                                stackX[stackLen] = nx; 
                                stackY[stackLen] = ny; 
                                stackLen++;
                            }
                        }
                    };
                    check(cx + 1, cy); check(cx - 1, cy); check(cx, cy + 1); check(cx, cy - 1);
                }
                
                let objHeight = maxY - minY;
                if (objHeight > h * 0.25) {
                    finalIslands.set(currentID, { minX, maxX, minY, maxY });
                }
                currentID++;
            }
        }
    }

    if (finalIslands.size === 0) { 
        checkBatchCompletion(); 
        return; 
    }

const sortedIslands = Array.from(finalIslands.entries()).sort((a, b) => a[1].minX - b[1].minX);

    sortedIslands.forEach(([id, rect]) => {
        let bottomY = new Int32Array(rect.maxX - rect.minX + 1);
        bottomY.fill(-1);

        for (let x = rect.minX; x <= rect.maxX; x++) {
            for (let y = rect.maxY; y >= rect.minY; y--) {
                if (islandIDs[y * w + x] === id) {
                    bottomY[x - rect.minX] = y;
                    break;
                }
            }
        }

        let cardW = rect.maxX - rect.minX + 1;
        let cardH = rect.maxY - rect.minY;
        let searchStartY = rect.maxY - Math.floor(cardH * 0.15); 
        
        let yFreq = {};
        for (let i = 0; i < bottomY.length; i++) {
            let y = bottomY[i];
            if (y >= searchStartY && y !== -1) {
                yFreq[y] = (yFreq[y] || 0) + 1;
            }
        }

        let validYs = [];
        for (let yStr in yFreq) {
            if (yFreq[yStr] > cardW * 0.10) {
                validYs.push(parseInt(yStr));
            }
        }

        let baselineY = rect.maxY;
        if (validYs.length > 0) {
            baselineY = Math.min(...validYs);
        }

        for (let y = baselineY + 1; y <= rect.maxY; y++) {
            for (let x = rect.minX; x <= rect.maxX; x++) {
                if (islandIDs[y * w + x] === id) {
                    islandIDs[y * w + x] = 0; 
                }
            }
        }

        rect.maxY = baselineY; 

        let margin = 0; 
        let minX = Math.max(0, rect.minX - margin); 
        let minY = Math.max(0, rect.minY - margin);
        let maxX = Math.min(w - 1, rect.maxX + margin); 
        let maxY = Math.min(h - 1, rect.maxY + margin);
        let cW = maxX - minX + 1; 
        let cH = maxY - minY + 1;

        const c = document.createElement('canvas');
        c.width = cW; 
        c.height = cH;
        const cx = c.getContext('2d', { willReadFrequently: true });
        
        const layerData = cx.createImageData(cW, cH);
        const ld = layerData.data;

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                let sourceIdx = y * w + x;
                if (islandIDs[sourceIdx] === id) {
                    let destIdx = ((y - minY) * cW + (x - minX)) * 4;
                    ld[destIdx] = data[sourceIdx * 4];
                    ld[destIdx + 1] = data[sourceIdx * 4 + 1];
                    ld[destIdx + 2] = data[sourceIdx * 4 + 2];
                    ld[destIdx + 3] = data[sourceIdx * 4 + 3];
                }
            }
        }
        cx.putImageData(layerData, 0, 0);

        let eraseResult = autoReplacePrice(cx, cW, cH);
        let drawInfo = eraseResult || {
            blankedImgData: cx.getImageData(0, 0, cW, cH),
            textX: cW / 2, textY: cH - cH * 0.1, boxHeight: Math.max(20, cH * 0.15)
        };

        drawPriceText(cx, cW, cH, "FREE", drawInfo);

        let offerIdx = allGeneratedCards.length;
        let offerObj = { canvas: c, x: minX, y: minY, info: drawInfo };
        
        allGeneratedCards.push(offerObj);
        
        let stateOffer = {
            id: offerIdx,
            visible: true,
            hasStroke: true,
            price: "FREE",
            ref: offerObj,
            anim: { x: null, y: null, w: null, h: null, scale: 0, alpha: 0 },
            target: { x: null, y: null, w: null, h: null, scale: 1, alpha: 1 },
            cache: null
        };
        window.layerState.offers.push(stateOffer);
    });

    checkBatchCompletion();
}

// Удобный единый объект для прямого доступа к вынесенной логике.
window.BrawlStarsOfferExtractor = {
  runMagicLogic,
  autoReplacePrice,
  drawPriceText
};
