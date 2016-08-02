#!/usr/bin/env node
"use strict";

var fs = require('fs');
var temp = require('temp');
var options = require('commander');
var createFrames = require('./lib/createFrames');
var createAJPNG = require('./lib/createAJPNG');
var pkg = require('./package.json');

function _parseInt(val, def) {
    const parsedVal = parseInt(val, 10);
    return isNaN(parsedVal) ? def : parsedVal;
}

options
    .version(pkg.version)
    .usage('[options] <png ...>')
    .option('-o, --output <png>', 'output file name')
    .option('-f, --fps [value]', 'frame rate (default: 15)', _parseInt, 15)
    .option('-l, --loops [value]', 'number of loops to play (default: 0)', _parseInt, 0)
    .option('-p, --png-quality [value]', 'pngquant quality (default: 16)', _parseInt, 16)
    .option('-j, --jpg-quality [value]', 'jpeg quality (default: 70)', _parseInt, 70)
    .option('-d, --dispose-op [value]', 'none|background|previous (default: background)', /^(none|background|previous)$/i, 'background')
    .option('-b, --blend-op [value]', 'source|over (default: source)', /^(source|over)$/i, 'source')
    .option('-q, --quiet', 'do not log anything to stdout')
    .option('--default-image-transparent', 'use transparent default image')
    .option('--default-image-exclude', 'exclude default image from animation')
    .option('--slicer-threshold [value]', 'slicer: color component threshold', _parseInt, 0)
    .option('--slicer-margin-top [value]', 'slicer: top margin', _parseInt, 0)
    .option('--slicer-margin-right [value]', 'slicer: right margin', _parseInt, 0)
    .option('--slicer-margin-bottom [value]', 'slicer: bottom margin', _parseInt, 0)
    .option('--slicer-margin-left [value]', 'slicer: left margin', _parseInt, 0)
    .parse(process.argv);

if (options.args.length) {
    var files = options.args.filter(filename => {
        try {
            var stats = fs.statSync(filename);
            return stats.isFile() && stats.size > 0;
        }
        catch(e) { return false; }
    });
    if (files.length) {
        start(files);
    } else {
        console.error('ERROR: No files found.');
        process.exit(1);
    }
} else {
    options.help();
}

function createTempDir() {
    return new Promise((resolve, reject) => {
        temp.track();
        temp.mkdir('ajpngasm', function(err, dirPath) {
            if (err) {
                reject(err);
            } else {
                resolve(dirPath);
            }
        });
    });
}

function start(files) {
    createTempDir().then(dir => {
        createFrames(files, dir, options)
            .then(manifest => {
                createAJPNG(manifest, options)
                    .then(stream => {
                        const wStream = options.output ? fs.createWriteStream(options.output) : process.stdout;
                        stream.pipe(wStream);
                    })
                    .catch(err => {
                        console.error(`ERROR: ${err.message}`);
                        process.exit(1);
                    });
            })
            .catch(err => {
                console.error(`ERROR: ${err.message}`);
                process.exit(1);
            });
    });
}
