/**
 * Brawl Stars offer-card cutting logic extracted from the Snapi source.
 *
 * Pipeline:
 * processImages() -> runMagicLogic()
 *   1. Edge detection
 *   2. Flood fill from image borders
 *   3. Connected-component search
 *   4. Component validation
 *   5. Integral-image box filtering
 *   6. Black-outline restoration
 *   7. Final smoothing and alpha anti-aliasing
 *   8. Island detection
 *   9. Card baseline detection/cropping
 *  10. Separate canvas creation
 *  11. Old price removal and FREE insertion
 *
 * This file contains only the image-processing logic. UI, loaders, project
 * state, rendering panels and layout code from the original application are
 * intentionally not included.
 */

(function attachBrawlStarsCutter(global) {
  'use strict';

  const DEFAULT_OPTIONS = Object.freeze({
    maxFiles: 6,
    replacementPrice: 'FREE',
    priceScale: 1,
    priceFontFamily: 'LilitaOneRus',
    priceColor: '#ffffff',
    freePriceColor: '#3bf83b',
    onProgress: null,
    onCard: null,
  });

  /**
   * Entry point. Processes image Files/Blobs sequentially and returns all cards.
   *
   * @param {File[]|Blob[]|FileList} filesParam
   * @param {object} userOptions
   * @returns {Promise<Array<CutCard>>}
   */
  async function processImages(filesParam, userOptions = {}) {
    const options = { ...DEFAULT_OPTIONS, ...userOptions };
    const files = Array.from(filesParam || []).slice(0, options.maxFiles);
    const allCards = [];

    for (let index = 0; index < files.length; index++) {
      const file = files[index];

      try {
        const img = await loadImage(file);
        const cards = runMagicLogic(img, options);

        for (const card of cards) {
          card.sourceFile = file;
          card.sourceIndex = index;
          allCards.push(card);

          if (typeof options.onCard === 'function') {
            options.onCard(card, allCards.length - 1);
          }
        }
      } finally {
        if (typeof options.onProgress === 'function') {
          options.onProgress({
            processed: index + 1,
            total: files.length,
            cards: allCards.length,
          });
        }
      }
    }

    return allCards;
  }

  /**
   * Loads a File/Blob, URL string, HTMLImageElement, ImageBitmap or canvas.
   */
  function loadImage(source) {
    if (!source) {
      return Promise.reject(new TypeError('Image source is required.'));
    }

    if (
      (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) ||
      (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) ||
      (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap)
    ) {
      return Promise.resolve(source);
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      let objectUrl = null;

      img.onload = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        resolve(img);
      };

      img.onerror = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load image.'));
      };

      if (typeof source === 'string') {
        img.src = source;
      } else if (source instanceof Blob) {
        objectUrl = URL.createObjectURL(source);
        img.src = objectUrl;
      } else {
        reject(new TypeError('Unsupported image source.'));
      }
    });
  }

  /**
   * Performs the complete card extraction pipeline for one screenshot.
   *
   * @param {CanvasImageSource} img
   * @param {object} userOptions
   * @returns {Array<CutCard>}
   */
  function runMagicLogic(img, userOptions = {}) {
    const options = { ...DEFAULT_OPTIONS, ...userOptions };
    const w = img.naturalWidth || img.videoWidth || img.width;
    const h = img.naturalHeight || img.videoHeight || img.height;

    if (!w || !h) {
      throw new Error('The image has invalid dimensions.');
    }

    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = w;
    tmpCanvas.height = h;

    const tCtx = tmpCanvas.getContext('2d', { willReadFrequently: true });
    if (!tCtx) throw new Error('2D canvas context is unavailable.');

    tCtx.drawImage(img, 0, 0, w, h);

    const imgData = tCtx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const totalPixels = w * h;

    // ---------------------------------------------------------------------
    // 1. EDGE DETECTION
    // ---------------------------------------------------------------------
    const edges = new Uint8Array(totalPixels);

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const i4 = idx * 4;

        const r = data[i4];
        const g = data[i4 + 1];
        const b = data[i4 + 2];

        const rx = data[i4 + 4];
        const gx = data[i4 + 5];
        const bx = data[i4 + 6];

        const ry = data[i4 + w * 4];
        const gy = data[i4 + w * 4 + 1];
        const by = data[i4 + w * 4 + 2];

        const diffX = Math.max(
          Math.abs(r - rx),
          Math.abs(g - gx),
          Math.abs(b - bx),
        );

        const diffY = Math.max(
          Math.abs(r - ry),
          Math.abs(g - gy),
          Math.abs(b - by),
        );

        const isSharpEdge = Math.max(diffX, diffY) > 40;
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const isBlackBorder = maxC < 95 && maxC - minC < 40;
        const isWhiteBorder = minC > 200 && maxC - minC < 20;

        if (isSharpEdge || isBlackBorder || isWhiteBorder) {
          edges[idx] = 1;
        }
      }
    }

    // Expand edges by one pixel in all directions to close small gaps.
    const solidEdges = new Uint8Array(totalPixels);

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;

        if (
          edges[idx] ||
          edges[idx - 1] ||
          edges[idx + 1] ||
          edges[idx - w] ||
          edges[idx + w] ||
          edges[idx - w - 1] ||
          edges[idx - w + 1] ||
          edges[idx + w - 1] ||
          edges[idx + w + 1]
        ) {
          solidEdges[idx] = 1;
        }
      }
    }

    // ---------------------------------------------------------------------
    // 2. FLOOD FILL OF THE BACKGROUND FROM ALL SCREEN EDGES
    // ---------------------------------------------------------------------
    const bgMask = new Uint8Array(totalPixels);
    const stack = new Int32Array(totalPixels);
    let stackPtr = 0;

    for (let x = 0; x < w; x++) {
      if (!solidEdges[x]) {
        bgMask[x] = 1;
        stack[stackPtr++] = x;
      }

      const bottomIndex = (h - 1) * w + x;
      if (!solidEdges[bottomIndex] && !bgMask[bottomIndex]) {
        bgMask[bottomIndex] = 1;
        stack[stackPtr++] = bottomIndex;
      }
    }

    for (let y = 0; y < h; y++) {
      const leftIndex = y * w;
      if (!solidEdges[leftIndex] && !bgMask[leftIndex]) {
        bgMask[leftIndex] = 1;
        stack[stackPtr++] = leftIndex;
      }

      const rightIndex = y * w + w - 1;
      if (!solidEdges[rightIndex] && !bgMask[rightIndex]) {
        bgMask[rightIndex] = 1;
        stack[stackPtr++] = rightIndex;
      }
    }

    while (stackPtr > 0) {
      const curr = stack[--stackPtr];
      const cx = curr % w;
      const cy = Math.floor(curr / w);

      if (cx > 0) {
        const next = curr - 1;
        if (!solidEdges[next] && !bgMask[next]) {
          bgMask[next] = 1;
          stack[stackPtr++] = next;
        }
      }

      if (cx < w - 1) {
        const next = curr + 1;
        if (!solidEdges[next] && !bgMask[next]) {
          bgMask[next] = 1;
          stack[stackPtr++] = next;
        }
      }

      if (cy > 0) {
        const next = curr - w;
        if (!solidEdges[next] && !bgMask[next]) {
          bgMask[next] = 1;
          stack[stackPtr++] = next;
        }
      }

      if (cy < h - 1) {
        const next = curr + w;
        if (!solidEdges[next] && !bgMask[next]) {
          bgMask[next] = 1;
          stack[stackPtr++] = next;
        }
      }
    }

    // ---------------------------------------------------------------------
    // 3. CONNECTED COMPONENTS: POTENTIAL OFFER CARDS
    // ---------------------------------------------------------------------
    const fgMask = new Uint8Array(totalPixels);
    const labels = new Int32Array(totalPixels);
    let currentLabel = 1;
    const components = [];

    for (let i = 0; i < totalPixels; i++) {
      if (bgMask[i] || labels[i]) continue;

      let area = 0;
      let minX = w;
      let minY = h;
      let maxX = 0;
      let maxY = 0;

      stackPtr = 0;
      stack[stackPtr++] = i;
      labels[i] = currentLabel;

      while (stackPtr > 0) {
        const curr = stack[--stackPtr];
        const cx = curr % w;
        const cy = Math.floor(curr / w);
        area++;

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        if (cx > 0) {
          const next = curr - 1;
          if (!bgMask[next] && !labels[next]) {
            labels[next] = currentLabel;
            stack[stackPtr++] = next;
          }
        }

        if (cx < w - 1) {
          const next = curr + 1;
          if (!bgMask[next] && !labels[next]) {
            labels[next] = currentLabel;
            stack[stackPtr++] = next;
          }
        }

        if (cy > 0) {
          const next = curr - w;
          if (!bgMask[next] && !labels[next]) {
            labels[next] = currentLabel;
            stack[stackPtr++] = next;
          }
        }

        if (cy < h - 1) {
          const next = curr + w;
          if (!bgMask[next] && !labels[next]) {
            labels[next] = currentLabel;
            stack[stackPtr++] = next;
          }
        }
      }

      components.push({
        label: currentLabel,
        area,
        minX,
        minY,
        maxX,
        maxY,
      });

      currentLabel++;
    }

    // ---------------------------------------------------------------------
    // 4. COMPONENT VALIDATION
    // ---------------------------------------------------------------------
    const runValidation = (strict) => {
      const validLabels = new Uint8Array(currentLabel + 1);

      for (const component of components) {
        const compW = component.maxX - component.minX;
        const compH = component.maxY - component.minY;
        const bboxArea = compW * compH;
        const fillRatio = component.area / (bboxArea || 1);
        const centerX = component.minX + compW / 2;
        const centerY = component.minY + compH / 2;

        const isLeftUI = strict && centerX < w * 0.18;
        const isTopUI = strict && centerY < h * 0.18;
        const tooWide = compW > w * (strict ? 0.72 : 0.99);
        const tooBig = component.area > totalPixels * (strict ? 0.45 : 0.98);
        const touchesRightEdge = strict && component.maxX >= w - 3;
        const touchesLeftEdge = strict && component.minX <= 2;
        const minArea = totalPixels * (strict ? 0.015 : 0.05);
        const minH = h * (strict ? 0.25 : 0.40);
        const minFill = strict ? 0.40 : 0.35;

        if (
          component.area > minArea &&
          compH > minH &&
          fillRatio > minFill &&
          !isLeftUI &&
          !isTopUI &&
          !tooWide &&
          !tooBig &&
          !touchesRightEdge &&
          !touchesLeftEdge
        ) {
          validLabels[component.label] = 1;
        }
      }

      return validLabels;
    };

    let validLabels = runValidation(true);
    let hasValid = false;

    for (let i = 0; i < totalPixels; i++) {
      if (validLabels[labels[i]]) {
        hasValid = true;
        break;
      }
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

    if (!hasValid) return [];

    // ---------------------------------------------------------------------
    // 5. FIRST MASK SMOOTHING: BOX FILTER VIA INTEGRAL IMAGE
    // ---------------------------------------------------------------------
    const integralMask = createIntegralImage(fgMask, w, h);
  const smoothMask = thresholdBoxFilter(
    integralMask,
    w,
    h,
    3,
    0.45,
  );

    // ---------------------------------------------------------------------
    // 6. RESTORE BLACK CARD OUTLINES
    // ---------------------------------------------------------------------
    const isBlackPixel = new Uint8Array(totalPixels);

    for (let i = 0; i < totalPixels; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);

      if (maxC < 130 && maxC - minC < 50) {
        isBlackPixel[i] = 1;
      }
    }

    let restoredBlack = smoothMask.slice();

    for (let pass = 0; pass < 5; pass++) {
      const tempMask = restoredBlack.slice();

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = y * w + x;

          if (
            isBlackPixel[idx] &&
            !restoredBlack[idx] &&
            (
              restoredBlack[idx - 1] ||
              restoredBlack[idx + 1] ||
              restoredBlack[idx - w] ||
              restoredBlack[idx + w]
            )
          ) {
            tempMask[idx] = 1;
          }
        }
      }

      restoredBlack = tempMask;
    }

    // ---------------------------------------------------------------------
    // 7. FINAL SMOOTHING + ALPHA ANTI-ALIASING
    // ---------------------------------------------------------------------
    const integralClean = createIntegralImage(restoredBlack, w, h);
    const finalCleanMask = thresholdBoxFilter(
      integralClean,
      w,
      h,
      1,
      0.5,
    );

    const integralAA = createIntegralImage(finalCleanMask, w, h);
    const alpha = alphaBoxFilter(
      integralAA,
      finalCleanMask,
      w,
      h,
      1,
    );

    for (let i = 0; i < totalPixels; i++) {
      data[i * 4 + 3] = alpha[i];
    }

    // ---------------------------------------------------------------------
    // 8. SPLIT THE RESULT INTO SEPARATE ISLANDS
    // ---------------------------------------------------------------------
    const islandIDs = new Int32Array(totalPixels);
    const stackX = new Int32Array(totalPixels);
    const stackY = new Int32Array(totalPixels);
    const finalIslands = new Map();
    let currentID = 1;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const index = y * w + x;

        if (data[index * 4 + 3] === 0 || islandIDs[index] !== 0) {
          continue;
        }

        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;
        let stackLength = 0;

        stackX[stackLength] = x;
        stackY[stackLength] = y;
        stackLength++;
        islandIDs[index] = currentID;

        while (stackLength > 0) {
          stackLength--;
          const cx = stackX[stackLength];
          const cy = stackY[stackLength];

          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          const addNeighbour = (nx, ny) => {
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) return;

            const neighbourIndex = ny * w + nx;
            if (
              data[neighbourIndex * 4 + 3] > 0 &&
              islandIDs[neighbourIndex] === 0
            ) {
              islandIDs[neighbourIndex] = currentID;
              stackX[stackLength] = nx;
              stackY[stackLength] = ny;
              stackLength++;
            }
          };

          addNeighbour(cx + 1, cy);
          addNeighbour(cx - 1, cy);
          addNeighbour(cx, cy + 1);
          addNeighbour(cx, cy - 1);
        }

        const objectHeight = maxY - minY;
        if (objectHeight > h * 0.25) {
          finalIslands.set(currentID, { minX, maxX, minY, maxY });
        }

        currentID++;
      }
    }

    if (finalIslands.size === 0) return [];

    const sortedIslands = Array.from(finalIslands.entries()).sort(
      (a, b) => a[1].minX - b[1].minX,
    );

    const cards = [];

    for (const [id, rect] of sortedIslands) {
      // -------------------------------------------------------------------
      // 9. DETECT THE CARD BASELINE AND CUT OFF THE LOWER "BASEMENT"
      // -------------------------------------------------------------------
      const bottomY = new Int32Array(rect.maxX - rect.minX + 1);
      bottomY.fill(-1);

      for (let x = rect.minX; x <= rect.maxX; x++) {
        for (let y = rect.maxY; y >= rect.minY; y--) {
          if (islandIDs[y * w + x] === id) {
            bottomY[x - rect.minX] = y;
            break;
          }
        }
      }

      const cardW = rect.maxX - rect.minX + 1;
      const cardH = rect.maxY - rect.minY;
      const searchStartY = rect.maxY - Math.floor(cardH * 0.15);
      const yFrequency = new Map();

      for (let i = 0; i < bottomY.length; i++) {
        const y = bottomY[i];
        if (y >= searchStartY && y !== -1) {
          yFrequency.set(y, (yFrequency.get(y) || 0) + 1);
        }
      }

      const validYs = [];
      for (const [y, frequency] of yFrequency.entries()) {
        if (frequency > cardW * 0.10) {
          validYs.push(y);
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

      // -------------------------------------------------------------------
      // 10. CREATE AN INDIVIDUAL CANVAS FOR THIS CARD
      // -------------------------------------------------------------------
      const margin = 0;
      const minX = Math.max(0, rect.minX - margin);
      const minY = Math.max(0, rect.minY - margin);
      const maxX = Math.min(w - 1, rect.maxX + margin);
      const maxY = Math.min(h - 1, rect.maxY + margin);
      const canvasWidth = maxX - minX + 1;
      const canvasHeight = maxY - minY + 1;

      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) continue;

      const layerData = ctx.createImageData(canvasWidth, canvasHeight);
      const destination = layerData.data;

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const sourceIndex = y * w + x;
          if (islandIDs[sourceIndex] !== id) continue;

          const destinationIndex =
            ((y - minY) * canvasWidth + (x - minX)) * 4;
          const sourceOffset = sourceIndex * 4;

          destination[destinationIndex] = data[sourceOffset];
          destination[destinationIndex + 1] = data[sourceOffset + 1];
          destination[destinationIndex + 2] = data[sourceOffset + 2];
          destination[destinationIndex + 3] = data[sourceOffset + 3];
        }
      }

      ctx.putImageData(layerData, 0, 0);

      // -------------------------------------------------------------------
      // 11. REMOVE THE OLD PRICE AND DRAW FREE
      // -------------------------------------------------------------------
      const eraseResult = autoReplacePrice(
        ctx,
        canvasWidth,
        canvasHeight,
      );

      // Если корректная нижняя ценовая плашка не найдена, это не акция.
      // Например, карточка «ПОДАРОК» имеет количество предметов, но не цену.
      // Такую карточку полностью исключаем из результата.
      if (!eraseResult) {
        continue;
      }

      drawPriceText(
        ctx,
        canvasWidth,
        canvasHeight,
        options.replacementPrice,
        eraseResult,
        options,
      );

      const styledCard = addCardOutlineAndShadow(canvas);

      cards.push({
        canvas: styledCard.canvas,

        x: minX,
        y: minY,

        // Размер вместе с обводкой и тенью — только для отрисовки.
        renderWidth: styledCard.canvas.width,
        renderHeight: styledCard.canvas.height,

        // Размер самой акции — для расположения и раздвигания.
        width: canvasWidth,
        height: canvasHeight,

        effectPadding: styledCard.padding,

        info: eraseResult,
        price: eraseResult ? options.replacementPrice : null,
      });
    }

    return cards;
  }

  /**
   * Detects the price plate, fills over the old text using the plate's own
   * colour, and returns coordinates for drawing the replacement price.
   */
  function autoReplacePrice(ctx, w, h) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const seedCandidates = [];
    const scanColumns = [
      0.40,
      0.45,
      0.50,
      0.55,
      0.60,
      0.65,
      0.70,
      0.75,
      0.80,
      0.85,
    ];

    for (const fraction of scanColumns) {
      const seedX = Math.floor(w * fraction);
      let seedY = h - Math.max(3, Math.floor(h * 0.02));

      while (seedY > h * 0.55) {
        const offset = (seedY * w + seedX) * 4;
        const r = d[offset];
        const g = d[offset + 1];
        const b = d[offset + 2];
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);

        if (
          d[offset + 3] > 200 &&
          maxC > 160 &&
          maxC - minC > 60
        ) {
          seedCandidates.push({
            x: seedX,
            y: Math.max(0, seedY - 15),
          });
          break;
        }

        seedY--;
      }
    }

    if (seedCandidates.length === 0) return null;

    seedCandidates.sort((a, b) => a.x - b.x);
    const seedGroups = [];

    for (const candidate of seedCandidates) {
      const lastGroup = seedGroups[seedGroups.length - 1];

      if (
        lastGroup &&
        candidate.x - lastGroup[lastGroup.length - 1].x < w * 0.12
      ) {
        lastGroup.push(candidate);
      } else {
        seedGroups.push([candidate]);
      }
    }

    const processPlate = (seedX, seedY) => {
      const colours = new Map();

      for (let y = seedY - 20; y <= seedY + 20; y++) {
        for (let x = seedX - 20; x <= seedX + 20; x++) {
          if (x < 0 || x >= w || y < 0 || y >= h) continue;

          const offset = (y * w + x) * 4;
          if (d[offset + 3] <= 100) continue;

          const r = d[offset];
          const g = d[offset + 1];
          const b = d[offset + 2];
          if (r <= 60 && g <= 60 && b <= 60) continue;

          const key = `${Math.round(r / 10) * 10},${Math.round(g / 10) * 10},${Math.round(b / 10) * 10}`;
          colours.set(key, (colours.get(key) || 0) + 1);
        }
      }

      let dominantKey = '';
      let dominantCount = 0;

      for (const [key, count] of colours.entries()) {
        if (count > dominantCount) {
          dominantKey = key;
          dominantCount = count;
        }
      }

      if (!dominantKey) return null;

      const [quantizedR, quantizedG, quantizedB] = dominantKey
        .split(',')
        .map(Number);

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;

      for (let y = seedY - 20; y <= seedY + 20; y++) {
        for (let x = seedX - 20; x <= seedX + 20; x++) {
          if (x < 0 || x >= w || y < 0 || y >= h) continue;

          const offset = (y * w + x) * 4;
          if (d[offset + 3] <= 100) continue;

          const r = d[offset];
          const g = d[offset + 1];
          const b = d[offset + 2];

          if (
            Math.abs(r - quantizedR) < 15 &&
            Math.abs(g - quantizedG) < 15 &&
            Math.abs(b - quantizedB) < 15
          ) {
            sumR += r;
            sumG += g;
            sumB += b;
            count++;
          }
        }
      }

      if (count === 0) return null;

      const bgR = Math.round(sumR / count);
      const bgG = Math.round(sumG / count);
      const bgB = Math.round(sumB / count);

      const isBackgroundPixel = (x, y) => {
        if (x < 0 || x >= w || y < 0 || y >= h) return false;
        if (seedY - y > h * 0.45) return false;

        const offset = (y * w + x) * 4;
        if (d[offset + 3] < 128) return false;
        if (d[offset] < 70 && d[offset + 1] < 70 && d[offset + 2] < 70) {
          return false;
        }

        return (
          Math.abs(d[offset] - bgR) < 25 &&
          Math.abs(d[offset + 1] - bgG) < 25 &&
          Math.abs(d[offset + 2] - bgB) < 25
        );
      };

      const plateMask = new Uint8Array(w * h);
      let floodX = [seedX];
      let floodY = [seedY];

      if (!isBackgroundPixel(seedX, seedY)) {
        let found = false;

        for (let radius = 1; radius <= 25 && !found; radius++) {
          for (let dy = -radius; dy <= radius && !found; dy++) {
            for (let dx = -radius; dx <= radius && !found; dx++) {
              if (isBackgroundPixel(seedX + dx, seedY + dy)) {
                floodX = [seedX + dx];
                floodY = [seedY + dy];
                found = true;
              }
            }
          }
        }

        if (!found) return null;
      }

      let head = 0;

      while (head < floodX.length) {
        const x = floodX[head];
        const y = floodY[head];
        head++;

        const index = y * w + x;
        if (plateMask[index]) continue;
        plateMask[index] = 1;

        if (
          x + 1 < w &&
          !plateMask[index + 1] &&
          isBackgroundPixel(x + 1, y)
        ) {
          floodX.push(x + 1);
          floodY.push(y);
        }

        if (
          x - 1 >= 0 &&
          !plateMask[index - 1] &&
          isBackgroundPixel(x - 1, y)
        ) {
          floodX.push(x - 1);
          floodY.push(y);
        }

        if (
          y + 1 < h &&
          !plateMask[index + w] &&
          isBackgroundPixel(x, y + 1)
        ) {
          floodX.push(x);
          floodY.push(y + 1);
        }

        if (
          y - 1 >= 0 &&
          !plateMask[index - w] &&
          isBackgroundPixel(x, y - 1)
        ) {
          floodX.push(x);
          floodY.push(y - 1);
        }
      }

      let minBoxX = w;
      let maxBoxX = 0;
      let minBoxY = h;
      let maxBoxY = 0;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!plateMask[y * w + x]) continue;

          if (x < minBoxX) minBoxX = x;
          if (x > maxBoxX) maxBoxX = x;
          if (y < minBoxY) minBoxY = y;
          if (y > maxBoxY) maxBoxY = y;
        }
      }

      if (minBoxX === w) return null;

      const detectedWidth = maxBoxX - minBoxX;
      const detectedHeight = maxBoxY - minBoxY;
      const plateAspectRatio = detectedWidth / Math.max(1, detectedHeight);
      const plateCenterY = (minBoxY + maxBoxY) / 2;

      // Настоящая область цены находится в нижней части карточки и имеет
      // горизонтальную форму. У подарков алгоритм раньше принимал за цену
      // большую жёлтую область внутри карточки, из-за чего поверх неё
      // появлялась огромная надпись FREE.
      const isValidPricePlate =
        detectedWidth >= w * 0.25 &&
        detectedHeight >= h * 0.04 &&
        detectedHeight <= h * 0.22 &&
        plateAspectRatio >= 1.65 &&
        plateCenterY >= h * 0.68 &&
        maxBoxY >= h * 0.76;

      if (!isValidPricePlate) {
        return null;
      }

      // Flood-fill the outside around the plate. Everything enclosed by that
      // outside region is treated as the plate/text region to overwrite.
      const outsideMask = new Uint8Array(w * h);
      const outsideX = [];
      const outsideY = [];
      const expand = 5;
      const regionMinX = Math.max(0, minBoxX - expand);
      const regionMaxX = Math.min(w - 1, maxBoxX + expand);
      const regionMinY = Math.max(0, minBoxY - expand);
      const regionMaxY = Math.min(h - 1, maxBoxY + expand);

      const addOutsideSeed = (x, y) => {
        const index = y * w + x;
        if (!plateMask[index] && !outsideMask[index]) {
          outsideMask[index] = 1;
          outsideX.push(x);
          outsideY.push(y);
        }
      };

      for (let x = regionMinX; x <= regionMaxX; x++) {
        addOutsideSeed(x, regionMinY);
        addOutsideSeed(x, regionMaxY);
      }

      for (let y = regionMinY; y <= regionMaxY; y++) {
        addOutsideSeed(regionMinX, y);
        addOutsideSeed(regionMaxX, y);
      }

      let outsideHead = 0;

      while (outsideHead < outsideX.length) {
        const x = outsideX[outsideHead];
        const y = outsideY[outsideHead];
        outsideHead++;

        const tryOutside = (nx, ny) => {
          if (
            nx < regionMinX ||
            nx > regionMaxX ||
            ny < regionMinY ||
            ny > regionMaxY
          ) {
            return;
          }

          const index = ny * w + nx;
          if (!outsideMask[index] && !plateMask[index]) {
            outsideMask[index] = 1;
            outsideX.push(nx);
            outsideY.push(ny);
          }
        };

        tryOutside(x + 1, y);
        tryOutside(x - 1, y);
        tryOutside(x, y + 1);
        tryOutside(x, y - 1);
      }

      const boxWidth = maxBoxX - minBoxX + 1;
      const boxHeight = maxBoxY - minBoxY + 1;
      const radius = Math.max(4, Math.round(boxHeight * 0.18));
      const fillMask = new Uint8Array(boxWidth * boxHeight);

      for (let y = 0; y < boxHeight; y++) {
        for (let x = 0; x < boxWidth; x++) {
          if (!outsideMask[(minBoxY + y) * w + minBoxX + x]) {
            fillMask[y * boxWidth + x] = 1;
          }
        }
      }

      const dilate = (source) => {
        const output = new Uint8Array(boxWidth * boxHeight);

        for (let y = 0; y < boxHeight; y++) {
          for (let x = 0; x < boxWidth; x++) {
            let hit = 0;

            for (let dy = -radius; dy <= radius && !hit; dy++) {
              for (let dx = -radius; dx <= radius; dx++) {
                const ny = y + dy;
                const nx = x + dx;

                if (
                  ny >= 0 &&
                  ny < boxHeight &&
                  nx >= 0 &&
                  nx < boxWidth &&
                  source[ny * boxWidth + nx]
                ) {
                  hit = 1;
                  break;
                }
              }
            }

            output[y * boxWidth + x] = hit;
          }
        }

        return output;
      };

      const erode = (source) => {
        const output = new Uint8Array(boxWidth * boxHeight);

        for (let y = 0; y < boxHeight; y++) {
          for (let x = 0; x < boxWidth; x++) {
            let all = 1;

            for (let dy = -radius; dy <= radius && all; dy++) {
              for (let dx = -radius; dx <= radius; dx++) {
                const ny = y + dy;
                const nx = x + dx;

                if (
                  ny < 0 ||
                  ny >= boxHeight ||
                  nx < 0 ||
                  nx >= boxWidth ||
                  !source[ny * boxWidth + nx]
                ) {
                  all = 0;
                  break;
                }
              }
            }

            output[y * boxWidth + x] = all;
          }
        }

        return output;
      };

      const closed = erode(dilate(fillMask));

      for (let i = 0; i < closed.length; i++) {
        if (fillMask[i]) closed[i] = 1;
      }

      for (let y = 0; y < boxHeight; y++) {
        for (let x = 0; x < boxWidth; x++) {
          if (!closed[y * boxWidth + x]) continue;

          const offset = ((minBoxY + y) * w + minBoxX + x) * 4;
          d[offset] = bgR;
          d[offset + 1] = bgG;
          d[offset + 2] = bgB;
          d[offset + 3] = 255;
        }
      }

      const plateHeight = maxBoxY - minBoxY;
      const textY = minBoxY + plateHeight * 0.45;
      const scanRange = Math.floor(plateHeight * 0.2);
      let sumX = 0;
      let validRows = 0;

      for (
        let y = Math.floor(textY - scanRange);
        y <= Math.floor(textY + scanRange);
        y++
      ) {
        if (y < 0 || y >= h) continue;

        let firstX = -1;
        let lastX = -1;

        for (let x = minBoxX; x <= maxBoxX; x++) {
          if (!outsideMask[y * w + x]) {
            if (firstX === -1) firstX = x;
            lastX = x;
          }
        }

        if (firstX !== -1) {
          sumX += (firstX + lastX) / 2;
          validRows++;
        }
      }

      const textX =
        validRows > 0
          ? sumX / validRows
          : (minBoxX + maxBoxX) / 2;

      return {
        textX,
        textY,
        boxHeight: plateHeight,
        plateWidth: maxBoxX - minBoxX,
      };
    };

    const plates = [];

    for (const group of seedGroups) {
      const candidate = group[Math.floor(group.length / 2)];
      const result = processPlate(candidate.x, candidate.y);
      if (result) plates.push(result);
    }

    if (plates.length === 0) return null;

    plates.sort((a, b) => b.plateWidth - a.plateWidth);
    const mainPlate = plates[0];

    ctx.putImageData(imgData, 0, 0);
    const blankedImgData = ctx.getImageData(0, 0, w, h);

    return {
      blankedImgData,
      textX: mainPlate.textX,
      textY: mainPlate.textY,
      boxHeight: mainPlate.boxHeight,
    };
  }

  /** Draws the replacement price in the same style as the original code. */
  function drawPriceText(
    ctx,
    w,
    h,
    textStr,
    info,
    userOptions = {},
  ) {
    if (!textStr || textStr.trim() === '') return;

    const options = { ...DEFAULT_OPTIONS, ...userOptions };
    const { textX, textY, boxHeight } = info;
    const priceScale = Number.isFinite(options.priceScale)
      ? options.priceScale
      : 1;

    let fontSize = Math.floor(boxHeight * 0.60 * priceScale);
    fontSize = Math.max(fontSize, Math.floor(22 * priceScale));

    const normalizedText = textStr.trim();
    const isFree = normalizedText.toUpperCase() === 'FREE';
    const isNumber = normalizedText !== '' && !Number.isNaN(Number(normalizedText));
    const numberText = normalizedText;
    const symbolText = isNumber ? ' ₽' : '';
    const mainColour = isFree
      ? options.freePriceColor
      : options.priceColor;

    const numberFont =
      `normal ${fontSize}px '${isFree ? 'LilitaOneRus' : options.priceFontFamily}'`;
    const symbolFont =
      `normal ${Math.max(fontSize - 4, 16)}px 'Rockwell', serif`;

    ctx.font = numberFont;
    const numberWidth = ctx.measureText(numberText).width;
    ctx.font = symbolFont;
    const symbolWidth = ctx.measureText(symbolText).width;

    const totalWidth = numberWidth + symbolWidth;
    const startX = Math.round(textX - totalWidth / 2);
    const symbolStartX = Math.round(startX + numberWidth);
    const textBaseY = Math.round(textY + fontSize * 0.33);
    const shadowOffset = Math.max(3, Math.floor(fontSize * 0.075) + 1);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = Math.max(2, Math.floor(fontSize * 0.075));
    ctx.strokeStyle = '#000000';
    ctx.lineJoin = 'round';

    const drawTextParts = (offsetX, offsetY, fill, colour) => {
      ctx.font = numberFont;

      if (fill) {
        ctx.fillStyle = colour;
        ctx.fillText(numberText, startX + offsetX, textBaseY + offsetY);
      } else {
        ctx.strokeText(numberText, startX + offsetX, textBaseY + offsetY);
      }

      ctx.font = symbolFont;

      if (fill) {
        ctx.fillStyle = colour;
        ctx.fillText(symbolText, symbolStartX + offsetX, textBaseY + offsetY);
      } else {
        ctx.strokeText(symbolText, symbolStartX + offsetX, textBaseY + offsetY);
      }
    };

    drawTextParts(0, shadowOffset, false, '');
    drawTextParts(0, shadowOffset, true, '#000000');
    drawTextParts(0, 0, false, '');
    drawTextParts(0, 0, true, mainColour);
  }

  function addCardOutlineAndShadow(sourceCanvas) {
  const outlineSize = 4;
  const shadowBlur = 6;
  const shadowOffsetY = 26;
  const padding = outlineSize + shadowBlur + Math.abs(shadowOffsetY) + 2;

  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = sourceCanvas.width + padding * 2;
  resultCanvas.height = sourceCanvas.height + padding * 2;

  const resultCtx = resultCanvas.getContext('2d');
  const silhouetteCanvas = document.createElement('canvas');
  silhouetteCanvas.width = sourceCanvas.width;
  silhouetteCanvas.height = sourceCanvas.height;

  const silhouetteCtx = silhouetteCanvas.getContext('2d');

  // Создаём полностью белый силуэт акции.
  silhouetteCtx.drawImage(sourceCanvas, 0, 0);
  silhouetteCtx.globalCompositeOperation = 'source-in';
  silhouetteCtx.fillStyle = '#ffffff';
  silhouetteCtx.fillRect(
    0,
    0,
    silhouetteCanvas.width,
    silhouetteCanvas.height,
  );
  silhouetteCtx.globalCompositeOperation = 'source-over';

  // Чёрная размытая тень.
  resultCtx.save();
  resultCtx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  resultCtx.shadowBlur = shadowBlur;
  resultCtx.shadowOffsetX = 0;
  resultCtx.shadowOffsetY = shadowOffsetY;
  resultCtx.drawImage(silhouetteCanvas, padding, padding);
  resultCtx.restore();

  // Белая обводка толщиной 3 px вокруг прозрачного силуэта.
  for (let y = -outlineSize; y <= outlineSize; y++) {
    for (let x = -outlineSize; x <= outlineSize; x++) {
      if (x * x + y * y > outlineSize * outlineSize) continue;

      resultCtx.drawImage(
        silhouetteCanvas,
        padding + x,
        padding + y,
      );
    }
  }

  // Сама акция поверх обводки и тени.
  resultCtx.drawImage(sourceCanvas, padding, padding);

  return {
    canvas: resultCanvas,
    padding,
  };
}

