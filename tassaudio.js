#!/usr/bin/node

/*
 * Program to produce 4-channel WAV file for use with vibrotactile gloves in the treatment of Parkinson's Disease
 * Described in: Coordinated Reset Vibrotactile Stimulation Induces Sustained Cumulative Benefits in Parkinson’s Disease
 * (Pfeifer KJ et al.)
 * https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8055937/
 * 
 * Pfeifer KJ, Kromer JA, Cook AJ, Hornbeck T, Lim EA, Mortimer BJP, Fogarty AS, Han SS, Dhall R, Halpern CH, Tass PA.
 * Coordinated Reset Vibrotactile Stimulation Induces Sustained Cumulative Benefits in Parkinson's Disease.
 * Front Physiol. 2021 Apr 6;12:624317. doi: 10.3389/fphys.2021.624317. PMID: 33889086; PMCID: PMC8055937.
 * 
 * https://healthunlocked.com/cure-parkinsons/posts/148836810/tass-vibrating-gloves-diy-hacks-ideas-prototypes...
 * 
 */

// argument parsing
const commander = require('commander');
const Command = commander.Command;
const program = new Command();

// file system access
const fs = require('fs');
const path = require('path');

program
    .option('--debug', 'Enable debug mode')
    .option('-q, --quiet', 'Quiet mode')
    .option('-o, --out <value>', 'Output file', '')
    .option('--duration <value>', 'Duration in deconds', 60)
    .option('--max-amplitude <value>', 'Maximum amplitude', 32760)
    .option('--sample-frequency <value>', 'Sample frequency', 22050)
    .option('--jitter <value>', 'Jitter in percent', 23.5)
    .option('--use-side-channels', 'Use Side L/R instead of Rear L/R', false)
    .option('-6, --sixchan', 'Produce 6-channel (5.1) output instead of quad (4.0)', false)
    .option('--intro <value>', 'Add introductory channel map check of N seconds', 0)
    .parse();

const opts = program.opts();

const debug = opts.debug;
const quiet = opts.quiet;

// file size per hour:
// 22050 samples, 2 bytes = 44100 bytes/sec per finger
// 44100*3600 = 158760000 bytes per finger per hour (around 150MB)
// 600MB per hour for 4 fingers
// 2400MB for 4 hours

/*
 * Configuration parameters - User level
 */
const sampleFrequency = parseInt(opts.sampleFrequency);  // 22050 probably ok?
if(isNaN(sampleFrequency) || (sampleFrequency < 1000) || (sampleFrequency > 44100)) {
    console.log('Sample frequency must be a number between 1000 and 44100.');
    program.help();
}
const jitterPct = parseFloat(opts.jitter) / 100.0;        // fraction, so 0.235 means 23.5%, or around 20ms
if(isNaN(jitterPct) || (jitterPct < 0.0) || (jitterPct > 0.235)) {
    console.log('Jitter must be a number between 0 and 23.5.');
    program.help();
}
const intro = parseInt(opts.intro);        // number of seconds of intro per finger
if(isNaN(intro) || (intro < 0) || (intro > 30)) {
    console.log('Intro must be a number between 0 and 30.');
    program.help();
}
// file names
var fOut = opts.out; // output file name
if(fOut.length == 0) {
    const dNow = new Date();
    let iYear = dNow.getFullYear();
    let iMonth = (dNow.getMonth() + 1).toString().padStart(2,'0');
    let iDay = dNow.getDate().toString().padStart(2,'0');
    let iHour = dNow.getHours().toString().padStart(2,'0');
    let iMins = dNow.getMinutes().toString().padStart(2,'0');
    let iSecs = dNow.getSeconds().toString().padStart(2,'0');

    var fName = `out_${iYear}${iMonth}${iDay}${iHour}${iMins}${iSecs}`;
    fOut = `${fName}.wav`;
}
if(path.extname(fOut) != '.wav')
    fOut += ".wav";
var fLog = fOut.replace(/.wav$/, '.log');         // log file name

const targetDuration = parseInt(opts.duration);     // length of output file in seconds
if(isNaN(targetDuration) || (targetDuration < 1) || (targetDuration > 14400)) {
    console.log('Duration must be a number between 1 and 14400 (4 hours).');
    program.help();
}
const maxAmp = parseInt(opts.maxAmplitude);           // peak sample amplitude - must be less than 32767
if(isNaN(maxAmp) || (maxAmp < 1) || (maxAmp > 32767)) {
    console.log('Amplitude must be a number between 1 and 32767.');
    program.help();
}
const useSideChannels = opts.useSideChannels;
const sixChan = opts.sixchan;

