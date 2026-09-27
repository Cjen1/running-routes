// Development helper: report approximate crossings of named Adelaide roads in an OSM PBF.
const fs = require('fs');
const parseOSM = require('osm-pbf-parser');
const names = ['Marion Road', 'South Road', 'Daws Road', 'Sturt Road', 'Morphett Road', 'Bray Street', 'Oaklands Road'];
const points = new Map(), roads = new Map(names.map(name => [name, []]));
const within = (lat, lon) => lat > -35.04 && lat < -34.96 && lon > 138.52 && lon < 138.67;
fs.createReadStream(process.argv[2]).pipe(parseOSM()).on('data', batch => {
  for (const item of batch) {
    if (item.type === 'node' && within(item.lat, item.lon)) points.set(item.id, [item.lat, item.lon]);
    if (item.type !== 'way') continue;
    const name = item.tags?.name || '';
    const match = names.find(value => value.toLowerCase() === name.toLowerCase());
    if (!match) continue;
    for (let i = 1; i < item.refs.length; i++) {
      const a = points.get(item.refs[i - 1]), b = points.get(item.refs[i]);
      if (a && b) roads.get(match).push([a, b]);
    }
  }
}).on('end', () => {
  function distance(point, segment) {
    const [a, b] = segment, dx = (b[1] - a[1]) * 91200, dy = (b[0] - a[0]) * 111000;
    const px = (point[1] - a[1]) * 91200, py = (point[0] - a[0]) * 111000;
    const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)));
    return { distance: Math.hypot(px - t * dx, py - t * dy), point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] };
  }
  for (const [first, second] of [['Marion Road', 'Daws Road'], ['South Road', 'Daws Road'], ['Marion Road', 'Sturt Road'], ['South Road', 'Sturt Road'], ['Morphett Road', 'Daws Road'], ['Morphett Road', 'Sturt Road'], ['Marion Road', 'Bray Street'], ['South Road', 'Bray Street']]) {
    let best = { distance: Infinity };
    for (const [a, b] of roads.get(first)) for (const segment of roads.get(second)) {
      for (const point of [a, b]) {
        const result = distance(point, segment);
        if (result.distance < best.distance) best = result;
      }
    }
    console.log(`${first} / ${second}: ${best.point?.map(n => n.toFixed(6)).join(', ')} (${best.distance.toFixed(1)} m)`);
  }
});