function createIntegralImage(mask, w, h) {
    const integral = new Int32Array(w * h);

    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      const rowOffset = y * w;
      const previousRowOffset = (y - 1) * w;

      for (let x = 0; x < w; x++) {
        rowSum += mask[rowOffset + x];
        integral[rowOffset + x] =
          rowSum + (y > 0 ? integral[previousRowOffset + x] : 0);
      }
    }

    return integral;
  }

  function getIntegralArea(integral, w, x1, y1, x2, y2) {
    const a =
      x1 > 0 && y1 > 0
        ? integral[(y1 - 1) * w + x1 - 1]
        : 0;
    const b = y1 > 0 ? integral[(y1 - 1) * w + x2] : 0;
    const c = x1 > 0 ? integral[y2 * w + x1 - 1] : 0;
    const d = integral[y2 * w + x2];

    return d - b - c + a;
  }

  function thresholdBoxFilter(integral, w, h, radius, threshold) {
    const output = new Uint8Array(w * h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const x1 = Math.max(0, x - radius);
        const y1 = Math.max(0, y - radius);
        const x2 = Math.min(w - 1, x + radius);
        const y2 = Math.min(h - 1, y + radius);
        const area = (x2 - x1 + 1) * (y2 - y1 + 1);
        const sum = getIntegralArea(integral, w, x1, y1, x2, y2);

        if (sum > area * threshold) {
          output[y * w + x] = 1;
        }
      }
    }

    return output;
  }

