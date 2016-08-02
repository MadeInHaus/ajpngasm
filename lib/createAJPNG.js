"use strict";

var _ = require('lodash');
var PNG = require('pngjs').PNG;
var fs = require('fs');
var util = require('util');
var zlib = require('zlib');
var Readable = require('stream').Readable;
var Filter = require('./vendor/filter');
var CrcStream = require('./vendor/crc');
var constants = require('./constants');

module.exports = function createAJPNG(manifest, options) {

    function loadManifest(manifest) {
        return new Promise((resolve, reject) => {
            if (_.isString(manifest)) {
                fs.readFile(manifest, { encoding: 'utf8' }, (err, res) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(JSON.parse(res));
                    }
                });
            } else {
                resolve(_.cloneDeep(manifest));
            }
        });
    }

    function getDefaultImageData(manifest) {
        return new Promise((resolve, reject) => {
            if (options.defaultImageTransparent) {
                manifest.defaultImageData = new Buffer(manifest.width * manifest.height * 4);
                manifest.defaultImageData.fill(0);
                resolve(manifest);
            } else {
                fs.createReadStream(manifest.frames[0].png)
                    .pipe(new PNG())
                    .on('parsed', function () {
                        manifest.defaultImageData = this.data;
                        resolve(manifest);
                    })
                    .on('error', err => {
                        reject(err);
                    });
            }
        });
    }

    function encodeAJPNG(manifest) {
        var encoder = new AJPNGEncoder(manifest, options);
        return new Promise((resolve, reject) => {
            resolve(encoder);
        });
    }

    return loadManifest(manifest)
            .then(getDefaultImageData)
            .then(encodeAJPNG);
};

var AJPNGEncoder = function(manifest, options) {
    if (!(this instanceof AJPNGEncoder)) return new AJPNGEncoder(manifest, options);
    this._manifest = manifest;
    this._options = options;
    this._fctlCount = 0;
    this._frameNr = 0;
    this._state = AJPNGEncoder.STATE_HEADER;
    Readable.call(this, {});
};

util.inherits(AJPNGEncoder, Readable);

AJPNGEncoder.STATE_HEADER = 'STATE_HEADER';
AJPNGEncoder.STATE_DEFAULT_IMAGE = 'STATE_DEFAULT_IMAGE';
AJPNGEncoder.STATE_FRAMES = 'STATE_FRAMES';

AJPNGEncoder.prototype._read = function(size) {
    const manifest = this._manifest;
    const options = this._options;
    switch (this._state) {
        case AJPNGEncoder.STATE_HEADER:
            const numFrames = manifest.frames.length - (options.defaultImageExclude ? 1 : 0) + (options.defaultImageTransparent ? 1 : 0);
            const numLoops = options.loops;
            this.push(new Buffer(constants.PNG_SIGNATURE));
            this.push(this._packIHDR(manifest.width, manifest.height));
            this.push(this._pack_acTL(false, numFrames, numLoops));
            this._state = AJPNGEncoder.STATE_DEFAULT_IMAGE;
            break;
        case AJPNGEncoder.STATE_DEFAULT_IMAGE:
            this._pushDefaultImage();
            this._frameNr = options.defaultImageTransparent ? 0 : 1;
            this._state = AJPNGEncoder.STATE_FRAMES;
            break;
        case AJPNGEncoder.STATE_FRAMES:
            if (this._frameNr < manifest.frames.length) {
                this._pushFrame();
            } else {
                this.push(this._packIEND());
                this.push(null);
            }
            break;
    }
};

AJPNGEncoder.prototype._pushDefaultImage = function() {
    const manifest = this._manifest;
    const options = this._options;
    if (!options.defaultImageExclude) {
        const frame = manifest.frames[0];
        this.push(this._pack_fcTL(
            false,
            this._fctlCount++,
            manifest.width,
            manifest.height,
            0,
            0,
            frame.delayNom,
            frame.delayDenom,
            frame.disposeOp,
            frame.blendOp
        ));
    }
    // filter pixel data
    const filter = new Filter(manifest.width, manifest.height, 4, manifest.defaultImageData, {});
    const data = filter.filter();
    // compress it
    this.push(this._packIDAT(zlib.deflateSync(data, {
        chunkSize: 32 * 1024,
        level: 9,
        strategy: 3,
    })));
};

