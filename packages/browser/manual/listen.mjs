// Manual LE-89 check: play a looping document through Lyria and count chunk
// boundaries and underruns. Served by Vite (see README.md), which resolves the
// workspace packages and the `?raw` import. Makes provider calls; not in CI.
import { sourceText } from '@luna-estelar/gas-api';
import { createLyriaConnector } from '../../connector-lyria/out/index.js';
import { openAudioContext } from '../out/audio/index.js';
import { createBrowserSession } from '../out/session.js';
import drumLoop from '../../../examples/documents/drum-loop.gas?raw';

const $ = (id) => document.getElementById(id);
const started = performance.now();
let browser;
let chunks = 0;

function log(line) {
  const seconds = ((performance.now() - started) / 1000).toFixed(2).padStart(7);
  $('log').textContent += `${seconds}  ${line}\n`;
  $('log').scrollTop = $('log').scrollHeight;
}

function summarise(context) {
  const status = browser.audio.status();
  $('summary').textContent =
    `${context.sampleRate} Hz output · ${chunks} chunks · ${Math.max(0, chunks - 1)} boundaries · ` +
    `${status.underruns} underruns · ${status.state}`;
}

$('play').addEventListener('click', async () => {
  const apiKey = $('key').value.trim();
  if (apiKey === '') return log('Enter a key first.');
  $('play').disabled = true;
  // Opened before any await, so the context starts inside this click.
  const rate = $('rate').value;
  const opening = openAudioContext(rate === '' ? {} : { sampleRate: Number(rate) });
  try {
    const { context, resumed } = await opening;
    log(
      `context ${context.sampleRate} Hz, resumed ${resumed}, output latency ${context.outputLatency ?? 'n/a'}`
    );
    browser = await createBrowserSession({
      connector: createLyriaConnector,
      settings: { apiKey },
      context
    });
    browser.audio.on('status', (status) => {
      log(`audio ${JSON.stringify(status)}`);
      summarise(context);
    });
    browser.audio.on('warning', (warning) => log(`audio warning ${JSON.stringify(warning)}`));
    browser.session.on('audio', () => {
      chunks++;
      summarise(context);
    });
    browser.session.on('lifecycle', (event) => log(`lifecycle ${JSON.stringify(event)}`));
    browser.session.on('warning', (warning) =>
      log(`session warning ${warning.code ?? ''} ${warning.message ?? ''}`)
    );
    browser.session.on('error', (error) =>
      log(
        `error ${error.kind} ${error.code ?? ''} ${error.message} closeCode=${error.closeCode ?? '-'}`
      )
    );
    await browser.session.loadSource(sourceText(drumLoop, 'drum-loop.gas'));
    await browser.session.play();
    $('stop').disabled = false;
    const tick = () => {
      if (browser === undefined) return;
      const audible = browser.audiblePosition();
      if (audible !== undefined) {
        const { bar, beat } = audible.position;
        $('summary').dataset.playhead = `bar ${bar} beat ${beat?.index ?? 1}`;
      }
      requestAnimationFrame(tick);
    };
    tick();
  } catch (error) {
    log(`failed: ${error.message}`);
    $('play').disabled = false;
  }
});

$('stop').addEventListener('click', async () => {
  $('stop').disabled = true;
  await browser.session.stop();
  log(`stopped: ${JSON.stringify(browser.audio.status())}`);
  await browser.close();
  browser = undefined;
  $('play').disabled = false;
});
