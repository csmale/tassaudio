# tassaudio
Create 4-channel Audio files using Tass algorithm for Parkinsons therapy

## Installation

    npm install -g

## Usage
Usage: tassaudio [options]

Options:

    --debug                     Enable debug mode
    -q, --quiet                 Quiet mode
    -o, --out <value>           Output file (default: out_<time>.out)
    --duration <value>          Duration in deconds (default: 60)
    --max-amplitude <value>     Maximum amplitude (default: 32760)
    --sample-frequency <value>  Sample frequency (default: 22050)
    --jitter <value>            Jitter in percent (default: 23.5)
    --use-side-channels         Use Side L/R instead of Rear L/R (default: false)
    -6, --sixchan               Produce 5.1 channel output instead of 4.0 (C and LFE are silent)
    --intro <value>             Add introductory channel map check of N seconds on each channel
    -h, --help                  display help for command
