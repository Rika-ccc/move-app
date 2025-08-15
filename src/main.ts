import './style.css'
import { setupCounter } from './counter.ts'

// #app の中身をボタン込みで書き換える
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <h1>Hello GitHub Pages!</h1>
  <p>TypeScriptで作った簡単なWebアプリです。</p>
  <button id="counter">0</button>
`;

// ボタンを取得してセットアップ。存在チェックも。
const button = document.querySelector<HTMLButtonElement>('#counter');
if (button) {
  setupCounter(button);
} else {
  console.error('button #counter not found');
}
