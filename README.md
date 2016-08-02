`ajpngasm` is a commandline tool to create AJPNG files. AJPNG is a file format modeled after APNG,
with the difference that in addition to PNG data, frames can contain JPEG and/or JPEG+ALPHA data.

## Installation

`npm i ajpngasm -g`

## Usage

```
$ ajpngasm

  Usage: ajpngasm [options] <png ...>

  Options:

    -h, --help                      output usage information
    -V, --version                   output the version number
    -o, --output <png>              set output file name
    -f, --fps [value]               set frame rate (default: 15)
    -l, --loops [value]             set number of loops to play (default: 0)
    -p, --png-quality [value]       set pngquant quality (default: 16)
    -j, --jpg-quality [value]       set jpeg quality (default: 70)
    -d, --dispose-op [value]        none|background|previous (default: background)
    -b, --blend-op [value]          source|over (default: source)
    -q, --quiet                     do not log anything to stdout
    --default-image-transparent     use transparent default image
    --default-image-exclude         exclude default image from animation
    --slicer-threshold [value]      slicer: color component threshold
    --slicer-margin-top [value]     slicer: top margin
    --slicer-margin-right [value]   slicer: right margin
    --slicer-margin-bottom [value]  slicer: bottom margin
    --slicer-margin-left [value]    slicer: left margin
```

