/* ================================================================
   MERCURY — entry
   Boot the curtain, raise the chrome, then mount each act. Scenes
   are idle until their section is near the viewport, so only one
   or two ever draw at a time.
   ================================================================ */
import { boot }        from './core/boot.js';
import { cursor }      from './core/cursor.js';
import { scroll }      from './core/scroll.js';
import { instruments } from './core/hud.js';
import { reveal }      from './ui/reveal.js';

import { sceneVoid }     from './scenes/void.js';
import { sceneHand }     from './scenes/hand.js';
import { scenePipeline } from './scenes/pipeline.js';
import { sceneVoice, sceneClose }         from './scenes/voice.js';
import { sceneDescent, sceneAscent }      from './scenes/descent.js';
import { sceneLab }                       from './scenes/lab.js';

async function start() {
  // chrome that should exist behind the curtain
  cursor();

  await boot();

  scroll();
  instruments();
  reveal();

  sceneVoid();
  sceneDescent();
  sceneHand();
  scenePipeline();
  sceneVoice();
  sceneAscent();
  sceneLab();
  sceneClose();

  // layout settles after fonts land; sticky maths depends on it
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  addEventListener('resize', () => ScrollTrigger.refresh());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
