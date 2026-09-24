// Dev-only: usa el HTML y ArView reales, sin crear cámaras ni motores de visión.
import { ArView } from '@ui/ArView';
import { ArSession } from '@domain/entities/ArSession';
import { ArModel } from '@domain/entities/ArModel';
import { Placement } from '@domain/entities/Placement';
import { NUQUI_CATALOG } from '@infrastructure/repositories/StaticModelRepository';
import { NUQUI_MAP_TEXTS } from '@infrastructure/repositories/StaticMapTextRepository';
import { MapText } from '@domain/value-objects/MapText';

const sizes = [[320, 568], [375, 560], [390, 744], [768, 1024], [844, 390], [1366, 768]] as const;
const html = new DOMParser().parseFromString(await (await fetch('/index.html')).text(), 'text/html');
html.querySelectorAll('script').forEach((script) => script.remove());
const screens = document.querySelector('#screens')!;
const results = document.querySelector('#results')!;
const catalog = NUQUI_CATALOG.map(ArModel.fromSnapshot);
const mapTexts = NUQUI_MAP_TEXTS.map(MapText.of);
// `?text=directorio` para ver otro texto en grande; por defecto, el párrafo.
const textId = new URLSearchParams(location.search).get('text') ?? 'turismo';
// `?animal=turtle` para comprobar la ficha de otro: la de la tortuga, con
// tres párrafos, es la que más ocupa.
const requested = new URLSearchParams(location.search).get('animal');
const initial = catalog.find((model) => model.id.value === requested) ?? catalog[0]!;
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
  view.setMapTexts(mapTexts);
  view.render(ArSession.idle());
  fixtures.push({ frame, view, width, height });
}));

function check(mode: 'splash' | 'guide' | 'focus' | 'reading' | 'explore' | 'approach'): void {
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
      ? ['#guide-frame', '#guide-title', '#guide-link'] : mode === 'reading' ? ['#reading-card', '#reading-close']
      : mode === 'explore' ? ['#explore', '#explore-title'] : mode === 'approach' ? ['#approach-title', '#approach-hands']
      : ['#focus-name', '#focus-species', '#focus-info', '#focus-close']) {
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
document.querySelector('#reading')!.addEventListener('click', () => {
  // Todos encontrados, ficha cerrada, texto abierto.
  let discovery = focused.discovery;
  for (const model of catalog) discovery = discovery.unlock(model.id);
  const reading = focused.withDiscovery(discovery.focus(null).read(textId));
  for (const { view } of fixtures) { view.cameraReady(); view.render(reading); }
  // Tras la animación de entrada, que escala la tarjeta.
  window.setTimeout(() => check('reading'), 800);
});
document.querySelector('#explore')!.addEventListener('click', () => {
  // Los cuatro encontrados y la ficha cerrada: sale la invitación.
  let discovery = focused.discovery;
  for (const model of catalog) discovery = discovery.unlock(model.id);
  const invited = focused.withDiscovery(discovery.focus(null));
  for (const { view } of fixtures) { view.cameraReady(); view.render(invited); }
  check('explore');
});
document.querySelector('#approach')!.addEventListener('click', () => {
  // Mapa en cuadro y ningún animal encontrado: a los 7 s, la indicación de acercarse.
  for (const { view } of fixtures) { view.cameraReady(); view.render(searching.tracking()); }
  check('approach');
});
document.querySelector('#focus')!.addEventListener('click', () => {
  for (const { view } of fixtures) { view.cameraReady(); view.render(focused); }
  check('focus');
});
check('splash');
