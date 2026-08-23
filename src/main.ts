import {Deck, OrbitView, OrthographicView} from '@deck.gl/core';
import {ArcLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer} from '@deck.gl/layers';
import {ContourLayer, GridLayer, HeatmapLayer, HexagonLayer} from '@deck.gl/aggregation-layers';
import {TripsLayer} from '@deck.gl/geo-layers';
import './style.css';

type SceneName = 'hexagons' | 'trips' | 'flows' | 'grid-cells' | 'heat-islands' | 'contour-pressure' | 'migration-arcs' | 'parcel-zoning' | 'constellation' | 'river-network' | 'sensor-field' | 'label-atlas';
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
  },
  'grid-cells': {title:'Regional capacity grid',subtitle:'A regular GPU aggregation exposes capacity and local variance.',note:'GridLayer encodes weight as both elevation and a sequential color ramp.'},
  'heat-islands': {title:'Overlapping heat islands',subtitle:'Several dense sources merge into one continuous spatial field.',note:'HeatmapLayer blends 75,000 weighted samples without a basemap.'},
  'contour-pressure': {title:'Pressure threshold atlas',subtitle:'Nested iso-bands turn point samples into readable scalar regions.',note:'ContourLayer extracts threshold bands and isolines on the GPU.'},
  'migration-arcs': {title:'Migration corridor arcs',subtitle:'Origin-destination volume controls arc width, height, and color.',note:'ArcLayer compares long-range corridors while node glyphs preserve hubs.'},
  'parcel-zoning': {title:'Synthetic parcel zoning',subtitle:'Land-use classes, block geometry, and intensity become an isometric district.',note:'PolygonLayer extrudes deterministic parcels by floor-area intensity.'},
  constellation: {title:'Object constellation field',subtitle:'Twenty thousand objects preserve clusters, anomalies, and local density.',note:'ScatterplotLayer combines radius, color, outline, and picking.'},
  'river-network': {title:'Branching river network',subtitle:'Stream order controls path width while tributaries preserve topology.',note:'PathLayer renders a deterministic branching hierarchy with rounded joints.'},
  'sensor-field': {title:'Multivariate sensor field',subtitle:'Position, radius, fill, and outline distinguish health and magnitude.',note:'ScatterplotLayer composes four visual channels without a geographic tile source.'},
  'label-atlas': {title:'Annotated feature atlas',subtitle:'Labels, leader relationships, and feature classes share one coordinate space.',note:'TextLayer and ScatterplotLayer form a dense but deterministic annotation field.'}
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
} else if (scene === 'flows') {
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
} else {
  const points=makePoints(scene==='heat-islands'?75_000:scene==='constellation'?20_000:18_000);
  const parcels=Array.from({length:180},(_,i)=>{const x=(i%18-9)*5.4,y=(Math.floor(i/18)-5)*5.2,w=3.3+(i%4)*.35,h=3.1+(i%3)*.5;return {polygon:[[x-w,y-h],[x+w,y-h],[x+w,y+h],[x-w,y+h]],height:2+((i*17)%18),kind:i%5};});
  const hubs=networkNodes.map((d,i)=>({...d,value:30+(i*37)%170}));
  const branches=Array.from({length:90},(_,i)=>{const order=1+i%5,x=(i%9-4)*12,y=34-Math.floor(i/9)*7;return {order,path:Array.from({length:18},(_,k):[number,number]=>[x+(k-9)*2.4/order+Math.sin(k*.7+i)*2,y-k*2.5+Math.sin(k*.3+i)*4])};});
  let layers:any[]=[];let view:any={target:[0,0,0],zoom:2.7,minZoom:1,maxZoom:7};itemCount=points.length;
  if(scene==='grid-cells')layers=[new GridLayer<Point>({id:scene,data:points,getPosition:d=>d.position,getColorWeight:d=>d.weight,getElevationWeight:d=>d.weight,cellSize:3.2,extruded:true,elevationScale:.12,colorRange:[[18,48,83],[36,91,125],[62,151,154],[84,214,198],[255,209,102],[255,111,145]],opacity:.86})];
  if(scene==='heat-islands')layers=[new HeatmapLayer<Point>({id:scene,data:points,getPosition:d=>d.position,getWeight:d=>d.weight,radiusPixels:48,intensity:1.6,threshold:.04,colorRange:[[14,29,52,0],[41,72,122,120],[84,214,198,190],[255,209,102,220],[255,111,145,245]]})];
  if(scene==='contour-pressure')layers=[new ContourLayer<Point>({id:scene,data:points,getPosition:d=>d.position,getWeight:d=>d.weight,cellSize:5,contours:[{threshold:1,color:[84,214,198],strokeWidth:2},{threshold:3,color:[123,156,255],strokeWidth:3},{threshold:[5,9],color:[255,111,145,100]},{threshold:[9,14],color:[255,209,102,110]}]})];
  if(scene==='migration-arcs'){itemCount=flows.length;layers=[new ArcLayer<any>({id:scene,data:flows,getSourcePosition:d=>d.source.position,getTargetPosition:d=>d.target.position,getSourceColor:d=>d.value>100?[255,111,145]:[84,214,198],getTargetColor:[255,209,102],getWidth:d=>1+d.value/45,widthMinPixels:1.5,greatCircle:false,opacity:.7}),new ScatterplotLayer({id:'hubs',data:hubs,getPosition:(d:any)=>d.position,getRadius:(d:any)=>1+d.value/45,radiusMinPixels:4,getFillColor:[235,247,255],getLineColor:[84,214,198],stroked:true,lineWidthMinPixels:2})];}
  if(scene==='parcel-zoning'){itemCount=parcels.length;layers=[new PolygonLayer({id:scene,data:parcels,getPolygon:(d:any)=>d.polygon,getElevation:(d:any)=>d.height,extruded:true,getFillColor:(d:any)=>[[84,214,198],[123,156,255],[255,111,145],[255,209,102],[184,137,255]][d.kind] as [number,number,number],getLineColor:[220,242,250],lineWidthMinPixels:1,wireframe:true,opacity:.62})];view={target:[0,0,0],rotationX:38,rotationOrbit:28,zoom:3.1};}
  if(scene==='constellation')layers=[new ScatterplotLayer<Point>({id:scene,data:points,getPosition:d=>d.position,getRadius:d=>.4+d.weight*.5,radiusMinPixels:1,radiusMaxPixels:9,getFillColor:d=>d.weight>2?[255,111,145]:d.weight>1.3?[255,209,102]:[84,214,198],opacity:.55,stroked:true,getLineColor:[220,244,250],lineWidthMinPixels:.4})];
  if(scene==='river-network'){itemCount=branches.length;layers=[new PathLayer({id:scene,data:branches,getPath:(d:any)=>d.path,getWidth:(d:any)=>d.order*.9,widthMinPixels:1,getColor:(d:any)=>d.order>3?[84,214,198]:[72,120+d.order*20,190],rounded:true,jointRounded:true,opacity:.72})];}
  if(scene==='sensor-field')layers=[new ScatterplotLayer<Point>({id:scene,data:points.slice(0,2500),getPosition:d=>d.position,getRadius:d=>.8+d.weight*1.2,radiusMinPixels:2,radiusMaxPixels:14,getFillColor:d=>d.weight>2.2?[255,111,145]:d.weight>1.2?[255,209,102]:[84,214,198],getLineColor:d=>d.weight>2.2?[255,230,235]:[180,220,235],stroked:true,lineWidthMinPixels:1.2,opacity:.7})];
  if(scene==='label-atlas'){itemCount=hubs.length;layers=[new ScatterplotLayer({id:'features',data:hubs,getPosition:(d:any)=>d.position,getRadius:(d:any)=>2+d.value/90,radiusMinPixels:4,getFillColor:(d:any)=>d.value>100?[255,111,145]:[84,214,198]}),new TextLayer({id:'labels',data:hubs,getPosition:(d:any)=>d.position,getText:(d:any)=>d.name,getSize:16,getColor:[225,242,250],getPixelOffset:[0,-18],fontFamily:'Avenir Next',fontWeight:600,outlineWidth:3,outlineColor:[8,18,32,220]})];}
  const orbit=scene==='parcel-zoning';deck=new Deck({...commonProps(),views:orbit?new OrbitView({orbitAxis:'Y',clearColor:[0,0,0,0]}):new OrthographicView({clearColor:[0,0,0,0]}),initialViewState:view,layers});
}

document.querySelector('#items')!.textContent = itemCount >= 1000 ? `${(itemCount / 1000).toFixed(itemCount >= 10000 ? 0 : 1)}k` : String(itemCount);
syncInfo();

window.addEventListener('beforeunload', () => deck.finalize());
