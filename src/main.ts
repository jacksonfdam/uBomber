/**
 * Entry point. Boots the audio engine (which may only start from a user
 * gesture) and hands control to the screen router.
 */

import { inject } from '@vercel/analytics';
import './ui/styles.css';
import { App } from './app';
import { AudioEngine } from './audio/audio';

// Vercel Web Analytics. Auto mode keeps events on the console outside production.
inject();

const root = document.getElementById('app');
if (!root) throw new Error('missing #app root element');

const audio = new AudioEngine();

// Browsers refuse to start an AudioContext until the player interacts.
const unlock = (): void => audio.unlock();
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });

new App(root, audio);
