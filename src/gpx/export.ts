import type { Coord } from '../types';

const XML_ESCAPES: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  "'": '&apos;',
  '"': '&quot;',
};
const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => XML_ESCAPES[c]);

/** Builds a GPX 1.1 document with one track. */
export function toGpx(coords: Coord[], name: string, time = new Date()): string {
  const safeName = escapeXml(name);
  const points = coords
    .map(([lon, lat, ele]) => {
      const attrs = `lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"`;
      return ele === undefined
        ? `      <trkpt ${attrs}/>`
        : `      <trkpt ${attrs}><ele>${ele.toFixed(1)}</ele></trkpt>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Lapwing"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${safeName}</name>
    <time>${time.toISOString()}</time>
  </metadata>
  <trk>
    <name>${safeName}</name>
    <type>running</type>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}

/** A safe file name from the route name, e.g. "Volta no Parque" → "volta-no-parque.gpx". */
export function fileNameFor(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'route'}.gpx`;
}

/** Saves the route as a .gpx file through the browser's download. */
export function downloadGpx(coords: Coord[], name: string): void {
  const blob = new Blob([toGpx(coords, name)], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileNameFor(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
