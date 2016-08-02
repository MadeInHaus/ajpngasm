"use strict";

var _ = require('lodash');
var PNG = require('pngjs').PNG;
var PNGQuant = require('pngquant');
var JPG = require('jpg-stream/encoder');
var streamifier = require('streamifier');
var fs = require('fs');
var path = require('path');
var diff = require('./diff');

function parseDisposeOp(disposeOp) {
    switch (disposeOp) {
        case 'none': return 0;
        case 'background': return 1;
        case 'previous': return 2;
    }
    return 1;
}

function parseBlendOp(blendOp) {
    switch (blendOp) {
        case 'source': return 0;
        case 'over': return 1;
    }
    return 0;
}

module.exports = function createFramesNew(files, dir, options) {

    return new Promise((resolve, reject) => {

        function getNextPNG(data) {
            return new Promise((resolve, reject) => {
                (function _getNextPNG() {
                    if (files.length === 0) {
                        reject(null);
                        return;
                    }
                    var filename = files.shift();
                    var stream = fs.createReadStream(filename);
                    var png = new PNG();
                    stream
                        .pipe(png)
                        .on('parsed', function () {
                            stream.removeAllListeners();
                            if (!data.manifest.width && !data.manifest.height) {
                                data.manifest.width = this.width;
                                data.manifest.height = this.height;
                            }
                            if (data.currPNG && (data.currPNG.width !== this.width || data.currPNG.height !== this.height)) {
                                !options.quiet && console.log('[%s] %dx%d, skipped (size mismatch)', filename, this.width, this.height);
                                setImmediate(_getNextPNG);
                            } else {
                                resolve(_.assign(data, {
                                    prevPNG: data.currPNG,
                                    prevFilename: data.currFilename,
                                }, {
                                    currPNG: this,
                                    currFilename: filename,
                                }));
                            }
                        })
                        .on('error', err => {
                            stream.removeAllListeners();
                            stream.destroy();
                            !options.quiet && console.log(`[${filename}] skipped (${err.message}):`);
                            setImmediate(_getNextPNG);
                        });
                })();
            });
        }

        function diffPNG(data) {
            return new Promise((resolve, reject) => {
                if (data.manifest.frames.length === 0 && !options.defaultImageTransparent) {
                    data.diff = {
                        isDefaultImage: true,
                    };
                } else {
                    var prevPNG = (options.disposeOp === 'previous') ? data.prevPNG : null;
                    data.diff = diff(data.currPNG, prevPNG, options);
                }
                resolve(data);
            });
        }

        function slicePNG(data) {
            return new Promise((resolve, reject) => {
                const frames = data.manifest.frames;
                if (data.diff.isDefaultImage) {
                    frames.push({
                        x: 0,
                        y: 0,
                        width: data.currPNG.width,
                        height: data.currPNG.height,
                        png: path.resolve(process.cwd(), data.currFilename),
                        disposeOp: parseDisposeOp(options.disposeOp),
                        blendOp: parseBlendOp(options.blendOp),
                        delayDenom: options.fps,
                        delayNom: 1,
                        isDefaultImage: true,
                    });
                    resolve(data);
                } else if (data.diff.isEmpty) {
                    if (frames.length === 0) {
                        reject(new Error(`First frame can't be empty (${data.currFilename})`));
                    } else {
                        frames[frames.length - 1].delayNom += 1;
                        !options.quiet && console.log('[%s] %dx%d, skipped (empty diff)', data.currFilename, data.currPNG.width, data.currPNG.height);
                        resolve(data);
                    }
                } else {
                    const diff = data.diff;
                    const image = data.currPNG;
                    const slice = new Buffer(4 * diff.width * diff.height);
                    let j = 0;
                    data.currHasAlpha = false;
                    for (let y = diff.y; y < diff.y + diff.height; y++) {
                        const offs = y * image.width * 4;
                        for (let x = diff.x; x < diff.x + diff.width; x++) {
                            const i = offs + x * 4;
                            const a = image.data[i + 3];
                            slice[j++] = image.data[i];
                            slice[j++] = image.data[i + 1];
                            slice[j++] = image.data[i + 2];
                            slice[j++] = a;
                            if (a !== 255) {
                                data.currHasAlpha = true;
                            }
                        }
                    }

                    var frame = {
                        contentType: data.currHasAlpha ? 'jpeg+alpha' : 'jpeg',
                        x: diff.x,
                        y: diff.y,
                        width: diff.width,
                        height: diff.height,
                        disposeOp: parseDisposeOp(options.disposeOp),
                        blendOp: parseBlendOp(options.blendOp),
                        delayDenom: options.fps,
                        delayNom: 1,
                    };

                    const sliceLen = slice.length;
                    const sliceJPG = new Buffer(sliceLen * 3 / 4);
                    for (let i = 0, j = 0; i < sliceLen; i += 4) {
                        // copy rgb channels to JPG buffer (premultiply, discard alpha channel)
                        const a = slice[i + 3] / 255;
                        sliceJPG[j++] = slice[i] * a;
                        sliceJPG[j++] = slice[i + 1] * a;
                        sliceJPG[j++] = slice[i + 2] * a;
                        if (data.currHasAlpha) {
                            // set buffer's rgb channels to black
                            slice[i] = 0;
                            slice[i + 1] = 0;
                            slice[i + 2] = 0;
                        }
                    }

                    let count = 1;
                    function handleFinish() {
                        if (--count === 0) {
                            frames.push(frame);
                            resolve(data);
                        }
                    }

                    const file = path.resolve(dir, `frame_${frames.length}`);
                    if (data.currHasAlpha) {
                        // encode and write PNG
                        count++;
                        frame.png = file + '.png';
                        const png = new PNG({ width: diff.width, height: diff.height });
                        slice.copy(png.data);

                        png.pack()
                            .pipe(new PNGQuant([ options.pngQuality ]))
                            .pipe(fs.createWriteStream(frame.png))
                            .on('finish', handleFinish)
                            .on('error', reject);
                    }

                    // encode and write JPG
                    frame.jpg = file + '.jpg';
                    streamifier.createReadStream(sliceJPG)
                        .pipe(new JPG(diff.width, diff.height, { quality: options.jpgQuality }))
                        .pipe(fs.createWriteStream(frame.jpg))
                        .on('finish', handleFinish)
                        .on('error', reject);
                }
            });
        }

        function saveManifest(data) {
            return new Promise((resolve, reject) => {
                fs.writeFile(path.resolve(dir, 'manifest.json'), JSON.stringify(data.manifest, null, 2), err => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(data);
                    }
                });
            });
        }

        function loop(data) {
            getNextPNG(data)
                .then(diffPNG)
                .then(slicePNG)
                .then(saveManifest)
                .then(data => {
                    if (!data.diff.isDefaultImage) {
                        !options.quiet && console.log(
                            '[%s] %dx%d, %dx%d, %d/%d, %s',
                            data.currFilename,
                            data.currPNG.width, data.currPNG.height,
                            data.diff.width, data.diff.height,
                            data.diff.x, data.diff.y,
                            data.currHasAlpha ? 'transparent' : 'opaque'
                        );
                    } else {
                        !options.quiet && console.log(
                            '[%s] %dx%d, default image',
                            data.currFilename,
                            data.currPNG.width, data.currPNG.height
                        );
                    }
                    delete data.diff;
                    delete data.currHasAlpha;
                    setImmediate(loop, data);
                })
                .catch(err => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(data.manifest);
                    }
                });
        }

        loop({
            manifest: {
                frames: []
            }
        });

    });
}
