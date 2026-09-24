// Dev-only: usa el HTML y ArView reales, sin crear cámaras ni motores de visión.
import { ArView } from '@ui/ArView';
import { ArSession } from '@domain/entities/ArSession';
import { ArModel } from '@domain/entities/ArModel';
import { Placement } from '@domain/entities/Placement';
import { NUQUI_CATALOG } from '@infrastructure/repositories/StaticModelRepository';

const sizes = [[320, 568], [375, 560], [390, 744], [768, 1024], [844, 390], [1366, 768]] as const;
const html = new DOMParser().parseFromString(await (await fetch('/index.html')).text(), 'text/html');
html.querySelectorAll('script').forEach((script) => script.remove());
const screens = document.querySelector('#screens')!;
const results = document.querySelector('#results')!;
const catalog = NUQUI_CATALOG.map(ArModel.fromSnapshot);
const initial = catalog[0]!;
const searching = ArSession.idle().searching(Placement.initial(initial.id, initial.defaultScale));
const focused = searching.tracking().withDiscovery(searching.discovery.unlock(initial.id));
const fixtures: { frame: HTMLIFrameElement; view: ArView; width: number; height: number }[] = [];

await Promise.all(sizes.map(async ([width, height]) => {
  const section = document.createElement('section');
  const label = document.createElement('p');
  label.textContent = `${width} × ${height}`;
  const frame = document.createElement('iframe');
  frame.width = String(width);
  frame.height = String(height);
  const loaded = new Promise<void>((resolve) => { frame.onload = () => resolve(); });
  frame.srcdoc = html.documentElement.outerHTML;
  section.append(label, frame);
  screens.append(section);
  await loaded;
  const root = frame.contentDocument!.querySelector<HTMLElement>('#app')!;
  const view = new ArView(root, { onPrepare() {}, onStart() {}, onCloseFocus() {} });
  view.setCatalog(catalog);
  view.render(ArSession.idle());
  fixtures.push({ frame, view, width, height });
}));

function check(mode: 'splash' | 'guide' | 'focus'): void {
  const failures: string[] = [];
  for (const { frame, width, height } of fixtures) {
    const doc = frame.contentDocument!;
    const rect = (id: string) => doc.querySelector(id)!.getBoundingClientRect();
    if (mode === 'splash') {
      const art = rect('#boot-art');
      if (art.y + art.height * 0.205 < -1 || art.y + art.height * 0.898 > height + 1) {
        failures.push(`${width}×${height}: título o logos recortados`);
      }
    }
    for (const id of mode === 'splash' ? ['#start'] : mode === 'guide'
      ? ['#guide-frame', '#guide-title', '#guide-link'] : ['#focus-name', '#focus-info', '#focus-close']) {
      const r = rect(id);
      if (r.left < -1 || r.top < -1 || r.right > width + 1 || r.bottom > height + 1) {
        failures.push(`${width}×${height}: ${id} fuera de pantalla`);
      }
    }
  }
  results.textContent = failures.length ? failures.join('\n') : `OK: ${mode}, ${fixtures.length} tamaños, sin recortes`;
}

document.querySelector('#splash')!.addEventListener('click', () => location.reload());
document.querySelector('#guide')!.addEventListener('click', () => {
  for (const { view } of fixtures) { view.render(searching); view.cameraReady(); }
  check('guide');
});
document.querySelector('#focus')!.addEventListener('click', () => {
  for (const { view } of fixtures) { view.cameraReady(); view.render(focused); }
  check('focus');
});
check('splash');
