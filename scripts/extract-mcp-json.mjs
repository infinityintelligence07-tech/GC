import fs from 'node:fs';

const [inFile, outFile] = process.argv.slice(2);
let text = fs.readFileSync(inFile, 'utf8');
if (text.startsWith('{')) {
  const outer = JSON.parse(text);
  text = outer.result ?? text;
}
const markerStart = text.indexOf('<untrusted-data-');
const markerEnd = text.indexOf('</untrusted-data>');
if (markerStart < 0 || markerEnd < 0) throw new Error('markers not found');
const bodyStart = text.indexOf('\n', markerStart) + 1;
const jsonText = text.slice(bodyStart, markerEnd).trim();
const parsed = JSON.parse(jsonText);
const data = Array.isArray(parsed) ? parsed : parsed.cases ?? parsed;
fs.writeFileSync(outFile, JSON.stringify(data));
console.log('wrote', outFile, 'rows', data.length);
