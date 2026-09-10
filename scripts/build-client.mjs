import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
const result = await build({entryPoints:['src/web/client.tsx'], bundle:true, format:'cjs', platform:'browser', target:'es2022', external:['react','react/jsx-runtime'], write:false, minify:true});
await writeFile('dist/client.js', 'window.__ModuleLoader__.load({id:"dsh-ai-meter",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n' + result.outputFiles[0].text + '\nreturn module.exports;}});\n');
