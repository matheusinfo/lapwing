import { fileNameFor } from '../../gpx/export';
import type { TrackPoint } from '../../data/types';

const XML_ESCAPES: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' };
const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => XML_ESCAPES[c]);

/**
 * GPX 1.1 with everything the run recorded: time, elevation and the Garmin
 * TrackPointExtension (hr, cad, atemp) plus power, the same layout Strava
 * exports. Cadence is written back as strides per minute.
 */
export function toActivityGpx(points: TrackPoint[], name: string): string {
  const rows = points.map((p) => {
    const parts = [`<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">`];
    if (p.ele !== undefined) parts.push(`<ele>${p.ele.toFixed(1)}</ele>`);
    if (p.time !== undefined) parts.push(`<time>${new Date(p.time).toISOString()}</time>`);
    const tpx: string[] = [];
    if (p.temp !== undefined) tpx.push(`<gpxtpx:atemp>${p.temp}</gpxtpx:atemp>`);
    if (p.hr !== undefined) tpx.push(`<gpxtpx:hr>${Math.round(p.hr)}</gpxtpx:hr>`);
    if (p.cad !== undefined) tpx.push(`<gpxtpx:cad>${p.cad / 2}</gpxtpx:cad>`);
    if (tpx.length || p.power !== undefined) {
      parts.push('<extensions>');
      if (p.power !== undefined) parts.push(`<power>${Math.round(p.power)}</power>`);
      if (tpx.length) parts.push(`<gpxtpx:TrackPointExtension>${tpx.join('')}</gpxtpx:TrackPointExtension>`);
      parts.push('</extensions>');
    }
    parts.push('</trkpt>');
    return '      ' + parts.join('');
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Lapwing"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><name>${esc(name)}</name></metadata>
  <trk>
    <name>${esc(name)}</name>
    <type>running</type>
    <trkseg>
${rows.join('\n')}
    </trkseg>
  </trk>
</gpx>
`;
}

export function downloadActivityGpx(points: TrackPoint[], name: string): void {
  const blob = new Blob([toActivityGpx(points, name)], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileNameFor(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
