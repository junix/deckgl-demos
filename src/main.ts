import {Deck, OrbitView, OrthographicView} from '@deck.gl/core';
import {PathLayer, ScatterplotLayer} from '@deck.gl/layers';
import {HexagonLayer} from '@deck.gl/aggregation-layers';
import {TripsLayer} from '@deck.gl/geo-layers';
import './style.css';

type SceneName = 'hexagons' | 'trips' | 'flows';
type Point = {position: [number, number]; weight: number};
type Trip = {path: [number, number][]; timestamps: number[]; cohort: number};

const scenes: Record<SceneName, {title: string; subtitle: string; note: string}> = {
  hexagons: {
    title: 'GPU-aggregated urban pulse',
    subtitle: '120,000 deterministic samples become an explorable 3D density field.',
    note: 'HexagonLayer performs screen-ready aggregation on the GPU. Drag to orbit; scroll to zoom.'
  },
  trips: {
    title: 'Temporal mobility trails',
    subtitle: '2,400 animated paths reveal directional waves through a synthetic street field.',
    note: 'TripsLayer animates timestamped paths while a faint static network preserves spatial context.'
  },
  flows: {
    title: 'Distributed connection arcs',
    subtitle: 'Directed flows use height, width, and color to encode route intensity.',
    note: 'Curved PathLayer routes and ScatterplotLayer nodes share a planar camera with no basemap dependency.'
  }
};

function pseudo(index: number, salt = 0): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function makePoints(count = 120_000): Point[] {
  const centers: [number, number][] = [[-35, 12], [5, -18], [28, 22], [48, -5], [-2, 34]];
  return Array.from({length: count}, (_, index) => {
    const center = centers[index % centers.length];
    const radius = Math.pow(pseudo(index, 2), 1.8) * (12 + 18 * pseudo(index, 9));
    const angle = pseudo(index, 5) * Math.PI * 2;
    return {
      position: [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius],
      weight: 0.4 + 2.4 * pseudo(index, 13)
    };
  });
}

function makeTrips(count = 900): Trip[] {
  return Array.from({length: count}, (_, index) => {
    const cohort = index % 3;
    const phase = pseudo(index, 3) * Math.PI * 2;
    const cx = (pseudo(index, 4) - 0.5) * 90;
    const cy = (pseudo(index, 6) - 0.5) * 52;
    const path: [number, number][] = [];
    const timestamps: number[] = [];
    for (let step = 0; step < 28; step += 1) {
      const t = step / 27;
      path.push([
        cx + (t - 0.5) * (48 + cohort * 15) + Math.sin(t * Math.PI * 3 + phase) * 9,
        cy + Math.cos(t * Math.PI * 2 + phase) * (7 + cohort * 3)
      ]);
      timestamps.push(step * 5 + pseudo(index, 8) * 35);
    }
    return {path, timestamps, cohort};
  });
}

const cities = [
  ['San Francisco', -122.42, 37.77], ['New York', -74.01, 40.71], ['London', -0.13, 51.51],
  ['Lagos', 3.38, 6.52], ['São Paulo', -46.63, -23.55], ['Singapore', 103.82, 1.35],
  ['Tokyo', 139.69, 35.68], ['Sydney', 151.21, -33.87], ['Mumbai', 72.88, 19.08],
  ['Dubai', 55.27, 25.20], ['Mexico City', -99.13, 19.43], ['Seoul', 126.98, 37.57]
] as const;

const networkNodes = cities.map((city, index) => ({
  name: city[0],
  position: [((index % 4) - 1.5) * 31 + (index % 2) * 6, (1 - Math.floor(index / 4)) * 27] as [number, number]
}));

function arcPath(source: [number, number], target: [number, number], seed: number): [number, number][] {
  const dx = target[0] - source[0];
  const dy = target[1] - source[1];
  const length = Math.hypot(dx, dy) || 1;
  const bend = (seed % 2 === 0 ? 1 : -1) * Math.min(17, 4 + length * 0.2);
  return Array.from({length: 41}, (_, index) => {
    const t = index / 40;
    const offset = Math.sin(t * Math.PI) * bend;
    return [
      source[0] + dx * t - dy / length * offset,
      source[1] + dy * t + dx / length * offset
    ];
  });
}

const flows = networkNodes.flatMap((source, sourceIndex) =>
  networkNodes.flatMap((target, targetIndex) => {
    if (source === target || (sourceIndex * 3 + targetIndex) % 5 !== 0) return [];
    const index = sourceIndex * cities.length + targetIndex;
    return [{
      source,
      target,
      value: 20 + Math.round(pseudo(index, 15) * 180),
      path: arcPath(source.position, target.position, index)
    }];
  })
);

const queryScene = new URLSearchParams(location.search).get('scene');
const exportMode = new URLSearchParams(location.search).get('export') === '1';
const scene: SceneName = queryScene && queryScene in scenes ? queryScene as SceneName : 'hexagons';
const meta = scenes[scene];

document.querySelector<HTMLElement>('#app')!.innerHTML = `
  <section class="shell ${exportMode ? 'export' : ''}">
    <div class="deck-host" id="deck-host"></div>
    <div class="chrome">
      <header class="header">
        <div>
          <div class="eyebrow">deck.gl / advanced patterns</div>
          <h1>${meta.title}</h1>
          <p class="subtitle">${meta.subtitle}</p>
          <nav class="nav">
            ${Object.entries(scenes).map(([key]) => `<a class="${key === scene ? 'active' : ''}" href="?scene=${key}">${key}</a>`).join('')}
          </nav>
        </div>
        <div class="badge">LOCAL DATA · NO BASEMAP</div>
      </header>
      <div class="legend"><span>low</span><div class="gradient"></div><span>high</span></div>
      <aside class="panel">
        <h2>What this demonstrates</h2>
        <p>${meta.note}</p>
        <div class="stats">
          <div class="stat"><strong id="items">–</strong><span>records</span></div>
          <div class="stat"><strong id="frame">0</strong><span>frame</span></div>
          <div class="stat"><strong id="changes">0</strong><span>views</span></div>
        </div>
        ${scene === 'trips' ? '<div class="controls"><button id="motion">Pause animation</button></div>' : ''}
      </aside>
    </div>
  </section>`;

