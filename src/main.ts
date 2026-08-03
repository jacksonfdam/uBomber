/**
 * Entry point. Boots the audio engine (which may only start from a user
 * gesture) and hands control to the screen router.
 */

import './ui/styles.css';
import { App } from './app';
import { AudioEngine } from './audio/audio';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app root element');

const audio = new AudioEngine();

// Browsers refuse to start an AudioContext until the player interacts.
const unlock = (): void => audio.unlock();
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });

new App(root, audio);