function alphaBoxFilter(integral, mask, w, h, radius) {
  const alpha = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = y * w + x;

      if (!mask[index]) {
        alpha[index] = 0;
        continue;
      }

      const x1 = Math.max(0, x - radius);
      const y1 = Math.max(0, y - radius);
      const x2 = Math.min(w - 1, x + radius);
      const y2 = Math.min(h - 1, y + radius);
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum = getIntegralArea(integral, w, x1, y1, x2, y2);
      const coverage = sum / area;

      alpha[index] =
        coverage >= 0.99
          ? 255
          : Math.max(140, Math.round(coverage * 255));
    }
  }

  return alpha;
}

  /**
   * @typedef {object} CutCard
   * @property {HTMLCanvasElement} canvas
   * @property {number} x Original screenshot X coordinate
   * @property {number} y Original screenshot Y coordinate
   * @property {number} width
   * @property {number} height
   * @property {object} info Price replacement metadata
   * @property {string} price
   */

  const api = Object.freeze({
    processImages,
    runMagicLogic,
    autoReplacePrice,
    drawPriceText,
    loadImage,
  });

  global.BrawlStarsCutter = api;

  // Preserve the requested entry-point names for direct integration.
  if (!global.processImages) global.processImages = processImages;
  if (!global.runMagicLogic) global.runMagicLogic = runMagicLogic;
  if (!global.autoReplacePrice) global.autoReplacePrice = autoReplacePrice;
  if (!global.drawPriceText) global.drawPriceText = drawPriceText;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