if(!quiet) {
    console.log(`Sample freq : ${sampleFrequency} Hz`);
    console.log(`Jitter      : ${jitterPct*100}%`);
    console.log(`Output file : ${fOut}`);
    console.log(`Log file    : ${fLog}`);
    console.log(`Duration    : ${targetDuration} s`);
    console.log(`Amplitude   : ${maxAmp}`);
    console.log(`Side chans  : ${useSideChannels}`);
    console.log(`Output chans: ${sixChan?"5.1":"4.0"}`);
    console.log(`Intro length: ${intro} seconds per finger`)
}


/*
 * Configuration parameters - Tass algorithm
 */
const fBase = 250;      // Base tone frequency, 250Hz
const fCR = 1.5;        // Frequency base, 1.5Hz
const tTone = 0.1;      // Length of tone, 0.1s = 100ms
const nBlocksON = 3;    // bars of tones in a phrase
const nBlocksOFF = 2;   // bars of silence between phrases
const nFingers = sixChan?6:4;     // number of fingers = number of channels in output file

/*
 * Derived values
 */
const tCR = 1/fCR;      // bar length in seconds
const tCR4 = tCR/4;     // tick length in seconds - not sure what happens if nFingers != 4
const jMax = jitterPct * tCR4;
                        // maximum jitter, difference between earliest and latest

/*
 * Technical stuff
 */
const tone = createSine(fBase, tTone, sampleFrequency);
                        // create basic sine wave for use in each note
const sequences = [
    [1,2,3,4],[1,2,4,3],[1,3,2,4],[1,3,4,2],
    [1,4,2,3],[1,4,3,2],[2,1,3,4],[2,1,4,3],
    [2,3,1,4],[2,3,4,1],[2,4,1,3],[2,4,3,1],
    [3,1,2,4],[3,1,4,2],[3,2,1,4],[3,2,4,1],
    [3,4,1,2],[3,4,2,1],[4,1,2,3],[4,1,3,2],
    [4,2,1,3],[4,2,3,1],[4,3,1,2],[4,3,2,1]];
                        // 24 possible sequences of 4 fingers
/*
 * WAV file constants
 */

const WAVE_FORMAT_PCM	            = 1; // PCM
const WAVE_FORMAT_IEEE_FLOAT        = 3; //	IEEE float
const WAVE_FORMAT_ALAW              = 6; //	8-bit ITU-T G.711 A-law
const WAVE_FORMAT_MULAW             = 7; //	8-bit ITU-T G.711 µ-law
const WAVE_FORMAT_EXTENSIBLE        = 0xfffe; //	Determined by SubFormat

const SPEAKER_FRONT_LEFT	        = 0x1;
const SPEAKER_FRONT_RIGHT	        = 0x2;
const SPEAKER_FRONT_CENTER	        = 0x4;
const SPEAKER_LOW_FREQUENCY	        = 0x8;
const SPEAKER_BACK_LEFT	            = 0x10;
const SPEAKER_BACK_RIGHT	        = 0x20;
const SPEAKER_FRONT_LEFT_OF_CENTER	= 0x40;
const SPEAKER_FRONT_RIGHT_OF_CENTER	= 0x80;
const SPEAKER_BACK_CENTER	        = 0x100;
const SPEAKER_SIDE_LEFT	            = 0x200;
const SPEAKER_SIDE_RIGHT	        = 0x400;
const SPEAKER_TOP_CENTER	        = 0x800;
const SPEAKER_TOP_FRONT_LEFT	    = 0x1000;
const SPEAKER_TOP_FRONT_CENTER	    = 0x2000;
const SPEAKER_TOP_FRONT_RIGHT	    = 0x4000;
const SPEAKER_TOP_BACK_LEFT         = 0x8000;
const SPEAKER_TOP_BACK_CENTER	    = 0x10000;
const SPEAKER_TOP_BACK_RIGHT	    = 0x20000;

/*
 * output buffers
 * for each finger we have a large Array
 * for the actual output we use a large ArrayBuffer, with a DataView on it so we can poke
 * little-endian 16-bit integers in where we want
 */
var aOut = [];
var aOutptr = [];
// nFingers+2 to account for the empty centre and LF channels in 6-channel mode
for(i=0; i<nFingers+(sixChan?2:0); i++) {
    aOut.push(new Array(100000)); // size in elements. we will put numbers in here (int16)
    aOutptr.push(0);    // output pointer into the aOut array
}
var outbuf = new ArrayBuffer(20000000); // size in bytes, needs to be big enough for a whole multichannel phrase
var outdv = new DataView(outbuf);
var totSamples = 0;
const nPhrases = Math.round(targetDuration / (tCR * (nBlocksOFF+nBlocksON)));
const duration = (intro*nFingers) + (tCR * (nBlocksOFF + nBlocksON) * nPhrases);