let itemCount = 0;
let lastViewState: unknown = null;
let viewChanges = 0;
let frame = 0;
let paused = false;
let ready = false;
let deck: Deck<any>;

const info = window.__plotDemo = {ready, scene, itemCount, frame, viewChanges, viewState: lastViewState};

function syncInfo(): void {
  Object.assign(info, {ready, itemCount, frame, viewChanges, viewState: lastViewState});
  document.querySelector('#frame')!.textContent = String(frame);
  document.querySelector('#changes')!.textContent = String(viewChanges);
}

function commonProps() {
  return {
    parent: document.querySelector<HTMLDivElement>('#deck-host')!,
    controller: true,
    style: {background: 'transparent'},
    deviceProps: {webgl: {alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true}},
    onViewStateChange: ({viewState}: {viewState: unknown}) => {
      lastViewState = viewState;
      viewChanges += 1;
      syncInfo();
    },
    onAfterRender: () => {
      if (!ready) {
        ready = true;
        syncInfo();
      }
    }
  };
}

if (scene === 'hexagons') {
  const points = makePoints();
  itemCount = points.length;
  deck = new Deck({
    ...commonProps(),
    views: new OrbitView({orbitAxis: 'Y', clearColor: [0, 0, 0, 0]}),
    initialViewState: {target: [4, 4, 0], rotationX: 35, rotationOrbit: 25, zoom: exportMode ? 2.35 : 2.65, minZoom: 1, maxZoom: 7},
    layers: [new HexagonLayer<Point>({
      id: 'density-hexagons', data: points, getPosition: d => d.position, getColorWeight: d => d.weight,
      getElevationWeight: d => d.weight, elevationScale: 0.08, extruded: true, radius: 1.75,
      colorScaleType: 'quantile',
      colorRange: [[21, 60, 101], [22, 116, 131], [35, 168, 181], [140, 201, 138], [255, 224, 102], [237, 91, 77]],
      pickable: true, opacity: 0.92, material: {ambient: 0.55, diffuse: 0.62, shininess: 28, specularColor: [80, 100, 100]}
    })]
  });
} else if (scene === 'trips') {
  const trips = makeTrips();
  itemCount = trips.length;
  const palette = [[98, 214, 198], [246, 182, 81], [222, 97, 134]];
  const baseLayer = new PathLayer<Trip>({
    id: 'street-context', data: trips.filter((_, index) => index % 20 === 0), getPath: d => d.path,
    getColor: [31, 82, 91, 70], getWidth: 0.55, widthMinPixels: 0.45
  });
  const renderTrips = () => new TripsLayer<Trip>({
    id: 'moving-trips', data: trips, getPath: d => d.path, getTimestamps: d => d.timestamps,
    getColor: d => palette[d.cohort] as [number, number, number], opacity: 0.85, widthMinPixels: 1.5,
    trailLength: 26, currentTime: frame / 3, capRounded: true, jointRounded: true
  });
  deck = new Deck({
    ...commonProps(), views: new OrthographicView({clearColor: [0, 0, 0, 0]}),
    initialViewState: {target: [0, 0, 0], zoom: exportMode ? 2.65 : 2.9, minZoom: 1.5, maxZoom: 7},
    layers: [baseLayer, renderTrips()]
  });
  const animate = () => {
    if (!paused) frame = (frame + 1) % 540;
    deck.setProps({layers: [baseLayer, renderTrips()]});
    syncInfo();
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
  document.querySelector<HTMLButtonElement>('#motion')!.addEventListener('click', event => {
    paused = !paused;
    (event.currentTarget as HTMLButtonElement).textContent = paused ? 'Resume animation' : 'Pause animation';
  });
} else {
  itemCount = flows.length;
  deck = new Deck({
    ...commonProps(), views: new OrthographicView({clearColor: [0, 0, 0, 0]}),
    initialViewState: {target: [0, 0, 0], zoom: exportMode ? 3.0 : 3.15, minZoom: 1, maxZoom: 7},
    layers: [
      new PathLayer<typeof flows[number]>({
        id: 'global-flows', data: flows, getPath: d => d.path,
        getColor: d => d.value > 120 ? [237, 91, 77] : d.value > 70 ? [246, 182, 81] : [35, 168, 181],
        getWidth: d => 2 + d.value / 35, widthUnits: 'pixels', widthMinPixels: 2.2,
        rounded: true, jointRounded: true, opacity: 0.82, pickable: true
      }),
      new ScatterplotLayer<typeof networkNodes[number]>({
        id: 'city-nodes', data: networkNodes, getPosition: d => d.position, getRadius: 2.4,
        radiusMinPixels: 3, radiusMaxPixels: 11, getFillColor: [238, 244, 239], getLineColor: [17, 109, 111],
        stroked: true, lineWidthMinPixels: 2, pickable: true
      })
    ]
  });
}

document.querySelector('#items')!.textContent = itemCount >= 1000 ? `${(itemCount / 1000).toFixed(itemCount >= 10000 ? 0 : 1)}k` : String(itemCount);
syncInfo();

window.addEventListener('beforeunload', () => deck.finalize());
