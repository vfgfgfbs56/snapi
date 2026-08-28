/**

Snapi Color Correction



Использование:



await SnapiColorCorrection.apply(persistentCanvas);



или:



await applySnapiColorCorrection(persistentCanvas);
*/

(function (global) {
'use strict';

const DEFAULTS = Object.freeze({
    contrast: 1.06,
    brightness: 1.03,
    vibrance: 0.41,

    splitWarm: 10,
    splitCool: 10,

    vignette: 0.16,
    vignettePow: 2.4,

    centerDark: 0.16,
    centerRadius: 0.71,

    bloomThresh: 231,
    bloomAmount: 0.21,
    bloomBlur: 14,

    highpass: 0.31,
    highpassBlur: 2.2,

    grainAmount: 8
});

let blurCanvas = null;
let bloomCanvas = null;


function getTargetCanvas(canvas) {

    if (canvas && canvas.getContext) {
        return canvas;
    }

    // Если canvas не передан,
    // пытаемся взять persistentCanvas из Snapi
    if (
        typeof persistentCanvas !== 'undefined' &&
        persistentCanvas &&
        persistentCanvas.getContext
    ) {
        return persistentCanvas;
    }

    throw new Error('Canvas для цветокоррекции не найден.');
}


async function apply(canvas, options = {}) {

    const target = getTargetCanvas(canvas);

    if (!target.width || !target.height) {
        throw new Error('Холст пуст.');
    }

    const cfg = {
        ...DEFAULTS,
        ...options
    };

    const w = target.width;
    const h = target.height;

    const ctx = target.getContext('2d');


    const {
        contrast,
        brightness,
        vibrance,

        splitWarm,
        splitCool,

        vignette,
        vignettePow,

        centerDark,
        centerRadius,

        bloomThresh,
        bloomAmount,
        bloomBlur,

        highpass,
        highpassBlur,

        grainAmount
    } = cfg;


    /*
     * Получаем пиксели изображения
     */

    let imgData = ctx.getImageData(
        0,
        0,
        w,
        h
    );

    let d = imgData.data;


    /*
     * Определяем, насколько изображение
     * уже тёплое
     */

    let aR = 0;
    let aB = 0;
    let samp = 0;

    for (let i = 0; i < d.length; i += 64) {

        aR += d[i];

        aB += d[i + 2];

        samp++;
    }


    const warmBias =
        samp > 0
            ? ((aR - aB) / samp) / 255
            : 0;


    const warmMul =
        1 - Math.max(
            0,
            warmBias
        ) * 0.6;


    const coolMul =
        1 + Math.max(
            0,
            warmBias
        ) * 0.4;



    /*
     * Размытая копия изображения
     * для high-pass резкости
     */

    if (!blurCanvas) {
        blurCanvas =
            document.createElement('canvas');
    }


    blurCanvas.width = w;
    blurCanvas.height = h;


    const blurCtx =
        blurCanvas.getContext('2d');


    blurCtx.clearRect(
        0,
        0,
        w,
        h
    );


    blurCtx.filter =
        `blur(${highpassBlur}px)`;


    blurCtx.drawImage(
        target,
        0,
        0
    );


    blurCtx.filter = 'none';


    const blur =
        blurCtx.getImageData(
            0,
            0,
            w,
            h
        ).data;



    /*
     * Центр изображения
     * нужен для виньетки
     */

    const cx = w / 2;
    const cy = h / 2;


    const maxDist =
        Math.sqrt(
            cx * cx +
            cy * cy
        );



    /*
     * Основная обработка
     */

    for (let y = 0; y < h; y++) {

        const dy = y - cy;


        for (let x = 0; x < w; x++) {

            const i =
                (y * w + x) * 4;


            let r = d[i];

            let g =
                d[i + 1];

            let b =
                d[i + 2];



            /*
             * Яркость
             */

            r *= brightness;

            g *= brightness;

            b *= brightness;



            /*
             * Контраст
             */

            r =
                (r - 128) *
                contrast +
                128;


            g =
                (g - 128) *
                contrast +
                128;


            b =
                (b - 128) *
                contrast +
                128;



            /*
             * Vibrance
             *
             * Менее насыщенные цвета
             * усиливаются сильнее
             */

            const mx =
                Math.max(
                    r,
                    g,
                    b
                );


            const mn =
                Math.min(
                    r,
                    g,
                    b
                );


            const avg =
                (
                    r +
                    g +
                    b
                ) / 3;


            const curSat =
                (mx - mn) /
                255;


            const amt =
                1 +
                vibrance *
                (
                    1 -
                    curSat
                );


            r =
                avg +
                (
                    r -
                    avg
                ) *
                amt;


            g =
                avg +
                (
                    g -
                    avg
                ) *
                amt;


            b =
                avg +
                (
                    b -
                    avg
                ) *
                amt;



            /*
             * Яркость пикселя
             */

            const lum =
                (
                    0.299 * r +
                    0.587 * g +
                    0.114 * b
                ) /
                255;


            const hi = lum;

            const lo =
                1 -
                lum;



            /*
             * Split toning
             *
             * Света теплее,
             * тени холоднее
             */

            r +=
                splitWarm *
                hi *
                warmMul
                -
                splitCool *
                lo *
                0.2;


            b +=
                splitCool *
                lo *
                coolMul
                -
                splitWarm *
                hi *
                0.2;


            g +=
                splitWarm *
                hi *
                warmMul *
                0.15;



            /*
             * High-pass резкость
             */

            r +=
                (
                    r -
                    blur[i]
                ) *
                highpass;


            g +=
                (
                    g -
                    blur[i + 1]
                ) *
                highpass;


            b +=
                (
                    b -
                    blur[i + 2]
                ) *
                highpass;



            /*
             * Виньетка
             */

            const dx =
                x -
                cx;


            const dist =
                Math.sqrt(
                    dx * dx +
                    dy * dy
                ) /
                maxDist;


            const vig =
                1 -
                vignette *
                Math.pow(
                    dist,
                    vignettePow
                );



            /*
             * Дополнительное
             * затемнение краёв
             */

            const sp =
                dist >
                centerRadius

                    ? 1 -
                      centerDark *
                      Math.pow(
                          (
                              dist -
                              centerRadius
                          ) /
                          (
                              1 -
                              centerRadius
                          ),
                          2
                      )

                    : 1;


            const dark =
                vig *
                sp;


            r *= dark;

            g *= dark;

            b *= dark;



            /*
             * Зерно
             */

            if (
                grainAmount >
                0
            ) {

                const n =
                    (
                        Math.random() -
                        0.5
                    ) *
                    grainAmount;


                r += n;

                g += n;

                b += n;
            }



            /*
             * Ограничиваем RGB
             * диапазоном 0-255
             */

            d[i] =
                r < 0
                    ? 0
                    : r > 255
                        ? 255
                        : r;


            d[i + 1] =
                g < 0
                    ? 0
                    : g > 255
                        ? 255
                        : g;


            d[i + 2] =
                b < 0
                    ? 0
                    : b > 255
                        ? 255
                        : b;


            /*
             * Альфа:
             *
             * d[i + 3]
             *
             * не меняется
             */
        }
    }


    /*
     * Возвращаем обработанные
     * пиксели на canvas
     */

    ctx.putImageData(
        imgData,
        0,
        0
    );



    /*
     * BLOOM
     *
     * Мягкое свечение
     * самых ярких частей
     */

    if (
        bloomAmount >
        0
    ) {

        if (!bloomCanvas) {

            bloomCanvas =
                document.createElement(
                    'canvas'
                );
        }


        bloomCanvas.width =
            w;


        bloomCanvas.height =
            h;


        const bloomCtx =
            bloomCanvas.getContext(
                '2d'
            );


        bloomCtx.clearRect(
            0,
            0,
            w,
            h
        );


        bloomCtx.drawImage(
            target,
            0,
            0
        );



        const bloomData =
            bloomCtx.getImageData(
                0,
                0,
                w,
                h
            );


        const bpx =
            bloomData.data;



        /*
         * Оставляем только
         * очень светлые пиксели
         */

        for (
            let i = 0;
            i < bpx.length;
            i += 4
        ) {

            const l =
                0.299 *
                bpx[i]
                +
                0.587 *
                bpx[i + 1]
                +
                0.114 *
                bpx[i + 2];


            if (
                l <
                bloomThresh
            ) {

                bpx[i] = 0;

                bpx[i + 1] = 0;

                bpx[i + 2] = 0;
            }
        }


        bloomCtx.putImageData(
            bloomData,
            0,
            0
        );



        /*
         * Добавляем свечение
         * через screen
         */

        ctx.save();


        ctx.globalCompositeOperation =
            'screen';


        ctx.globalAlpha =
            bloomAmount;


        ctx.filter =
            `blur(${bloomBlur}px)`;


        ctx.drawImage(
            bloomCanvas,
            0,
            0
        );


        ctx.filter =
            'none';


        ctx.restore();
    }



    /*
     * Возвращаем тот же canvas
     * после обработки
     */

    return target;
}



/*
 * Основной API
 */

global.SnapiColorCorrection =
    Object.freeze({

        apply,

        defaults:
            DEFAULTS
    });



/*
 * Короткий вариант вызова
 */

global.applySnapiColorCorrection =
    apply;

})(window);