AJPNGEncoder.prototype._pushFrame = function() {
    const frame = this._manifest.frames[this._frameNr++];
    // write fcTL (frame control chunk)
    this.push(this._pack_fcTL(
        false,
        this._fctlCount++,
        frame.width,
        frame.height,
        frame.x,
        frame.y,
        frame.delayNom,
        frame.delayDenom,
        frame.disposeOp,
        frame.blendOp
    ));
    // write fdAT (frame data chunk)
    var bufRGB = fs.readFileSync(frame.jpg);
    var bufAlpha = frame.contentType === 'jpeg+alpha' ? fs.readFileSync(frame.png) : null;
    this.push(this._pack_fdAT(
        false,
        this._fctlCount++,
        bufRGB,
        bufAlpha
    ));
};

AJPNGEncoder.prototype._packChunk = function(type, data) {
    const len = (data ? data.length : 0);
    const buf = new Buffer(len + 12);

    buf.writeUInt32BE(len, 0);
    buf.writeUInt32BE(type, 4);

    if (data) {
        data.copy(buf, 8);
    }

    buf.writeInt32BE(CrcStream.crc32(buf.slice(4, buf.length - 4)), buf.length - 4);
    return buf;
};

AJPNGEncoder.prototype._packIHDR = function(width, height) {
    const buf = new Buffer(13);
    buf.writeUInt32BE(width, 0);
    buf.writeUInt32BE(height, 4);
    buf[8] = 8;
    buf[9] = 6; // colorType
    buf[10] = 0; // compression
    buf[11] = 0; // filter
    buf[12] = 0; // interlace
    //console.log('write IHDR', buf.length);
    return this._packChunk(constants.TYPE_IHDR, buf);
};

AJPNGEncoder.prototype._packIDAT = function(data) {
    //console.log('write IDAT', data.length);
    return this._packChunk(constants.TYPE_IDAT, data);
};

AJPNGEncoder.prototype._packIEND = function() {
    //console.log('write IEND', 0);
    return this._packChunk(constants.TYPE_IEND, null);
};

AJPNGEncoder.prototype._pack_acTL = function(isAPNG, numFrames, numPlays) {
    const buf = new Buffer(isAPNG ? 8 : 10);
    buf.writeUInt32BE(numFrames, 0);
    buf.writeUInt32BE(numPlays, 4);
    if (isAPNG) {
        return this._packChunk(constants.TYPE_acTL, buf);
    } else {
        buf.writeUInt8(1, 8);
        buf.writeUInt8(1, 9);
        //console.log('write acTL', buf.length);
        return this._packChunk(constants.TYPE_acTV, buf);
    }
};

AJPNGEncoder.prototype._pack_fcTL = function(isAPNG, seqNr, width, height, x, y, delayNum, delayDenum, disposeOp, blendOp) {
    const buf = new Buffer(26);
    buf.writeUInt32BE(seqNr, 0);
    buf.writeUInt32BE(width, 4);
    buf.writeUInt32BE(height, 8);
    buf.writeUInt32BE(x, 12);
    buf.writeUInt32BE(y, 16);
    buf.writeUInt16BE(delayNum, 20);
    buf.writeUInt16BE(delayDenum, 22);
    buf.writeUInt8(disposeOp, 24);
    buf.writeUInt8(blendOp, 25);
    if (isAPNG) {
        //console.log('write fcTL', buf.length);
        return this._packChunk(constants.TYPE_fcTL, buf);
    } else {
        //console.log('write fcTV', buf.length);
        return this._packChunk(constants.TYPE_fcTV, buf);
    }
};

AJPNGEncoder.prototype._pack_fdAT = function(isAPNG, seqNr, bufRGB, bufAlpha) {
    let buf;
    if (isAPNG) {
        buf = new Buffer(4 + bufRGB.length);
        buf.writeUInt32BE(seqNr, 0);
        bufRGB.copy(buf, 4);
        //console.log('write fdAT', buf.length);
        return this._packChunk(constants.TYPE_fdAT, buf);
    } else {
        if (bufAlpha) {
            buf = new Buffer(8 + bufRGB.length + bufAlpha.length);
            buf.writeUInt32BE(seqNr, 0);
            buf.writeUInt32BE(bufRGB.length, 4);
            bufRGB.copy(buf, 8);
            bufAlpha.copy(buf, 8 + bufRGB.length);
        } else {
            buf = new Buffer(8 + bufRGB.length);
            buf.writeUInt32BE(seqNr, 0);
            buf.writeUInt32BE(0, 4);
            bufRGB.copy(buf, 8);
        }
        //console.log('write fdAV', buf.length);
        return this._packChunk(constants.TYPE_fdAV, buf);
    }
};