// note: even the first pulse of a new phrase can be pulled forward to start before the "beat"

function createSine(freq, t, sampleFrequency) {
    let y = new Array(t * sampleFrequency);
    // freq in rad/s = freq*2pi
    const frad = freq * 2.0*Math.PI;
    const step = frad/sampleFrequency;
    // step in radians
    let x = 0.0;
    for(let i=0; i<y.length; i++) {
        x += step;
        y[i] = Math.round(maxAmp * Math.sin(x));
    }
    return y;
}

function addTone(f) {
    if(debug) console.log(`adding tone to finger ${f}`);
    for(let i=0; i<tone.length; i++) {
        addSample(f, tone[i]);
    }
}

function addSilence(f, t) {
    if(debug) console.log(`adding silence to finger ${f}`);
    let nSamples = t * sampleFrequency;
    for(let i=0;i<nSamples;i++) {
        addSample(f, 0);
    }
}

function addSample(f, x) {
    // if(aOutptr[f] >= aOut[f].length)
    //    flush();
    aOut[f][aOutptr[f]++] = x;
    if(f==0) totSamples++;
}

function flush() {
    let nSamples = aOutptr[0]; // assume all channels are now alighned
    if(debug) console.log(`flushing ${nSamples} per finger, ${nFingers} fingers`);
    let offset = 0;
    for(let i=0; i<nSamples; i++) {
        for(let f=0; f<nFingers; f++) {
            try {
                outdv.setInt16(offset, aOut[f][i], true);
                offset += 2;
            } catch(e) {
                console.log(`dataview error at offset ${offset} length ${outdv.byteLength}`);
            }
        }
    }
    for(let f=0; f<nFingers; f++) aOutptr[f] = 0;
    if(debug) console.log(`writing ${offset} bytes`);
    fs.writeSync(fd, Buffer.from(outbuf, 0, offset));
}

function jitter() {
    return (Math.random() * jMax) - jMax/2;
}

// main program

function makeIntro() {
    if(intro == 0)
        return;
    let intTone = createSine(fBase, intro, sampleFrequency);
    for(let f=0; f<nFingers; f++) {
        for(let c=0; c<nFingers; c++) {
            if(c==f) {
                for(let i=0; i<intTone.length; i++) {
                    addSample(f, intTone[i]);
                }
            } else {
                addSilence(f, intro);
            }
        }
    }
    flush();
}

function makePhrases() {
    // easier idea: calculate jitter one note ahead
    var jThis = 0.0;
    var t = 0.0;
    var gap = 0;
    var cycle = 0;
    var bar;
    var tStart;
    for(;;) {
        if(debug) console.log(`t=${t} (end=${targetDuration})`);
        if(t > targetDuration) {
            console.log(`Done at t=${t} (end=${targetDuration})`);
            break;
        }
        cycle++;
        bar = 0;
        tStart = totSamples;
        for (i=0; i<nBlocksON; i++) {
            bar++;
        // pick random order for the 4 fingers
            let seqnum = Math.floor(Math.random()*24);
            seq = sequences[seqnum];
            if(debug) console.log(`block ${i} sequence #${seqnum} = ${seq}`)
            fs.writeSync(fdLog,`${cycle},${bar},${seqnum},${(tStart+aOutptr[0])/sampleFrequency},${t}\n`);

            for(n=0; n<4; n++) { // for each note
                let lFinger = 0;
                for(f=0; f<nFingers; f++) { // for each finger (output channel)
                    if(debug) console.log(`#${f+1} in sequence is ${seq[lFinger]}`);
                    if(sixChan && (f==2 || f==3)) {
                        addSilence(f, tTone);
                    } else {
                        if((lFinger+1) == seq[n]) { // only one finger in this bar
                            if(debug) console.log(`sounding tone on finger ${lFinger}`);
                            addTone(f);
                        } else {
                            addSilence(f, tTone);
                        }
                        lFinger++;
                    }
                }
                jThis = jitter();
                gap = tCR4 - tTone + jThis;
                for(f=0;f<nFingers;f++) {
                    addSilence(f, gap);
                }
            }
            t += tCR;
        }
        for(i=0; i<nBlocksOFF; i++) {
            bar++;
            fs.writeSync(fdLog,`${cycle},${bar},-1,${(tStart+aOutptr[0])/sampleFrequency},${t}\n`);
            for(f=0; f<4; f++) {
                addSilence(f, tCR)
            }
            t += tCR;
        }
        flush();
    }
}

// initialise sequences
var fd = fs.openSync(fOut, 'w');
var fdLog = fs.openSync(fLog, 'w');
fs.writeSync(fdLog, `"Cycle","Bar","Pattern","SampleTime","ProgTime"\n`);

// write wav header
const wavOpts = initWavHeader();
var hdr = buildWaveHeader(wavOpts);
fs.writeSync(fd, Buffer.from(hdr));

if(intro) {
    makeIntro();
}
// write multiple phrases until we get to 1hr
makePhrases();

// close file
fs.closeSync(fd);
fs.closeSync(fdLog);

console.log(`output written to ${fOut}`);
console.log(`log written to ${fLog}`);

/*
 * Wave-file stuff
 */

function initWavHeader() {
    var mask = SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;
    if(useSideChannels) {
        mask |= (SPEAKER_SIDE_LEFT | SPEAKER_SIDE_RIGHT);
    } else {
        mask |= (SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT);
    }
    if(sixChan)
        mask |= (SPEAKER_LOW_FREQUENCY | SPEAKER_FRONT_CENTER);
    console.log(`WAV header duration=${duration} numFrames=${sampleFrequency * duration}`);
    return {
        numFrames: sampleFrequency * duration,
        numChannels: nFingers,
        sampleRate: sampleFrequency,
        bytesPerSample: 2,
        use_extensible: true,
        channelMask: mask
    };
}

// https://ccrma.stanford.edu/courses/422/projects/WaveFormat/
function buildWaveHeader(opts) {
    var numFrames = opts.numFrames;
    var numChannels = opts.numChannels || 2;
    var sampleRate = opts.sampleRate || 44100;
    var bytesPerSample = opts.bytesPerSample || 2;
    var blockAlign = numChannels * bytesPerSample;
    var byteRate = sampleRate * blockAlign;
    var dataSize = numFrames * blockAlign;

    var buffer = new ArrayBuffer(opts.use_extensible?68:44);
    var dv = new DataView(buffer);

    var p = 0;

    function writeString(s) {
        for (var i = 0; i < s.length; i++) {
            dv.setUint8(p + i, s.charCodeAt(i));
        }
        p += s.length;
    }

    function writeUint32(d) {
        dv.setUint32(p, d, true);
        p += 4;
    }

    function writeUint16(d) {
        dv.setUint16(p, d, true);
        p += 2;
    }

    writeString('RIFF');              // ChunkID
    writeUint32(dataSize + 36);       // ChunkSize
    writeString('WAVE');              // Format
    if(opts.use_extensible) {
        writeString('fmt ');              // Subchunk1ID
        writeUint32(40);                  // Subchunk1Size
        writeUint16(WAVE_FORMAT_EXTENSIBLE); // AudioFormat 0xfffe=WAV_FORMAT_EXTENSIBLE
        writeUint16(numChannels);         // NumChannels
        writeUint32(sampleRate);          // SampleRate
        writeUint32(byteRate);            // ByteRate
        writeUint16(blockAlign);          // BlockAlign
        writeUint16(bytesPerSample * 8);  // BitsPerSample
        writeUint16(22);                  // ExtraSize
        writeUint16(bytesPerSample * 8);  // bits per sample - extended
        writeUint32(opts.channelMask);    // ChannelMask
        writeUint16(WAVE_FORMAT_PCM);     // Actual data format - first 2 bytes of GUID
        writeString("\x00\x00\x00\x00\x10\x00\x80\x00\x00\xAA\x00\x38\x9B\x71");    // rest of GUID
    } else {
        writeString('fmt ');              // Subchunk1ID
        writeUint32(18);                  // Subchunk1Size
        writeUint16(WAVE_FORMAT_PCM);     // AudioFormat 1=WAV_FMT_PCM
        writeUint16(numChannels);         // NumChannels
        writeUint32(sampleRate);          // SampleRate
        writeUint32(byteRate);            // ByteRate
        writeUint16(blockAlign);          // BlockAlign
        writeUint16(bytesPerSample * 8);  // BitsPerSample
        writeUint16(0);                   // ExtraSize
    }
    writeString('data');              // Subchunk2ID
    writeUint32(dataSize);            // Subchunk2Size

    return buffer;
}

function updateDataSize(buffer, opts) {
    var dv = new DataView(buffer);
    var numFrames = opts.numFrames;
    var numChannels = opts.numChannels || 2;
    var sampleRate = opts.sampleRate || 44100;
    var bytesPerSample = opts.bytesPerSample || 2;
    var blockAlign = numChannels * bytesPerSample;
    var dataSize = numFrames * blockAlign;
    dv.setUint32(4, dataSize+36, true);
    dv.setUint32(40, dataSize, true);
}